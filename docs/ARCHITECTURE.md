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
