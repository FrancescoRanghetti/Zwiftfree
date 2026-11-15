-- Carica la rete stradale del Ticino in PostGIS + pgRouting
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
