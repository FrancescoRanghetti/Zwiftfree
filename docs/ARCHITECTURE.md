# Architecture

```
 Browser (Chrome/Edge desktop, Chrome Android)
 ┌──────────────────────────────────────────────────────────────┐
 │ Angular 22 SPA (standalone, signals, OnPush, zoneless)        │
 │  devices/  Web Bluetooth: FTMS, FE-C, HR, simulator           │──▶ Tacx trainer, Garmin HR strap
 │  physics/  10 Hz virtual-speed model, route follower          │
 │  avatar/   state machine + SVG animations                     │
 │  features/ home, ride, routes, stats, history, account, ...   │
 └───────────────┬──────────────────────────────────────────────┘
                 │ HTTPS /api (REST, JSON, JWT)   /ws (STOMP)
 ┌───────────────▼──────────────────────────────────────────────┐
 │ nginx (frontend container): static SPA + reverse proxy        │
 └───────────────┬──────────────────────────────────────────────┘
 ┌───────────────▼──────────────────────────────────────────────┐
 │ Spring Boot 4.1 (Java 25)                                     │
 │  auth/ user/ route/ ride/ stats/ live/ common/                │
 │  MVT tiles via ST_AsMVT, routing via pgr_dijkstra             │
 └───────────────┬──────────────────────────────────────────────┘
 ┌───────────────▼──────────────────────────────────────────────┐
 │ PostgreSQL 17 + PostGIS 3.7 + pgRouting 4.0                   │
 │  Flyway-managed app schema  +  road_nodes/road_edges (import) │
 └──────────────────────────────────────────────────────────────┘
```

Key principles:

- **The backend never talks to sensors.** All Bluetooth I/O happens in the browser; the backend only receives
  recorded samples (in 30 s batches) and events.
- **Virtual speed is computed client-side** from power and the road grade (physics model), not read from the
  trainer.
- **The road network is data, not schema**: `road_nodes`/`road_edges` are (re)built by the import job from
  `data/out/`, so app tables reference edges by id without foreign keys.

## Versions (verified 2026-11-15)

| Component | Version |
|---|---|
| Java (build/runtime) | 25 LTS (Temurin images); compiles locally with JDK 25+ |
| Spring Boot | 4.1.2 (Spring Framework 7.0, Security 7.1, Hibernate 7.4, Flyway 12.4) |
| springdoc-openapi | 3.2.0 |
| Testcontainers | 2.0.5 |
| PostgreSQL / PostGIS / pgRouting | 17 / 3.7 / 4.0.2 (built from `db/Dockerfile` with the PGDG packages) |
| Node.js | 26 LTS (Angular CLI needs ≥ 24.15) |
| Angular / Angular Material | 22.2 |
| TypeScript | 6.0 |
| Vitest | 5.1 |
| MapLibre GL JS | 6.18 (milestone 3) |
| CesiumJS | 1.147.0 (3D phase A; npm `latest` verified 2026-11-16) |
| ECharts / ngx-echarts | 6.1 / 22.0 (milestone 3) |
| Playwright | 1.65.1 (end-to-end tests) |
| @stomp/stompjs | 7.5.0 (live WebSocket, lazy) |
| Garmin FIT SDK | 21.221.0 (.FIT export) |
| nginx | stable-alpine |

## Repository layout

```
backend/Zwiftfree-be/   Spring Boot (package ch.zwiftfree.{auth,user,route,ride,stats,live,common})
frontend/zwiftfree-fe/  Angular (src/app/{core,devices,physics,avatar,features,shared})
data/                   scarica_ticino.py + out/ (generated road network, not committed)
docs/                   ARCHITECTURE.md, DECISIONS.md, API.md
docker-compose.yml      db, backend (imports the road network at startup), frontend
```

## The ride loop (milestones 4–5)

```
 FtmsTrainer | FecTrainer | SimulatorTrainer ──power/cadence──┐   ◀── grade (setSimulation, ≤ 1/s)
 HeartRateMonitor | SimulatorHeartRate ──hr──────────────────┐ │
                                                             ▼ ▼     ┌── RideMap (MapLibre, every animation frame:
                                                                     │   interpolated position, camera follow)
 RideSession (features/ride) ── setInterval 10 Hz ──▶ RideEngine (physics/, framework-free)
   │  HUD signals, profile, toasts      │              ├─ physics.ts   speed from power, grade, altitude
   │                                    │              ├─ course.ts    legs of road in metres, 60 m grade window
   │                                    │              ├─ junctions.ts turn choices (same rules as the backend)
   │                                    │              └─ road-graph.ts edges around the rider (/api/roads/area)
   │  1 sample/s, ridden edges ◀────────┘
   ▼
 RideUploader (core/ride) ── IndexedDB queue ── POST /api/rides/{id}/samples every 30 s, /events, /complete
```

The engine is pure TypeScript driven by `tick(dt)`, so the whole ride (junctions, turnaround, finish, samples) is
unit-tested with synthetic time. The backend computes the summary (NP, IF, TSS, …) from the stored samples and
adds the ridden edges to `user_explored_edges` when the ride is completed.

## Ride view 3D (phase A)

CesiumJS is a second renderer of the existing ride state. `RideEngine` and `Course` remain the source of
position, elevation, grade and travel direction. The map remains the default. Settings store `MAP_2D`,
`THIRD_PERSON` or `FIRST_PERSON`, head bob (off by default) and `LOW` / `MEDIUM` / `HIGH` quality (medium by
default). The ride screen can temporarily cycle views with its button or **V**, without writing settings.
The shared HUD, avatar panel, profile, junction controls and trainer controls stay outside either renderer.

Cesium is imported dynamically only when a 3D view is selected. Its `Workers`, `Assets`, `ThirdParty` and
`Widgets` directories are served under `/cesium/` by Angular's asset copying and the same nginx static-file
root used for the SPA. `CESIUM_BASE_URL` points there before the import. No default base layer, geocoder,
Cesium ion terrain, ion assets or token is used. The initial Angular budget remains 800 kB warning / 1.5 MB
error; Cesium's lazy bundle and static assets are additional downloads on first 3D use.
The production build keeps the initial bundle at about **679 kB**; Cesium is a separate **5.19 MB** lazy
chunk (about **1.07 MB** estimated compressed transfer). Widget CSS is loaded from the local asset directory
on first 3D entry. nginx serves JavaScript workers and WebAssembly with their explicit MIME types, returns
404 for missing assets, and revalidates these unhashed assets on application upgrades.

The phase-A cyclist in the scene is an original rear-view SVG billboard using the account's jersey, helmet
and bicycle colors. The existing animated avatar panel remains the source of crash and break animations
until the glTF animation work in phase B. Head bob follows the integrated real cadence at half its rhythm.

### Hosted data sources

Verified on **2026-11-16** against the official service documentation and live metadata. Only manifests and
GetCapabilities were read during verification, without downloading geographic tile payloads. The metadata
endpoints below returned HTTP 200 with `Access-Control-Allow-Origin: *` for a localhost origin.

| Content | Endpoint / template | Verified metadata |
| --- | --- | --- |
| Terrain derived from swissALTI3D | `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/` (`layer.json`) | Quantized Mesh 1.0, EPSG:4326, TMS, zoom 0–18; publication `20250101`, version `1.43646.0`; metadata and oct-encoded vertex normals available |
| SWISSIMAGE background | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg` | JPEG; EPSG:3857 matrix set `3857_20`, zoom 0–20; WGS84 bounds `[5.140242, 45.398181, 11.47757, 48.230651]` |
| swissBUILDINGS3D | `https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json` | 3D Tiles 1.0 manifest; resolve child URLs from the manifest |
| Vegetation (available for a later phase) | `https://3d.geo.admin.ch/ch.swisstopo.vegetation.3d/v1/tileset.json` | Public 3D Tiles 1.0 manifest; hosted trees exist, so generation is not required for an online first version |

The capabilities source is
[`WMTSCapabilities.xml` (EPSG:3857)](https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml).
Do not equate a 10 cm source orthophoto with uniform 10 cm displayed ground resolution: resampling, zoom,
location and the source imagery determine the delivered detail. Coverage outside Switzerland uses different
background imagery and is not a target of this ride view.

Service references: [terrain](https://docs.geo.admin.ch/visualize-data/terrain-service.html),
[3D Tiles](https://docs.geo.admin.ch/visualize-data/3d-tiles.html),
[WMTS](https://docs.geo.admin.ch/visualize-data/wmts.html), and the map viewer's
[Cesium configuration](https://github.com/geoadmin/web-mapviewer/blob/develop/packages/mapviewer/src/config/cesium.config.js).

### Terms, resource use and remaining validation

The [swisstopo OGD terms](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices)
permit reuse, modification, distribution and commercial use, with source attribution **© swisstopo**.
Services require no registration. The
[FSDI operating conditions](https://www.geo.admin.ch/en/general-terms-of-use-fsdi) apply: moderate use,
no high-intensity scraping, and no guaranteed availability. The published fair-use guideline includes web
applications averaging 20,000 users per day; this is not an unlimited requests-per-second allowance. Contact
swisstopo before higher usage. Offline datasets belong in the download pipeline, not a scraper of rendering
services. Follow the [current API guidance](https://docs.geo.admin.ch/get-started/overview.html) for HTTP
429 (back off) and 403 (stop). Phase A streams only tiles requested for rendering and does not generate or
download offline datasets.

WebGL2 is required for the 3D renderer. Unsupported contexts, renderer initialization failures and sustained
low frame rate (below 25 fps for ten consecutive seconds) return the ride to the map with an Italian warning.
Frame-rate history resets when the tab is hidden. Because MapLibre 6 also needs WebGL2, the ride map has a
DOM/SVG raster recovery renderer: it follows the same position, displays the planned/ridden track and turns,
and requests only the visible WMTS tiles. It is used when no WebGL2 context can be created or the map loses
its context. It has a fixed zoom and no manual pan; the normal 2D experience remains MapLibre.
A physical Tacx Flux-2 ride and the target
60 fps on a recent laptop require manual validation; automated simulator checks cannot establish either.
Further realism (asphalt, a fully animated 3D rider, tunnels, trees and route prefetch) and offline hosting
remain separate phases B–D.

### Phase A verification (2026-11-16)

- Backend `spotless:apply verify`: 84 tests passed, including settings validation, persistence and PostgreSQL
  migration/check constraints with Testcontainers.
- Frontend: 185 tests passed; ESLint and Prettier checks passed. Camera tests cover route look-ahead, slopes,
  shortest-angle damping, vertical FOV, terrain clearance and head bob. Renderer lifecycle tests exercise a
  successful initialization before forcing errors and verify teardown during pending work.
- Four Playwright tests passed against the production Docker stack using installed Chrome. They cover both
  saved 3D modes, pre-ride and live view switching, simulator HUD/pause, canvas framing above the profile,
  initialization failure and the non-WebGL raster map. The normal paths assert zero console/JavaScript
  errors, no ion access and no unexpected geographic requests.
- Browser fixtures replace all geographic tile payloads with synthetic local terrain, imagery and an empty
  building tileset. This verifies renderer integration and resource serving, not the accuracy or appearance
  of real swisstopo content. QA screenshots are intentionally synthetic; real-landscape screenshots,
  datum/alignment checks, physical-trainer acceptance and real-GPU performance remain outstanding.
