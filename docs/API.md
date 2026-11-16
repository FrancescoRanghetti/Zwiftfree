# API

Live, always up-to-date documentation: **Swagger UI** at `/swagger-ui` (OpenAPI JSON at `/v3/api-docs`).

All endpoints live under `/api`, speak JSON, and return errors as RFC 9457 `application/problem+json`.

## Available

Authenticated endpoints need `Authorization: Bearer <accessToken>`; without it they answer `401` problem JSON.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | – | `{ status, version, database, postgis, pgrouting }` |
| POST | `/api/auth/register` | – | `{ email, password (10–128), displayName }` → `201 { accessToken, refreshToken, expiresIn }`; `409` if the email exists |
| POST | `/api/auth/login` | – | `{ email, password }` → token pair; `401` bad credentials; `429` + `Retry-After` when rate limited |
| POST | `/api/auth/refresh` | – | `{ refreshToken }` → new pair (old token rotated); replaying a rotated token revokes all sessions |
| POST | `/api/auth/logout` | – | `{ refreshToken }` → `204` |
| GET | `/api/me` | ✓ | `{ id, email, displayName, createdAt, profile, settings }` |
| PUT | `/api/me/profile` | ✓ | display name, physical data, units, `avatar { jerseyColor, helmetColor, bikeColor }` → me |
| PUT | `/api/me/settings` | ✓ | pee break on/after seconds, crashes, trainer difficulty 0–1, audio, corner assist, ride view, head bob, 3D quality → me |
| PUT | `/api/me/password` | ✓ | `{ currentPassword, newPassword }` → new token pair; ends every other session |
| DELETE | `/api/me` | ✓ | `{ password }` → `204`; deletes the user and all their data |
| GET | `/api/tiles/roads/{z}/{x}/{y}.mvt` | – | Road network vector tile (layer `roads`: id, name, highway, rank, steepest, length_m, ascent_m, descent_m, oneway); cached 1 day |
| GET | `/api/roads/nearest?lat=&lon=` | ✓ | Nearest junction (main network) and road, within 1.5 km |
| GET | `/api/roads/edges/{id}` | ✓ | Road segment with its 3D geometry `[lon, lat, ele]` every ~10 m |
| GET | `/api/roads/next?edgeId=&direction=` | ✓ | Ways out of the junction at the end of the edge: turn angle, LEFT/STRAIGHT/RIGHT/U_TURN, `preferred` |
| GET | `/api/roads/area?lat=&lon=&radius=` | ✓ | Every edge within `radius` m (≤ 3000), for instant turns in free ride |
| POST | `/api/roads/plan` | ✓ | `{ waypoints:[{lat,lon}] (2–25), profile: SHORTEST\|AVOID_CLIMBS\|SEEK_CLIMBS\|QUIET, loop }` → `{ edgeIds, directions, edgeStartsM, coordinates, profile:[[m, ele, grade%]], lengthM, ascentM, descentM, minEle, maxEle, maxGrade, loop, roadNames }`; `422` when a point is far from roads or unreachable |
| GET | `/api/places?q=&limit=` | ✓ | Ticino localities, accent-insensitive; empty `q` = main towns |
| GET | `/api/places/all` | ✓ | All ~900 localities (the ride screen names the next village ahead) |
| GET | `/api/routes` | ✓ | Official, own and public routes with a simplified preview track |
| GET | `/api/routes/{id}` | ✓ | Route + full track + `edgeStartsM` (null if the network changed since) + elevation profile + segments on it (`startM`, `endM`) |
| POST | `/api/routes` | ✓ | `{ name, description, isPublic, edgeIds, directions, profile }` → `201`; edges must be connected and legal |
| DELETE | `/api/routes/{id}` | ✓ | Own routes only (`404` otherwise) |
| POST | `/api/rides` | ✓ | `{ routeId?, mode: TRAINER\|SIMULATOR }` → `201` ride summary, status `IN_PROGRESS`; `404` unknown/invisible route |
| POST | `/api/rides/{id}/samples` | ✓ | `{ samples:[{t, distanceM, lat, lon, ele, grade, power, cadence, hr, speedKmh, avatarState, edgeId, edgeOffsetM}] (≤ 900), edges:[{seq, edgeId, direction, startM}] }` → `204` (`startM` = ride distance when the edge was entered, needed to time segments); upsert on `(ride, t)` and `(ride, seq)`, so re-sending is harmless; `409` once completed |
| POST | `/api/rides/{id}/events` | ✓ | `{ events:[{id (client UUID), t, type, distanceM, payload}] }` → `204`; duplicates (same id) ignored |
| POST | `/api/rides/{id}/complete` | ✓ | Computes distance, moving/elapsed time, ascent, avg/max/normalized power, HR, cadence, speed, kJ, IF, TSS, power curve, pee breaks, crashes; times the segments ridden in full; updates personal records; adds the ridden edges to the explored roads; idempotent → ride detail |
| GET | `/api/rides?page=&size=&routeId=` | ✓ | `{ content, page, size, totalElements, totalPages }`, newest first, size ≤ 100 |
| GET | `/api/rides/{id}` | ✓ | `{ ride, events, records:[{metric, value, previous}], segmentEfforts:[{segmentId, name, type, lengthM, avgGrade, elapsedS, avgPower, personalBest, rank}] }` |
| GET | `/api/rides/{id}/samples` | ✓ | Samples by column: `{ t:[], distanceM:[], lat:[], lon:[], ele:[], grade:[], power:[], cadence:[], hr:[], speedKmh:[], avatarState:[] }` |
| GET | `/api/rides/{id}/export.fit` | ✓ | FIT activity file (`application/vnd.ant.fit`, attachment `zwiftfree-<date>-<route>.fit`); `404` if not yours |
| GET | `/api/rides/{id}/export.gpx` | ✓ | GPX 1.1 track (`application/gpx+xml`) with heart rate, cadence (Garmin TrackPointExtension) and power |
| DELETE | `/api/rides/{id}` | ✓ | `204`; its roads stop counting as explored unless ridden in another ride; personal records are rebuilt from the remaining rides |
| GET | `/api/stats/summary?period=week\|month\|year\|all` | ✓ | `{ period, from, rides, distanceM, movingTimeS, ascentM, kj, tss, peeBreaks, crashes, ceneri, lastRide }` (completed rides started in the period, Europe/Zurich; `lastRide` whatever the period); `400` unknown period |
| GET | `/api/stats/power-curve?period=` | ✓ | `[{ durationS, watts, rideId, date }]` for 5 s … 60 min (`watts` null when no ride is long enough); default `all` |
| GET | `/api/stats/training-load?from=&to=` | ✓ | `[{ date, tss, ctl, atl, tsb }]` one per day (ISO dates, default the last 90 days, max 3 years); `400` if `from` > `to` |
| GET | `/api/stats/records` | ✓ | `[{ metric, value, rideId, achievedAt, segment? }]`: BEST_5S … BEST_60MIN (W), LONGEST_RIDE, MOST_ASCENT (m), `segment:<id>` (s) |
| GET | `/api/routes/{id}/leaderboard` | ✓ | `[{ segmentId, name, type, startM, lengthM, avgGrade, efforts:[{ rideId, elapsedS, avgPower, date }] }]`: the user's 5 best times per segment of the route; `404` unknown/invisible route |
| GET | `/api/me/explored` | ✓ | `{ exploredEdges, totalEdges, exploredKm, totalKm, percent, geojson }` (explored roads, simplified, 2D) |
| GET | `/actuator/health` | – | Container liveness/readiness |

Rides are private: another user's ride id answers `404` on every endpoint.

Validation errors: `400` with `errors: { "field": "messaggio" }` (nested fields use dots, e.g. `avatar.jerseyColor`).

Ride display preferences in `settings`:

| Field | Values | Default |
| --- | --- | --- |
| `rideView` | `MAP_2D`, `THIRD_PERSON`, `FIRST_PERSON` | `MAP_2D` |
| `headBobEnabled` | boolean (only applied in first person) | `false` |
| `sceneQuality` | `LOW`, `MEDIUM`, `HIGH` | `MEDIUM` |

These three fields may be omitted or null in `PUT /api/me/settings` to preserve their saved values, so older
clients do not reset 3D preferences. Unrecognised view or quality values return `400` with a field error. The
ride screen's temporary view switch and automatic 2D fallback do not write these preferences.

This covers the whole surface of the project spec (§5.6 and §10). The interactive version is at
`/swagger-ui` (OpenAPI at `/v3/api-docs`).

## WebSocket (STOMP)

Endpoint `/ws` (plain WebSocket, STOMP 1.2). Send `Authorization: Bearer <accessToken>` in the **CONNECT** frame;
without a valid token the server answers with an ERROR frame and closes the connection.

| Direction | Destination | Payload |
| --- | --- | --- |
| client → server | `/app/live/position` | `{ routeId?, distanceM, speedKmh, power, cadence, hr, grade, lat, lon, remainingM, elapsedS, avatarState, road, title }`, about once a second |
| server → client | `/user/queue/live` | the same fields plus `userId`, `displayName`, `routeId` (`"free"` for free rides), `at` — your own rides, on every device logged in as you |
| server → client | `/topic/routes/{routeId}/riders` | the same message, for everyone riding that route (`free` = free rides) |

Subscriptions to any other destination are refused. Messages closer than 250 ms to the previous one from the same
user are dropped unless `avatarState` changed.
