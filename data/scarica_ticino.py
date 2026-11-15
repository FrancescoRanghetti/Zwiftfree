#!/usr/bin/env python3
"""
scarica_ticino.py — rete stradale ciclabile di TUTTO il Canton Ticino con quote swisstopo.

Pipeline:
  1. Scarica l'estratto OpenStreetMap della Svizzera (Geofabrik, ~500 MB, una volta sola).
  2. Scarica il confine del Canton Ticino da swisstopo (swissBOUNDARIES3D).
  3. Estrae tutte le strade percorribili in bici dentro il Ticino
     (niente autostrade, superstrade, scale, strade private o vietate alle bici).
  4. Spezza le strade agli incroci → grafo (nodi = incroci, archi = tratti di strada).
  5. Ricampiona ogni tratto ogni 10 m e prende la quota dal modello swissALTI3D 2 m
     (scarica solo le tessere 1×1 km dove passano strade).
  6. Calcola dislivello, pendenza media/massima e lunghezza di ogni tratto.
  7. Scrive in ./out/:
       ticino_nodes.csv      incroci (id, lon, lat, quota)
       ticino_edges.csv      tratti di strada con geometria 3D (WKT), costi per pgRouting
       ticino_roads.geojson  tutta la rete, da trascinare su geojson.io / QGIS per controllarla
       load_postgis.sql      crea le tabelle in PostGIS + pgRouting e importa i CSV
       stats.json            riepilogo (km di strade, n. incroci, ecc.)

Requisiti (una volta):  pip install osmium rasterio shapely numpy
Spazio disco: ~0.5 GB per OSM + ~2–4 GB per le tessere altimetriche (cartella cache/,
cancellabile alla fine). Tempo: 20–60 minuti a seconda della connessione.

Uso:
  python3 scarica_ticino.py               # tutto
  python3 scarica_ticino.py --workers 8   # più download in parallelo
  python3 scarica_ticino.py --no-geojson  # salta il GeoJSON (grande)
Lo script riprende da dove si era fermato: i file già scaricati in cache/ vengono riusati.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

try:
    import osmium
    import rasterio
    import shapely
    from shapely.geometry import shape, box
except ImportError as ex:  # pragma: no cover
    sys.exit(f"Manca una libreria ({ex.name}). Esegui:  pip install osmium rasterio shapely numpy")

# ---------------------------------------------------------------------------
PBF_URL = "https://download.geofabrik.de/europe/switzerland-latest.osm.pbf"
BOUNDARY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/find"
BOUNDARY_LAYER = "ch.swisstopo.swissboundaries3d-kanton-flaeche.fill"
STAC_ITEMS_URL = "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items"
TICINO_BBOX = (8.38, 45.81, 9.17, 46.64)  # lon_min, lat_min, lon_max, lat_max (fallback)
USER_AGENT = "ticino-ride-data/2.0 (progetto personale)"

STEP_M = 10.0
SMOOTH_PTS = 5           # media mobile su 5 punti = 50 m
GRADE_WINDOW_M = 60.0
MAX_GRADE = 30.0
MAX_MISSING_ELE = 0.5    # scarta i tratti con più del 50% di punti senza quota (es. in Italia)

ALLOWED_HIGHWAYS = {
    "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
    "service", "road", "cycleway", "track",
}
BIKE_ONLY_IF_ALLOWED = {"path", "footway", "pedestrian", "bridleway"}
EXCLUDED_SERVICE = {"parking_aisle", "drive-through", "emergency_access"}
PAVED = {"asphalt", "paved", "concrete", "concrete:plates", "paving_stones", "sett", "chipseal"}


# ---------------------------------------------------------------------------
# Utilità
# ---------------------------------------------------------------------------
def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def http_json(url, params=None, retries=4):
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as ex:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            log(f"  riprovo ({ex})")
            time.sleep(2 * (attempt + 1))


def download(url, path, retries=4, quiet=False):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    tmp = path + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                done, last = 0, 0
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if not quiet and total and done - last > 25 << 20:
                        last = done
                        log(f"  {done / 1e6:.0f}/{total / 1e6:.0f} MB")
            os.replace(tmp, path)
            return path
        except Exception as ex:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))
            if not quiet:
                log(f"  riprovo download ({ex})")
    return path


def wgs84_to_lv95(lat, lon):
    """Formule approssimate swisstopo (errore ~1 m). Funziona con array numpy."""
    phi = (np.asarray(lat) * 3600 - 169028.66) / 10000
    lam = (np.asarray(lon) * 3600 - 26782.5) / 10000
    e = (2600072.37 + 211455.93 * lam - 10938.51 * lam * phi
         - 0.36 * lam * phi ** 2 - 44.54 * lam ** 3)
    n = (1200147.07 + 308807.95 * phi + 3745.25 * lam ** 2 + 76.63 * phi ** 2
         - 194.56 * lam ** 2 * phi + 119.79 * phi ** 3)
    return e, n


def seg_lengths(lon, lat):
    r = 6371008.8
    p1, p2 = np.radians(lat[:-1]), np.radians(lat[1:])
    dl = np.radians(lon[1:] - lon[:-1])
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


# ---------------------------------------------------------------------------
# 1–2. Dati di base
# ---------------------------------------------------------------------------
def get_boundary(cache):
    path = os.path.join(cache, "ticino_boundary.geojson")
    if not os.path.exists(path):
        try:
            res = http_json(BOUNDARY_URL, {
                "layer": BOUNDARY_LAYER, "searchText": "Ticino", "searchField": "name",
                "returnGeometry": "true", "geometryFormat": "geojson", "sr": 4326,
                "contains": "false",
            })
            feats = [r for r in res.get("results", [])
                     if str(r.get("properties", r.get("attributes", {})).get("name", "")).lower() == "ticino"]
            if not feats:
                raise ValueError("confine non trovato")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(feats[0]["geometry"], f)
        except Exception as ex:  # noqa: BLE001
            log(f"  ! confine swisstopo non disponibile ({ex}); uso il rettangolo del Ticino")
            return box(*TICINO_BBOX)
    with open(path, encoding="utf-8") as f:
        geom = shape(json.load(f))
    return geom.buffer(0.002)  # ~200 m di margine per le strade sul confine


# ---------------------------------------------------------------------------
# 3. Estrazione strade da OSM
# ---------------------------------------------------------------------------
def bike_allowed(tags):
    hw = tags.get("highway")
    if hw is None or tags.get("area") == "yes":
        return False
    bicycle = tags.get("bicycle", "")
    if bicycle in ("no", "dismount", "use_sidepath"):
        return False
    if tags.get("motorroad") == "yes":
        return False
    access = tags.get("access", "")
    if access in ("no", "private") and bicycle not in ("yes", "designated", "permissive"):
        return False
    if hw in BIKE_ONLY_IF_ALLOWED:
        return bicycle in ("yes", "designated", "permissive")
    if hw not in ALLOWED_HIGHWAYS:
        return False
    if hw == "service" and tags.get("service") in EXCLUDED_SERVICE:
        return False
    if hw == "track":
        # solo sterrati buoni o asfaltati: con la bici da corsa sul rullo hanno senso
        return (tags.get("tracktype") in ("grade1", "grade2")
                or tags.get("surface") in PAVED
                or bicycle in ("yes", "designated"))
    return True


def bike_oneway(tags):
    """1 = solo avanti, -1 = solo indietro, 0 = doppio senso (per le bici)."""
    if tags.get("oneway:bicycle") == "no" or tags.get("cycleway", "").startswith("opposite"):
        return 0
    ow = tags.get("oneway", "")
    if ow in ("yes", "true", "1") or (tags.get("junction") in ("roundabout", "circular") and ow != "no"):
        return 1
    if ow == "-1":
        return -1
    return 0


class RoadHandler(osmium.SimpleHandler):
    def __init__(self, bbox):
        super().__init__()
        self.bbox = bbox
        self.ways = []

    def way(self, w):
        tags = {t.k: t.v for t in w.tags} if "highway" in w.tags else None
        if not tags or not bike_allowed(tags):
            return
        refs, lons, lats = [], [], []
        for n in w.nodes:
            if not n.location.valid():
                return
            refs.append(n.ref)
            lons.append(n.location.lon)
            lats.append(n.location.lat)
        if len(refs) < 2:
            return
        x0, y0, x1, y1 = self.bbox
        if max(lons) < x0 or min(lons) > x1 or max(lats) < y0 or min(lats) > y1:
            return
        self.ways.append({
            "id": w.id,
            "refs": refs, "lon": lons, "lat": lats,
            "name": tags.get("name") or tags.get("ref") or "",
            "highway": tags["highway"],
            "surface": tags.get("surface", ""),
            "oneway": bike_oneway(tags),
        })


def extract_roads(pbf, area):
    handler = RoadHandler(area.bounds)
    handler.apply_file(pbf, locations=True, idx="flex_mem")
    shapely.prepare(area)
    kept = []
    for w in handler.ways:
        inside = shapely.contains_xy(area, np.asarray(w["lon"]), np.asarray(w["lat"]))
        if inside.any():
            kept.append(w)
    return kept


# ---------------------------------------------------------------------------
# 4. Grafo
# ---------------------------------------------------------------------------
def build_edges(ways):
    usage = {}
    for w in ways:
        for i, r in enumerate(w["refs"]):
            usage[r] = usage.get(r, 0) + (2 if i in (0, len(w["refs"]) - 1) else 1)
    edges = []
    for w in ways:
        start = 0
        n = len(w["refs"])
        for i in range(1, n):
            if i == n - 1 or usage[w["refs"][i]] > 1:
                if i > start:
                    edges.append({
                        "way": w, "src_ref": w["refs"][start], "dst_ref": w["refs"][i],
                        "lon": np.asarray(w["lon"][start:i + 1], dtype=float),
                        "lat": np.asarray(w["lat"][start:i + 1], dtype=float),
                    })
                start = i
    return edges


def resample_edge(lon, lat, step=STEP_M):
    d = np.concatenate([[0.0], np.cumsum(seg_lengths(lon, lat))])
    total = d[-1]
    if total < 0.5:
        return None
    t = np.arange(0, total, step)
    if total - t[-1] > 0.5:
        t = np.append(t, total)
    else:
        t[-1] = total
    return np.interp(t, d, lon), np.interp(t, d, lat), t


# ---------------------------------------------------------------------------
# 5. Quote swissALTI3D
# ---------------------------------------------------------------------------
def list_alti_tiles(bounds):
    """{(km_e, km_n): href} per le tessere 2 m più recenti nel bbox."""
    tiles = {}
    url = STAC_ITEMS_URL + "?" + urllib.parse.urlencode(
        {"bbox": ",".join(f"{v:.5f}" for v in bounds), "limit": 100})
    pages = 0
    while url:
        res = http_json(url)
        pages += 1
        for item in res.get("features", []):
            m = re.search(r"swissalti3d_(\d{4})_(\d{4})-(\d{4})", item["id"])
            if not m:
                continue
            year, ke, kn = int(m.group(1)), int(m.group(2)), int(m.group(3))
            for a in item.get("assets", {}).values():
                href = a.get("href", "")
                if href.endswith(".tif") and "_2_2056_" in href:
                    prev = tiles.get((ke, kn))
                    if prev is None or prev[0] < year:
                        tiles[(ke, kn)] = (year, href)
        url = next((l["href"] for l in res.get("links", []) if l.get("rel") == "next"), None)
        if pages % 10 == 0:
            log(f"  catalogo: {pages} pagine, {len(tiles)} tessere")
    return {k: v[1] for k, v in tiles.items()}


def sample_tile(path, e, n):
    with rasterio.open(path) as ds:
        arr = ds.read(1).astype("float64")
        nodata = ds.nodata
        left, top = ds.transform.c, ds.transform.f
        resx, resy = ds.transform.a, -ds.transform.e
    # bilineare sui centri dei pixel
    fx = (e - left) / resx - 0.5
    fy = (top - n) / resy - 0.5
    x0 = np.clip(np.floor(fx).astype(int), 0, arr.shape[1] - 2)
    y0 = np.clip(np.floor(fy).astype(int), 0, arr.shape[0] - 2)
    dx = np.clip(fx - x0, 0, 1)
    dy = np.clip(fy - y0, 0, 1)
    if nodata is not None:
        arr[arr == nodata] = np.nan
    arr[arr < -1000] = np.nan
    z = (arr[y0, x0] * (1 - dx) * (1 - dy) + arr[y0, x0 + 1] * dx * (1 - dy)
         + arr[y0 + 1, x0] * (1 - dx) * dy + arr[y0 + 1, x0 + 1] * dx * dy)
    return z


def elevations(all_lon, all_lat, tile_index, cache, workers, fetch=download):
    e, n = wgs84_to_lv95(all_lat, all_lon)
    ke = np.floor(e / 1000).astype(int)
    kn = np.floor(n / 1000).astype(int)
    z = np.full(len(e), np.nan)
    keys = {}
    for idx, k in enumerate(zip(ke.tolist(), kn.tolist())):
        keys.setdefault(k, []).append(idx)
    needed = [k for k in keys if k in tile_index]
    log(f"  servono {len(needed)} tessere altimetriche (su {len(keys)} toccate dalle strade)")
    tdir = os.path.join(cache, "swissalti3d")
    os.makedirs(tdir, exist_ok=True)

    def job(k):
        href = tile_index[k]
        path = os.path.join(tdir, os.path.basename(urllib.parse.urlparse(href).path))
        fetch(href, path, quiet=True)
        idx = np.asarray(keys[k])
        return idx, sample_tile(path, e[idx], n[idx])

    done = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        for idx, vals in pool.map(job, needed):
            z[idx] = vals
            done += 1
            if done % 100 == 0 or done == len(needed):
                log(f"  quote: {done}/{len(needed)} tessere")
    return z


# ---------------------------------------------------------------------------
# 6. Statistiche dei tratti
# ---------------------------------------------------------------------------
def process_profile(z, d):
    ok = ~np.isnan(z)
    if ok.mean() < 1 - MAX_MISSING_ELE:
        return None
    if not ok.all():
        z = np.interp(d, d[ok], z[ok])
    if len(z) >= SMOOTH_PTS:
        k = np.ones(SMOOTH_PTS) / SMOOTH_PTS
        pad = SMOOTH_PTS // 2
        zs = np.convolve(np.pad(z, pad, mode="edge"), k, mode="valid")
    else:
        zs = z.copy()
    # pendenza centrata su ~60 m
    half = max(1, int(round(GRADE_WINDOW_M / STEP_M / 2)))
    i = np.arange(len(zs))
    a = np.clip(i - half, 0, len(zs) - 1)
    b = np.clip(i + half, 0, len(zs) - 1)
    run = d[b] - d[a]
    with np.errstate(divide="ignore", invalid="ignore"):
        g = np.where(run > 0, (zs[b] - zs[a]) / run * 100, 0.0)
    g = np.clip(g, -MAX_GRADE, MAX_GRADE)
    dz = np.diff(zs)
    return zs, g, float(dz[dz > 0].sum()), float(-dz[dz < 0].sum())


# ---------------------------------------------------------------------------
# 7. Output
# ---------------------------------------------------------------------------
LOAD_SQL = r"""-- Carica la rete stradale del Ticino in PostGIS + pgRouting
-- Uso:  psql -d ticinoride -f load_postgis.sql   (dalla cartella out/)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

DROP TABLE IF EXISTS road_edges;
DROP TABLE IF EXISTS road_nodes;

CREATE TABLE road_nodes (
  id        bigint PRIMARY KEY,
  osm_id    bigint,
  lon       double precision,
  lat       double precision,
  ele       real,
  geom      geometry(Point, 4326)
);

CREATE TABLE road_edges (
  id            bigint PRIMARY KEY,
  source        bigint NOT NULL REFERENCES road_nodes(id),
  target        bigint NOT NULL REFERENCES road_nodes(id),
  osm_way_id    bigint,
  name          text,
  highway       text,
  surface       text,
  oneway        smallint,          -- 1 avanti, -1 indietro, 0 doppio senso (bici)
  length_m      real,
  ascent_m      real,              -- da source a target
  descent_m     real,
  avg_grade     real,              -- % da source a target
  max_grade     real,
  min_grade     real,
  cost          double precision,  -- pgRouting: metri, -1 = vietato
  reverse_cost  double precision,
  geom_wkt      text,
  geom          geometry(LineStringZ, 4326)
);

\copy road_nodes(id, osm_id, lon, lat, ele) FROM 'ticino_nodes.csv' WITH (FORMAT csv, HEADER true)
\copy road_edges(id, source, target, osm_way_id, name, highway, surface, oneway, length_m, ascent_m, descent_m, avg_grade, max_grade, min_grade, cost, reverse_cost, geom_wkt) FROM 'ticino_edges.csv' WITH (FORMAT csv, HEADER true)

UPDATE road_nodes SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326);
UPDATE road_edges SET geom = ST_GeomFromText(geom_wkt, 4326);
ALTER TABLE road_edges DROP COLUMN geom_wkt;

CREATE INDEX ON road_nodes USING gist (geom);
CREATE INDEX ON road_edges USING gist (geom);
CREATE INDEX ON road_edges (source);
CREATE INDEX ON road_edges (target);
ANALYZE road_nodes;
ANALYZE road_edges;

-- Esempio: percorso più breve tra i due incroci più vicini a Cadenazzo e al Monte Ceneri
-- WITH a AS (SELECT id FROM road_nodes ORDER BY geom <-> ST_SetSRID(ST_MakePoint(8.9479, 46.1517), 4326) LIMIT 1),
--      b AS (SELECT id FROM road_nodes ORDER BY geom <-> ST_SetSRID(ST_MakePoint(8.9130, 46.1405), 4326) LIMIT 1)
-- SELECT r.seq, e.name, e.length_m, e.avg_grade
-- FROM pgr_dijkstra('SELECT id, source, target, cost, reverse_cost FROM road_edges',
--                   (SELECT id FROM a), (SELECT id FROM b), directed => true) r
-- JOIN road_edges e ON e.id = r.edge ORDER BY r.seq;
"""


def write_outputs(edges, outdir, geojson=True):
    os.makedirs(outdir, exist_ok=True)
    node_ids, nodes = {}, []

    def node(ref, lon, lat, ele):
        if ref not in node_ids:
            node_ids[ref] = len(node_ids) + 1
            nodes.append((node_ids[ref], ref, round(lon, 7), round(lat, 7), round(ele, 1)))
        return node_ids[ref]

    total_km = 0.0
    gj = open(os.path.join(outdir, "ticino_roads.geojson"), "w", encoding="utf-8") if geojson else None
    if gj:
        gj.write('{"type":"FeatureCollection","features":[\n')
    with open(os.path.join(outdir, "ticino_edges.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "source", "target", "osm_way_id", "name", "highway", "surface", "oneway",
                    "length_m", "ascent_m", "descent_m", "avg_grade", "max_grade", "min_grade",
                    "cost", "reverse_cost", "geom_wkt"])
        first = True
        for eid, ed in enumerate(edges, start=1):
            lon, lat, z, g, d = ed["rlon"], ed["rlat"], ed["z"], ed["g"], ed["d"]
            s = node(ed["src_ref"], lon[0], lat[0], z[0])
            t = node(ed["dst_ref"], lon[-1], lat[-1], z[-1])
            length = float(d[-1])
            total_km += length / 1000
            ow = ed["way"]["oneway"]
            cost = length if ow in (0, 1) else -1
            rcost = length if ow in (0, -1) else -1
            wkt = "LINESTRING Z(" + ",".join(
                f"{x:.7f} {y:.7f} {h:.1f}" for x, y, h in zip(lon, lat, z)) + ")"
            avg = (z[-1] - z[0]) / length * 100 if length > 0 else 0
            w.writerow([eid, s, t, ed["way"]["id"], ed["way"]["name"], ed["way"]["highway"],
                        ed["way"]["surface"], ow, round(length, 1), round(abs(ed["asc"]), 1),
                        round(abs(ed["desc"]), 1), round(avg, 2), round(float(g.max()), 2),
                        round(float(g.min()), 2), round(cost, 1), round(rcost, 1), wkt])
            if gj:
                feat = {"type": "Feature", "properties": {
                    "id": eid, "name": ed["way"]["name"], "highway": ed["way"]["highway"],
                    "length_m": round(length), "ascent_m": round(ed["asc"]),
                    "max_grade": round(float(g.max()), 1)},
                    "geometry": {"type": "LineString", "coordinates": [
                        [round(x, 6), round(y, 6), round(h, 1)] for x, y, h in zip(lon, lat, z)]}}
                gj.write(("" if first else ",\n") + json.dumps(feat, ensure_ascii=False,
                                                              separators=(",", ":")))
                first = False
    if gj:
        gj.write("\n]}\n")
        gj.close()

    with open(os.path.join(outdir, "ticino_nodes.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "osm_id", "lon", "lat", "ele"])
        w.writerows(nodes)
    with open(os.path.join(outdir, "load_postgis.sql"), "w", encoding="utf-8") as f:
        f.write(LOAD_SQL)
    stats = {"edges": len(edges), "nodes": len(nodes), "road_km": round(total_km, 1),
             "max_elevation": round(max(float(e["z"].max()) for e in edges), 1) if edges else None,
             "min_elevation": round(min(float(e["z"].min()) for e in edges), 1) if edges else None,
             "sources": {"roads": "© OpenStreetMap contributors (ODbL)",
                         "elevation": "© swisstopo swissALTI3D 2 m",
                         "boundary": "© swisstopo swissBOUNDARIES3D"}}
    with open(os.path.join(outdir, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
    return stats


# ---------------------------------------------------------------------------
def run(pbf, area, outdir, cache, workers, geojson=True, tile_index=None, fetch=download):
    log("Estraggo le strade dal file OSM (qualche minuto)…")
    ways = extract_roads(pbf, area)
    log(f"  {len(ways)} strade nel Ticino")
    edges = build_edges(ways)
    log(f"  {len(edges)} tratti tra incroci")

    for ed in edges:
        r = resample_edge(ed["lon"], ed["lat"])
        ed["r"] = r
    edges = [e for e in edges if e["r"] is not None]
    counts = [len(e["r"][0]) for e in edges]
    all_lon = np.concatenate([e["r"][0] for e in edges])
    all_lat = np.concatenate([e["r"][1] for e in edges])
    log(f"  {len(all_lon):,} punti ogni {STEP_M:.0f} m")

    if tile_index is None:
        log("Leggo il catalogo swissALTI3D…")
        tile_index = list_alti_tiles(area.bounds)
    log("Scarico e campiono le quote…")
    z_all = elevations(all_lon, all_lat, tile_index, cache, workers, fetch=fetch)

    kept, pos, dropped = [], 0, 0
    for ed, c in zip(edges, counts):
        z = z_all[pos:pos + c]
        pos += c
        rlon, rlat, d = ed["r"]
        res = process_profile(z, d)
        if res is None:
            dropped += 1
            continue
        ed.update(rlon=rlon, rlat=rlat, d=d, z=res[0], g=res[1], asc=res[2], desc=res[3])
        kept.append(ed)
    log(f"  {dropped} tratti scartati perché senza quota (fuori dalla Svizzera)")
    log("Scrivo i file…")
    return write_outputs(kept, outdir, geojson=geojson)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--out", default="out")
    ap.add_argument("--workers", type=int, default=4, help="download paralleli (default 4)")
    ap.add_argument("--pbf", help="usa un file .osm.pbf già scaricato")
    ap.add_argument("--no-geojson", action="store_true")
    a = ap.parse_args()

    os.makedirs(a.cache, exist_ok=True)
    pbf = a.pbf or os.path.join(a.cache, "switzerland-latest.osm.pbf")
    if not a.pbf:
        log("Scarico OpenStreetMap Svizzera (Geofabrik)…")
        download(PBF_URL, pbf)
    log("Confine del Canton Ticino…")
    area = get_boundary(a.cache)
    stats = run(pbf, area, a.out, a.cache, a.workers, geojson=not a.no_geojson)
    log(f"Fatto: {stats['road_km']:,} km di strade, {stats['edges']:,} tratti, "
        f"{stats['nodes']:,} incroci, quota {stats['min_elevation']}–{stats['max_elevation']} m")
    log(f"File in ./{a.out}/  — carica in Postgres con:  cd {a.out} && psql -d ticinoride -f load_postgis.sql")


if __name__ == "__main__":
    main()
