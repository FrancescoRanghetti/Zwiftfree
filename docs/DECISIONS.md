# Decisions

Choices not fixed by the spec, the simplest option that works, and why.

## Repository and build

- **Folder names.** The project keeps the folders created by the user (`backend/Zwiftfree-be`,
  `frontend/zwiftfree-fe`) instead of the spec's flat `backend/` and `frontend/`; the Java base package follows the
  spec (`ch.zwiftfree`).
- **Java 25 LTS** as release target. JDK 27 is installed locally and compiles `--release 25` fine; Docker images
  use Temurin 25. 27 is not LTS and some tooling lags behind it.
- **No Lombok.** DTOs are Java records; entities are plain classes. Lombok tends to break on new JDKs.
- **Spotless uses the Eclipse JDT formatter** (`eclipse-formatter.xml`), not google/palantir-java-format: those
  rely on javac internals and fail on JDK 27. `spotless:check` runs in `mvn verify`.
- **Testcontainers + OrbStack.** Testcontainers ignores Docker contexts; the `orbstack` Maven profile (activated
  automatically when `~/.orbstack/run/docker.sock` exists) sets `DOCKER_HOST` for Surefire.
- **Frontend regenerated with Angular 22.** The previous Angular 19 SSR scaffold was replaced: SSR is useless
  here (Web Bluetooth and MapLibre are browser-only) and nginx serves the static build.
- **Node 26 LTS.** Homebrew's Node was upgraded from 24.1 to 26 because Angular CLI 22 needs ≥ 24.15.
- **`data/out/` is not committed** (~50 MB, regenerable). It is mounted into the import job from milestone 3.

## Runtime

- **Host ports** default to 5442 (db), 8090 (backend), 4280 (frontend) because 5433/8080–8082/3000 are already
  in use on the dev machine. All configurable in `.env`.
- **Backend healthcheck** uses bash `/dev/tcp` because the Temurin JRE image has neither curl nor wget.
- **Flyway V1 creates the whole app schema** of spec §4 at once (plus `corner_assist_enabled` in
  `user_settings` and `created_at` in `refresh_tokens`), so later milestones only add tables (e.g. `places`).
  Columns that reference `road_edges` have no FK because the import job drops and recreates that table.
- **Errors**: `spring.mvc.problemdetails.enabled=true` plus a `@RestControllerAdvice` so every error is an
  RFC 9457 `ProblemDetail`.

## Frontend

- **i18n**: a tiny signal-based `I18nService` + `t` pipe with typed dictionaries
  (`core/i18n/translations.it.ts`, `translations.de.ts`, Italian fallback). Chosen over `@angular/localize`
  (one build per locale, no runtime switch) and over Transloco (extra dependency for a handful of strings).
- **Dark theme** by default via Material 3 `theme-type: dark`, orange primary / green tertiary.
- **Component naming** follows the Angular 20+ style guide (`HomePage`, `Shell`, files without `.component`).

## Authentication (milestone 2)

- **JWT with Spring Security's own resource server** (Nimbus, HS256), no extra JWT library. Access token 15 min,
  subject = user id. `JWT_SECRET` (≥ 32 bytes) comes from the environment; if missing in development a random key
  is generated with a warning (tokens then die on restart). Docker compose refuses to start without it.
- **Refresh tokens are opaque** 256-bit random strings; only their SHA-256 is stored. 30 days, rotated on every
  use. A token is marked revoked *only* by rotation, so presenting a revoked token means replay/theft and every
  session of that user is revoked. Logout and password change **delete** tokens instead, so replaying a
  logged-out token does not punish the user's other devices.
- **Password hashing: BCrypt (cost 12).** Argon2 would need Bouncy Castle; BCrypt is in Spring Security already.
  A dummy hash is checked for unknown emails so response time does not reveal which emails exist.
- **Emails are stored lower-cased** (plus the `citext` column) because JDBC binds parameters as `varchar`, which
  would make `citext = varchar` comparisons fall back to case-sensitive `text`.
- **Email cannot be changed** from the account page (no verification flow yet); display name can.
- **Login rate limit**: in-memory sliding window, 5 failures per email and 20 per IP in 15 minutes → `429` with
  `Retry-After`. Single-instance only; behind nginx the IP comes from `X-Forwarded-For`
  (`forward-headers-strategy: framework`). Anyone hitting port 8090 directly could spoof that header, so the
  per-email limit is the real guarantee.
- **Deleting an account** requires the password and relies on `ON DELETE CASCADE` for every owned row.
- **Errors**: field validation errors come back as `ProblemDetail` with an `errors: {field: message}` map, with
  Italian messages; the frontend copies them onto the matching form controls.

## Frontend auth

- **Tokens in `localStorage`** (key `zf.auth`), shared by all tabs. With rotating refresh tokens, per-tab storage
  would make two tabs replay each other's tokens and trigger theft detection. Refresh is single-flight inside a tab
  and serialized across tabs with the Web Locks API: a tab first checks whether another tab already refreshed.
  The trade-off (tokens readable by injected script) is the same as for any SPA bearer-token setup; Angular's
  template escaping and the absence of `innerHTML` keep the XSS surface small.
- `provideAppInitializer` restores the session before the first navigation so route guards see it.
- **Settings page edits `units`** although it lives in `user_profiles` (spec §4 vs §9): the page sends the
  current profile with only `units` changed.
- **Remembered Bluetooth devices** live in `localStorage`, not the server: Web Bluetooth device ids are only
  meaningful inside the browser that paired them.
- The avatar preview is an original SVG drawing (`avatar/avatar-preview.ts`), reused and animated in milestone 6.

## Road network (milestone 3)

- **Database image built locally** (`db/Dockerfile`: `postgres:17` + PGDG `postgis-3` 3.7 and `pgrouting` 4.0).
  The published `pgrouting/pgrouting` images are amd64-only and run emulated on Apple Silicon. Compose and
  Testcontainers build the same Dockerfile, so tests run on exactly the production database.
- **Import runs inside the backend** (an `ApplicationRunner` after Flyway, `ROAD_IMPORT=true` by default) instead
  of a separate container: a one-shot container would create `road_*` tables before Flyway's first run, and Flyway
  refuses a non-empty schema without history. `load_postgis.sql` is executed as-is: plain statements over JDBC and
  psql `\copy` lines through the PostgreSQL COPY API. Everything happens in one transaction (~6 s for 57 508
  edges). It re-runs when `sha256(stats.json + processing version)` changes; bump
  `RoadImportService.PROCESSING_VERSION` when post-processing changes.
- **Post-processing** adds `rank` (road importance), `geom_3857`, `steepest` (for colouring), connected components
  on `road_nodes` (`routable` = main component) and the materialized view `road_edges_display` (simplified,
  rank ≤ 6) for low zooms.
- **Snapping only to the main connected network**: the nearest junction to a click can sit on an isolated fragment
  (private yard, broken OSM way); routing from there fails. With components, every waypoint snaps to a junction
  from which the rest of Ticino is reachable.
- **Vector tiles from Spring (`ST_AsMVT`), not Martin**: one container less, the import already owns the tables,
  and tiles can be invalidated together with the import. Tiles are public, cached in memory (Caffeine, 4000 tiles)
  and sent with `Cache-Control: public, max-age=86400`. Zoom < 9 shows only main roads, < 13 uses the
  simplified view.
- **Planner**: `pgr_dijkstra` on a bounding box around each leg (~11 km margin, widened to 33 km and then the
  whole graph if no path is found). Profiles (direction-aware, one-ways stay `-1`):
  `SHORTEST` = length; `AVOID_CLIMBS` = length·(1 + uphill%/2) where uphill% = 100·ascent/length in the travel
  direction; `SEEK_CLIMBS` = length/(1 + min(uphill%, 15)/2); `QUIET` = length × 4 trunk, 2.5 primary,
  1.4 secondary, 1.5 track. **Loop**: a return leg to the start where already used edges cost ×6.
- **Route max grade** is measured over 200 m of the 50 m profile and ignores windows steeper than 30 %: 10 m
  samples are noisy, and in tunnels/galleries the terrain model gives the mountain above the road (Leventina
  showed 65 %). Map colours still use the per-edge `steepest` value from the data.
- **Routes keep their own geometry** (`routes.geom`), so a saved route still displays after a re-import even if
  edge ids changed. Official routes are recomputed after every import; if one cannot be computed it is logged as a
  warning and skipped.
- **Climb detection** (`ClimbDetector`, in memory, ~0.3 s for Ticino): follows uphill edges (≥ 1 %) from junction
  to junction preferring the same road name, then the most important road, then the steepest; trims flat ends
  (< 3 %); keeps climbs with average > 4 %, length > 800 m, gain > 50 m; drops climbs sharing more than half their
  edges with a bigger one. Only roads with rank ≤ 7 (no service roads, tracks or paths). Name: "Salita <road> –
  <nearest locality to the top>". Each official route also becomes a segment (CLIMB if ≥ 3 % average, else SPRINT).
- **Localities** come from OpenStreetMap `place=city|town|village|hamlet` inside the Ticino boundary
  (909 places), extracted by `data/estrai_localita.py` from the files `scarica_ticino.py` already downloaded and
  committed as the Flyway migration `V3__places_seed.sql`. Search is accent-insensitive (`unaccent`).
- **Jackson 3** (Spring Boot 4) fails on a missing JSON field mapped to a primitive (e.g. `"loop"`);
  `spring.jackson.deserialization.fail-on-null-for-primitives=false` restores the lenient behaviour.
- **Package split**: `road` = network, tiles, planner, places, segments; `route` = saved routes and official routes.

## Map (frontend)

- MapLibre GL 6 is loaded lazily; its web worker is copied to `/maplibre/` by `angular.json` and registered with
  `setWorkerUrl` (bundlers cannot follow MapLibre's own worker URL). nginx serves `.mjs` as JavaScript.
- swisstopo WMTS raster `ch.swisstopo.pixelkarte-farbe` (EPSG:3857) below the road vector tiles; attribution
  "© swisstopo · © OpenStreetMap contributors" always visible.
- Click behaviour: on the **Pianifica** tab a click adds a waypoint (start, finish, then intermediate points before
  the finish; markers are draggable) and right-click inspects a road; on **Percorsi salvati** a click inspects.
- The elevation profile (ECharts, tree-shaken, lazy) is coloured by grade with ranges on the distance axis, because
  ECharts can only colour a line along an axis dimension.
- "Pedala questo percorso" / "Giro libero da qui" hand the choice to the ride screen through `RideIntentService`
  (plus `?route=` / `?free=lat,lon` so a reload keeps it). The ride itself is milestone 4.

## Simulator ride (milestone 4)

### Physics
- **The spec's formula, unchanged** (`physics/physics.ts`): gravity, rolling (Crr), air (½ρCdA·v², ρ = 1.2·e^(−ele/8400)),
  mass = rider + bike + 0.5 kg of wheel inertia, `v_min` = 0.5 m/s in P/v. With the spec defaults (75 + 8 kg,
  CdA 0.32, Crr 0.004) it gives **34.5 km/h at 200 W on the flat** and **14.4 km/h at 250 W on 7 %**, a bit above
  the spec's "~32–34" and "~12–13". Those targets are not reachable with the spec's own formula and defaults
  (12.5 km/h at 7 % would need ~99 kg), so the formula wins; the tests check 32–35 / 12–15 km/h and the exact
  power balance. No drivetrain loss is modelled.
- Rolling resistance only acts while moving (a bike standing still is not pushed backwards); speed never goes
  below 0 (no rolling back on climbs). Hard cap 80 km/h; drag alone keeps steep descents around 70–75 km/h.
- **10 Hz with `setInterval` + real delta time, rendering with `requestAnimationFrame`.** rAF stops in background
  tabs, and the ride must go on when the window is hidden (trainer, second screen). Throttled timers are caught up
  in 0.1 s steps (max 60 s). The map interpolates the position between ticks every animation frame.
- **Grade** for physics and trainer: elevation difference over a 60 m window centred on the rider, crossing into
  the next road when needed.

### Course and junctions
- **Course model** (`physics/course.ts`): the road as legs (whole edges, or parts of one at the start of a free ride
  and at a turnaround) measured in metres from the start. Planned routes need the edge boundaries, so
  `POST /api/roads/plan` and `GET /api/routes/{id}` now return `edgeStartsM`. A saved route whose edges no longer
  match the network (re-import) is still rideable as one leg without edge ids (no explored roads for it).
- **Free ride** loads every edge within 2 km (`/api/roads/area`) and again when the rider gets within 1 km of the
  edge of what is loaded. Turn choices are computed in the browser with the same rules as the backend's
  `JunctionService` (straightest, same/more important road, same name; never against a one-way; dead end = U-turn),
  150 m before the junction. The preferred choice is appended right away (and replaced if the rider picks another
  one), so the 60 m grade window and the trainer already "see" the road after the junction.
- A free ride starts on the nearest road, in the legal direction; on a two-way road towards its longer part.
- **Keys**: the spec gives ↑ both to "+10 W" and to "straight on". ↑ means straight on while turn arrows are shown,
  +10 W otherwise; ↓ is always −10 W, `+`/`-` always change power, ← → pick the leftmost/rightmost way.
- **Giro di boa**: immediate U-turn on the current road (disabled on one-ways). On a planned route the rider then
  rides back to the start on the same roads; if one of them is a one-way the ride continues as a free ride.
- Planned rides load the roads around the rider too, for the road name and the one-way check of the turnaround.

### Recording and upload
- The **ride clock** starts at the first pedal stroke and stops while paused; `t` of a sample is that clock, so a
  pause is neither elapsed nor moving time. A future pee break keeps the clock running (elapsed, not moving).
  Moving time = seconds at ≥ 1 km/h.
- One sample per second: power and cadence averaged over the second, position at its end. Ascent = sum of
  positive elevation differences between samples (same rule in the HUD and on the backend).
- **Upload queue** (`core/ride/ride-uploader.service.ts`): every 30 s block is stored in IndexedDB first, then sent
  in order. Network errors, 5xx and 401 keep it for a retry (15 s timer, `online` event, next app start); other 4xx
  drop it (ride deleted or already completed). Samples are upserted on `(ride, t)` and edges on `(ride, seq)`;
  events carry a client UUID, so every request can safely be sent twice. When the backend is unreachable at the end,
  the completion itself is queued.
- Rides shorter than 10 s are deleted instead of saved. A ride left in progress (tab closed) keeps its samples and is
  completed from its page in the history; nothing marks rides ABANDONED automatically yet.
- **Summary on the backend** at completion (`RideMetrics`): distance, times, ascent, average/max power, NP (30 s
  rolling, 4th power), IF = NP/FTP, TSS = elapsed·NP·IF/(FTP·3600)·100, HR (zeros ignored), cadence (zeros ignored),
  average speed over moving time, kJ. Records, power curve and segment efforts are milestone 7.

### Explored roads
- An edge counts as explored as soon as the rider enters it; the share is by length over the whole network.
  Completing a ride adds its edges (once per ride), deleting a completed ride removes them again unless they were
  ridden in another ride. Edge ids come from the imported data: after a re-import with different ids old explored
  edges simply stop matching.
- Shown as a GeoJSON overlay from `/api/me/explored` ("Strade esplorate" in the map legend), because the vector
  tiles are public and cached for everyone.

### Ride screen
- Simulator only in this milestone: the Bluetooth buttons are visible but disabled until milestone 5. The simulated
  heart rate follows power with a ~25 s lag (resting at 0 W, ~90 % of max HR at FTP). The grade that would go to
  the trainer is already computed as the spec says (× difficulty, descents capped at −5 %, 0 % when paused) and
  shown in the simulator panel.
- HR zones by % of max HR (< 60, 60–70, 70–80, 80–90, ≥ 90); max HR from the profile, else 220 − age, else 190.
- "Next locality": all ~900 places are loaded once (`/api/places/all`). On a route, the next place within 400 m of
  the route ahead (distance along the route); in free ride, the nearest place within ±45° of the heading
  (straight-line distance).
- Climb toasts ("Salita …: 4.2 km al 6.1%" and the time at the top) use the segments of the ridden route; free
  rides have none yet.
- The avatar box shows the static rider and the state name; animations are milestone 6. The screen is kept awake
  with the Wake Lock API when available.
- Dates and numbers use the `it-CH` locale. Maps embedded in scrolling pages (ride summary) use MapLibre's
  cooperative gestures (Ctrl/⌘ + wheel to zoom).

## Hardware (milestone 5)

- **Layers** (`frontend/.../devices/`): `ble/*-protocol.ts` are pure byte encoders/decoders (FTMS Indoor Bike Data
  and Control Point, ANT+ FE-C pages, Heart Rate Measurement), unit-tested with byte fixtures; `ble/*-trainer.ts`
  and `heart-rate-monitor.ts` drive GATT; `DeviceManager` pairs, remembers and owns the devices. Tests run against
  an in-memory fake GATT (`ble/fake-ble.ts`), since no trainer is available to the CI.
- **FTMS first, FE-C only without FTMS**: the chooser accepts devices advertising FTMS (0x1826), the Tacx FE-C
  service, or a name starting with "Tacx" (old Tacx units do not always advertise the FE-C UUID). After connecting,
  FTMS is used if the trainer has it, otherwise FE-C.
- **FTMS control**: Request Control (0x00), then Start/Resume (0x07), then Set Indoor Bike Simulation (0x11) with
  wind 0, the grade, the rider's Crr and Cw = ½·1.2·CdA. Requests are serialized and each waits for its 0x80
  indication (3 s timeout). A trainer that refuses control (another app holds it) fails the connection with a clear
  message.
- **FE-C**: page 51 (track resistance: grade with −200 % offset in 0.01 %, Crr in 5·10⁻⁵) as an acknowledged ANT
  message; power and cadence from page 25, speed from page 16, merged into one reading.
- **Grade to the trainer**: at most once per second and only when it changes by more than 0.1 % (latest value
  wins), × trainer difficulty, descents capped at −5 %, 0 % while paused and at the end of the ride. After a
  reconnection the last grade is sent again. The avatar physics always uses the real grade and its own virtual speed,
  never the trainer's speed.
- **Reconnection**: when the link drops without the user asking, 3 attempts after 1, 3 and 6 s; status
  `connecting` (yellow dot) meanwhile, `error` (red) after the third failure. During a ride a toast says when the
  trainer drops and when it is back. Trainer data older than 3 s counts as 0 W / 0 rpm (heart rate after 6 s), so a
  dead trainer does not keep the avatar going.
- **Which source a ride uses**: a Bluetooth trainer that is connected (or reconnecting) when the ride starts →
  mode `TRAINER`; otherwise the simulator → mode `SIMULATOR`. Heart rate comes from the Bluetooth strap if
  connected; the simulated heart rate is only used together with the simulated trainer. Bluetooth devices stay
  connected between rides.
- **Remembered devices** (`localStorage`, per browser): reconnecting them without the chooser needs
  `navigator.bluetooth.getDevices()` (Chrome with the new permissions backend); where it is missing the
  "Ricollega" buttons are hidden and the chooser is used. "Dimentica" in the settings also revokes the browser
  permission (`BluetoothDevice.forget()`) where supported.
- **Bundle size**: the Bluetooth classes and the upload queue are loaded on demand (dynamic `import()`), keeping the
  initial bundle at 799 kB, just under the 800 kB budget.
- **Not verified on real hardware here**: the FTMS and FE-C byte formats follow the Bluetooth SIG FTMS 1.0 and
  ANT+ FE-C specifications and are tested against fixtures and a fake trainer (also injected into the running app),
  but no physical Tacx or Garmin device was available during development.

## Avatar (milestone 6)

- **State machine** (`avatar/avatar-machine.ts`, pure, random source injectable): IDLE → RIDING on power;
  RIDING → COASTING when power and cadence are 0; COASTING → RIDING when pedalling; COASTING → PEE_BREAK after
  `pee_break_after_seconds` at virtual speed 0 (only if enabled); PEE_BREAK → RIDING when pedalling;
  RIDING/COASTING → CRASHED → (3 s) RECOVERING → (pedalling, penalty over) RIDING; any → PAUSED → back to the
  state it came from. The ride engine adds FINISHED at the end of a route.
- **Crash conditions** (`CRASH_RULES`, only with "Cadute" enabled; each rule rolls once per occurrence):
  1. *Hard braking*: speed > 35 km/h, grade < −6 %, power drops to 0 W and cadence below 10 rpm, while within the
     last second power was > 150 W at > 40 rpm → 30 %. A slow stop (legs spinning down over more than 1 s) does not
     count.
  2. *Bend too fast*: bend radius < 25 m (circle through the track points 10 m before and after the rider — this
     includes sharp turns at junctions) at > 45 km/h → 50 %, once per bend.
  3. *Random*: 1 in 2000 per second, only above 10 km/h and on grades below +1 % ("never uphill").
- **After a crash** the rider stays down 3 s and the total stop lasts a random 5–10 s penalty; then pedalling gets
  them back on. The bike does not move while CRASHED/RECOVERING; the trainer gets 0 % right away (also during the
  pee break, since the rider is off the bike). Event `CRASH` carries `{ reason, speedKmh, grade }`, `RECOVERED`
  carries `{ downS }`.
- **Pee break**: the bike stops for the whole break and for 1.5 s while the rider climbs back on. The ride clock keeps
  running (elapsed time) but speed is 0 (not moving time). Events `PEE_BREAK_START` / `PEE_BREAK_END { durationS }`.
  The backend counts `pee_breaks` and `crashes` from the events at completion (already in milestone 4).
- **Corner assist** (setting): the tightest bend in the next 40 m sets a safe speed √(4.5 m/s² · r) (38 km/h at
  25 m), braking at up to 6 m/s², so a bend crash cannot happen. It slows the virtual bike only; nothing changes on the
  trainer.
- **Animations** in CSS on the original SVG rider (`avatar/avatar-rider.ts`): legs and crank follow the real cadence
  (one cycle = 60/rpm s), bob while pedalling; pee break = bike leaning, a helmet peeking over a bush, 💧 bubble,
  timer "Pausa pipì 0:12"; crash = bike skids, rider tumbles forward onto the road, stars and "ahia!", the map shakes
  for 0.6 s and a banner says "Sei caduto! Rialzati tra N s…" then "Pedala per rialzarti"; pause = greyed rider.
  `prefers-reduced-motion` stops the loops. On the map the marker shows 💧 / ✦ and turns red when down.
- No sound effects yet: `audio_enabled` is stored but unused.

## Statistics (milestone 7)

- **When things are computed**: everything per ride is computed once, in `POST /api/rides/{id}/complete`, and
  stored: NP, IF, TSS (milestone 4), the **power curve** (`rides.power_curve int[]`: best average power for 5, 10,
  15, 30 s, 1, 2, 5, 10, 20, 30, 60 min, sliding window on the 1 Hz samples; NULL where the ride is shorter), the
  **segment efforts** and the **records** beaten (`rides.records jsonb`, so the summary keeps showing "record
  battuti" even after a later ride beats them again). Period statistics are cheap aggregates over the rides table.
- **Segment timing**: a segment counts only if all its directed edges were ridden one after the other and **in
  full**. To know that, each ridden edge now carries the ride distance where it was entered (`ride_edges.start_m`,
  sent by the client as `startM`). An edge is "full" when the distance until the next edge (or the end of the ride)
  matches its length within max(3 m, 2 %) — this rejects starting, turning around or stopping in the middle of an
  edge. The time is the **ride clock** between the distances of the segment's start and end, interpolated between
  samples (so pauses do not count, pee breaks and crashes do). The average power is over the same seconds. A segment
  ridden twice in one ride gives two efforts. Rides recorded before this milestone have no `start_m` and get no
  efforts.
- **Personal records** (`personal_records`, one row per metric): `BEST_5S`, `BEST_1MIN`, `BEST_5MIN`,
  `BEST_20MIN`, `BEST_60MIN` (W), `LONGEST_RIDE` (m), `MOST_ASCENT` (m), and `segment:<id>` (s, lower is better).
  Simulator rides count too (they are the user's rides). Deleting a completed ride **rebuilds** the user's records
  from the rides left, so a deleted ride never keeps a record.
- **Training load**: daily TSS (rides grouped by day in Europe/Zurich), `CTL(d) = CTL(d−1) + (TSS − CTL(d−1)) / 42`,
  ATL the same with 7, `TSB = CTL − ATL` of the same day. Both averages start at 0 on the user's first ride and are
  computed from there, so any requested range starts with the right values. The page shows the last 90 days with
  weekly TSS bars (Monday–Sunday) and daily CTL/ATL/TSB lines. Range limit 3 years.
- **Periods**: week (from Monday), month, year in Europe/Zurich; `all` has no start. Only COMPLETED rides count.
- **Fun counters**: pee breaks and crashes are sums of the ride counters; **"Ceneri scalati"** = rides in which a
  CLIMB segment whose name contains "Monte Ceneri" was completed (the official Cadenazzo – Monte Ceneri segment or
  an automatic climb on Via Monte Ceneri); explored share from `/api/me/explored`.
- **Zones** on the ride summary, computed in the browser from the samples: power in the 7 classic zones by % FTP
  (< 55, 55–75, 75–90, 90–105, 105–120, 120–150, > 150), heart rate in the same 5 zones as the HUD (by % of max HR:
  profile value, else 220 − age, else 190).
- **Live toasts**: climb start/end were already there (planned routes); a **"Nuovo record!"** toast now appears when
  the rolling 5 s / 1 / 5 / 20 / 60 min power or the distance beats an existing record (fetched when the ride
  starts; on a user's first rides there is nothing to beat, so no toasts). Each metric is announced once per ride.
  The backend decides what is actually stored.
- **Leaderboard** (`GET /api/routes/{id}/leaderboard`): the user's 5 best times on each segment of the route (only
  personal — there are no other riders yet).
- **Bundle**: the initial download had reached the 800 kB warning. The side menu no longer uses Material's list
  (which pulled `@angular/forms` into the startup bundle): plain links styled like it. German translations are now
  loaded only when German is chosen. Initial bundle 800.6 → 674 kB.

## Finishing touches (milestone 8)

- **FIT export** with the official **Garmin FIT SDK** (`com.garmin:fit` 21.221.0, FIT Protocol License) rather than a
  hand-written encoder: the file is what Garmin's own tools expect, and the tests decode it back with the same SDK
  (integrity check, record count, values). Messages: file_id, device_info, timer start/stop events, one record per
  second (position in semicircles, altitude, distance, speed, grade, power, heart rate, cadence), one lap, one
  session (sport cycling, sub-sport **virtual activity**, NP/IF/TSS, work), activity. Calories ≈ kJ (the usual 1:1
  for cycling). Generated on demand; the unused `rides.fit_file` column stays empty.
- **GPX export**: GPX 1.1, `<type>VirtualRide</type>`, heart rate and cadence in Garmin's TrackPointExtension v1,
  power in a plain `<power>` extension (what Strava reads).
- **Timestamps** in both files are the ride start plus the **ride clock**: pauses are left out (as a head unit with
  auto-pause would), pee breaks and crashes are included. File names: `zwiftfree-<date>-<route-slug>.fit|gpx`.
- **Downloads** go through `HttpClient` (they need the bearer token) and are saved with a temporary object URL.
- **WebSocket**: STOMP on `/ws` with Spring's simple in-memory broker (one backend instance; a relay to an external
  broker is only needed when scaling out). Browsers cannot put headers on the WebSocket handshake, so the endpoint is
  open at HTTP level and **authentication happens in the STOMP CONNECT frame** (`Authorization: Bearer …`, same JWT
  as the REST API; the client gets a fresh token before every reconnect). An interceptor refuses CONNECT without a
  valid token, SUBSCRIBE outside `/topic/routes/{id}/riders` and `/user/queue/…`, and SEND outside `/app/…`; a
  refusal closes the session with an ERROR frame.
- **Any origin** is accepted on `/ws`: the session is authenticated by the token in CONNECT, never by cookies, so a
  foreign page cannot hijack it; this lets a phone on the LAN (`http://192.168.x.y:4280/live`) be the second screen.
- **Second screen**: the ride screen publishes once a second to `/app/live/position`; the server adds the rider's
  name and forwards to `/user/queue/live` (every device of the same user) and to
  `/topic/routes/{routeId|free}/riders` (ready for several riders on one map). At most one message every 250 ms
  per user is forwarded, except that a **change of state always goes through** (the final `FINISHED` comes right
  after the last position). Incoming frames are not forced into order (that would run the security interceptor
  after the subscription is acknowledged); with one message a second, order cannot show. The second screen greys
  out after 5 s without data and keeps the device awake (Wake Lock).
- **The STOMP client** (`@stomp/stompjs` 7.5.0) is loaded only when the ride screen or the second screen opens.
- **End-to-end tests** (Playwright 1.65.1) run against a live stack (Docker by default), one worker, Italian locale,
  Europe/Zurich; every test creates its own account and deletes it at the end. They cannot cover Web Bluetooth (no
  real devices in a headless browser): the trainer path is covered by the component tests with a fake GATT server
  (milestone 5). The same run can refresh the README screenshots (`SCREENSHOTS=1`).

## 3D view

- **One ride engine, two renderers.** CesiumJS 1.147.0 (npm stable tag verified 2026-11-16) reads the existing
  course and ride state. It does not change physics, sensor traffic, uploaded samples or the route follower.
  The 2D map remains the default. Persisted view preferences are distinct from the ride's temporary **V** /
  button override, so trying another camera never changes the next ride's preference.
- **Direct hosted swisstopo data for phase A.** Terrain Quantized Mesh, SWISSIMAGE WMTS JPEG and
  swissBUILDINGS3D 3D Tiles have public, CORS-enabled endpoints. Exact URLs, metadata, verification date and
  terms are recorded in `ARCHITECTURE.md`. No Cesium ion, Google API, access token or backend proxy is
  necessary. The word `ion` in swisstopo's published tileset metadata is a producer hint, not a dependency
  on the ion service. Child tile URLs are resolved from service manifests rather than guessed.
- **Explicit opt-in loading.** Cesium's runtime is a dynamic import and its supporting assets live under
  `/cesium/`. No third-party Angular wrapper is added. This keeps the map startup path small and allows
  renderer teardown to release WebGL resources when returning to 2D.
- **Keep static assets local and revalidated.** Worker and WebAssembly MIME types are explicit in nginx;
  missing assets answer 404 instead of the SPA. Cesium assets have unhashed filenames, so they revalidate
  rather than inheriting the immutable cache policy of hashed application bundles.
- **Camera follows the route.** Its target is a point ahead on the course, including curves and climbs,
  rather than a projection along only the current heading. Pure pose and critically damped smoothing
  functions keep the 10 Hz physics updates independent from rendering. First-person head bob is optional
  and disabled by default; the existing animated 2D rider panel remains available in phase A.
  The scene's rear-view SVG cyclist is an original, colored billboard for this first phase. It is replaced
  by the animated glTF model in phase B, rather than implying that a 2D marker is a complete 3D avatar.
  Camera FOVs are vertical (60° third person, 73° first person), converted to Cesium's wider-axis convention.
  During the ride the render viewport reserves the elevation panel's height, so that the panel cannot hide
  the cyclist. The pre-ride preview uses the full viewport.
- **Do not confuse height systems.** The downloaded swissALTI3D source is
  [LV95 / LN02](https://www.swisstopo.admin.ch/en/height-model-swissalti3d), whereas Cesium Cartesian
  positions use ellipsoidal heights. The terrain service advertises EPSG:4326 and quantized-mesh but its
  manifest does not explicitly describe a vertical-datum transformation. Phase A preserves road elevations
  and uses sampled rendered terrain as a lower safety limit for the camera; it never lowers a bridge onto
  the terrain. This guard is not a geodetic conversion or a guarantee of exact road-to-imagery alignment.
  A future offline pipeline must transform elevations consistently, including bridges. In particular,
  swisstopo's approximate `+49.55 …` formula converts Bessel ellipsoidal heights to WGS84 ellipsoidal heights;
  it is not a substitute for an LN02 geoid transformation. See the official
  [reference-system formulas, sections 4.2 and 6.1](https://www.swisstopo.admin.ch/dam/en/sd-web/c46Fz-MHIc3u/refsys-EN.pdf)
  for HTRANS and CHGeo2004 requirements.
- **Bounded streaming and fallback.** Rendering uses the public service's cache and normal visible-tile
  selection, without bulk prefetch in phase A. Unsupported WebGL2 or a failed renderer returns to the map;
  sustained performance below the configured safety threshold also returns to 2D. Headless test rendering
  is not a GPU performance benchmark. Real-device comfort, true-trainer behavior and 60 fps remain manual
  acceptance checks.
- **Hosted vegetation exists.** The verified `ch.swisstopo.vegetation.3d/v1/tileset.json` endpoint means trees
  can be streamed in a later realism phase. Locally generated instanced trees are useful for offline use
  rather than a prerequisite for online trees. No geographic data are fetched into the repository; offline
  download and conversion remain phase C, with explicit user-launched scripts.
- **A fallback must work without WebGL.** MapLibre 6 also requires WebGL2, so simply selecting that component
  on a device without WebGL2 would leave a blank map. `RasterRideMap` provides a bounded DOM tile layer and
  SVG route, ridden track, junction choices and rider marker in this case. It follows the shared ride frames,
  releases offscreen tile nodes and observers on teardown, and preserves swisstopo attribution. Its fixed
  zoom and follow-only camera are an emergency mode; MapLibre remains the normal 2D renderer.
- **Phase boundary.** Phase A supplies hosted terrain, imagery and buildings with both camera modes,
  settings, existing overlays and map fallback. Asphalt geometry, a fully animated 3D avatar, tunnels,
  shadows/lighting refinement, route prefetch, trees, offline endpoints and final performance work belong
  to the subsequent phases in `PROMPT_3D.md`. There is no claim that these later items have been completed.
