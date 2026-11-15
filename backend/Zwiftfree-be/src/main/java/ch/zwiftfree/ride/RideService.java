package ch.zwiftfree.ride;

import ch.zwiftfree.common.db.SqlArrays;
import ch.zwiftfree.common.web.ApiException;
import ch.zwiftfree.common.web.NotFoundException;
import ch.zwiftfree.ride.RideDtos.CreateRide;
import ch.zwiftfree.ride.RideDtos.EventDto;
import ch.zwiftfree.ride.RideDtos.EventsBatch;
import ch.zwiftfree.ride.RideDtos.NewRecord;
import ch.zwiftfree.ride.RideDtos.Page;
import ch.zwiftfree.ride.RideDtos.RideDetail;
import ch.zwiftfree.ride.RideDtos.RideEdgeDto;
import ch.zwiftfree.ride.RideDtos.RideEventType;
import ch.zwiftfree.ride.RideDtos.RideMode;
import ch.zwiftfree.ride.RideDtos.RideStatus;
import ch.zwiftfree.ride.RideDtos.RideSummary;
import ch.zwiftfree.ride.RideDtos.SampleDto;
import ch.zwiftfree.ride.RideDtos.SamplesBatch;
import ch.zwiftfree.ride.RideDtos.SamplesColumns;
import ch.zwiftfree.ride.RideDtos.SegmentEffortDto;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Rides of one user: creation, 30 s sample blocks, events, completion with summary, history. */
@Service
public class RideService {

    static final int MAX_PAGE_SIZE = 100;

    private static final String SUMMARY_COLUMNS = """
            r.id, r.route_id, ro.name AS route_name, r.started_at, r.ended_at, r.status, r.mode, r.distance_m,
            r.moving_time_s, r.elapsed_time_s, r.ascent_m, r.avg_power, r.max_power, r.normalized_power, r.avg_hr,
            r.max_hr, r.avg_cadence, r.avg_speed_kmh, r.kj, r.tss, r.intensity_factor, r.pee_breaks, r.crashes""";

    private final JdbcTemplate jdbc;
    private final JsonMapper json;
    private final RecordService records;

    public RideService(JdbcTemplate jdbc, JsonMapper json, RecordService records) {
        this.jdbc = jdbc;
        this.json = json;
        this.records = records;
    }

    @Transactional
    public RideSummary create(UUID userId, CreateRide req) {
        if (req.routeId() != null) {
            Boolean visible = jdbc.queryForObject("""
                    SELECT EXISTS (SELECT 1 FROM routes WHERE id = ?
                                   AND (owner_id IS NULL OR owner_id = ? OR is_public))""", Boolean.class,
                    req.routeId(), userId);
            if (!Boolean.TRUE.equals(visible)) {
                throw new NotFoundException("Percorso non trovato");
            }
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO rides (id, user_id, route_id, mode, status) VALUES (?, ?, ?, ?, 'IN_PROGRESS')", id,
                userId, req.routeId(), req.mode().name());
        return summary(userId, id);
    }

    /** Upserts samples on (ride, t) and ridden edges on (ride, seq): sending the same block twice is harmless. */
    @Transactional
    public void addSamples(UUID userId, UUID rideId, SamplesBatch batch) {
        requireInProgress(userId, rideId);
        List<SampleDto> samples = batch.samples();
        if (!samples.isEmpty()) {
            jdbc.batchUpdate("""
                    INSERT INTO ride_samples (ride_id, t_s, distance_m, lat, lon, ele, grade, power, cadence, hr,
                                              speed_kmh, avatar_state, edge_id, edge_offset_m)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (ride_id, t_s) DO UPDATE SET
                        distance_m = EXCLUDED.distance_m, lat = EXCLUDED.lat, lon = EXCLUDED.lon, ele = EXCLUDED.ele,
                        grade = EXCLUDED.grade, power = EXCLUDED.power, cadence = EXCLUDED.cadence, hr = EXCLUDED.hr,
                        speed_kmh = EXCLUDED.speed_kmh, avatar_state = EXCLUDED.avatar_state,
                        edge_id = EXCLUDED.edge_id, edge_offset_m = EXCLUDED.edge_offset_m""", samples, 500,
                    (ps, s) -> {
                        ps.setObject(1, rideId);
                        ps.setInt(2, s.t());
                        ps.setObject(3, s.distanceM(), Types.DOUBLE);
                        ps.setObject(4, s.lat(), Types.DOUBLE);
                        ps.setObject(5, s.lon(), Types.DOUBLE);
                        ps.setObject(6, s.ele(), Types.DOUBLE);
                        ps.setObject(7, s.grade(), Types.DOUBLE);
                        ps.setObject(8, s.power(), Types.INTEGER);
                        ps.setObject(9, s.cadence(), Types.INTEGER);
                        ps.setObject(10, s.hr(), Types.INTEGER);
                        ps.setObject(11, s.speedKmh(), Types.DOUBLE);
                        ps.setString(12, s.avatarState());
                        ps.setObject(13, s.edgeId(), Types.BIGINT);
                        ps.setObject(14, s.edgeOffsetM(), Types.DOUBLE);
                    });
        }
        List<RideEdgeDto> edges = batch.edges() == null ? List.of() : batch.edges();
        for (RideEdgeDto e : edges) {
            if (e.direction() == 0) {
                throw ApiException.badRequest("Direzione non valida");
            }
        }
        if (!edges.isEmpty()) {
            jdbc.batchUpdate("""
                    INSERT INTO ride_edges (ride_id, seq, edge_id, direction, start_m) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (ride_id, seq) DO UPDATE SET edge_id = EXCLUDED.edge_id,
                                                             direction = EXCLUDED.direction,
                                                             start_m = EXCLUDED.start_m""", edges, 500,
                    (ps, e) -> {
                        ps.setObject(1, rideId);
                        ps.setInt(2, e.seq());
                        ps.setLong(3, e.edgeId());
                        ps.setShort(4, (short) e.direction());
                        ps.setObject(5, e.startM(), Types.DOUBLE);
                    });
        }
    }

    @Transactional
    public void addEvents(UUID userId, UUID rideId, EventsBatch batch) {
        requireInProgress(userId, rideId);
        jdbc.batchUpdate("""
                INSERT INTO ride_events (id, ride_id, t_s, type, distance_m, payload)
                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb))
                ON CONFLICT (id) DO NOTHING""", batch.events(), 200, (ps, e) -> {
            ps.setObject(1, e.id());
            ps.setObject(2, rideId);
            ps.setInt(3, e.t());
            ps.setString(4, e.type().name());
            ps.setObject(5, e.distanceM(), Types.DOUBLE);
            ps.setString(6, e.payload() == null ? null : json.writeValueAsString(e.payload()));
        });
    }

    /**
     * Computes the summary from the stored samples (NP, IF, TSS, power curve), times the segments ridden, updates the
     * personal records, marks the ride COMPLETED and adds its roads to the user's explored roads. Completing an
     * already completed ride just returns it.
     */
    @Transactional
    public RideDetail complete(UUID userId, UUID rideId) {
        RideStatus status = lockOwned(userId, rideId);
        if (status == RideStatus.COMPLETED) {
            return get(userId, rideId);
        }
        List<RideMetrics.Sample> samples = jdbc.query("""
                SELECT t_s, distance_m, ele, power, cadence, hr, speed_kmh FROM ride_samples
                WHERE ride_id = ? ORDER BY t_s""",
                (rs, i) -> new RideMetrics.Sample(rs.getInt("t_s"), rs.getDouble("distance_m"),
                        dbl(rs, "ele"), rs.getInt("power"), rs.getInt("cadence"),
                        rs.getInt("hr"), rs.getDouble("speed_kmh")),
                rideId);
        Integer ftp = jdbc.query("SELECT ftp_watts FROM user_profiles WHERE user_id = ?",
                (rs, i) -> (Integer) rs.getObject(1, Integer.class), userId).stream().findFirst().orElse(null);
        RideMetrics.Summary s = RideMetrics.summarize(samples, ftp);
        int[] power = samples.stream().mapToInt(x -> Math.max(0, x.power())).toArray();
        Integer[] curve = power.length == 0 ? null : RideMetrics.bestPower(power, RideMetrics.CURVE_DURATIONS_S);
        List<SegmentTiming.Effort> efforts = segmentEfforts(rideId, samples, s.distanceM());
        // In the order they were ridden: clock_timestamp() grows within the transaction, unlike now().
        for (SegmentTiming.Effort e : efforts.stream()
                .sorted(Comparator.comparingDouble(SegmentTiming.Effort::startM))
                .toList()) {
            jdbc.update("""
                    INSERT INTO segment_efforts (ride_id, segment_id, user_id, elapsed_s, avg_power, created_at)
                    VALUES (?, ?, ?, ?, ?, clock_timestamp())""", rideId, e.segmentId(), userId, e.elapsedS(),
                    e.avgPower());
        }
        Instant startedAt = jdbc.queryForObject("SELECT started_at FROM rides WHERE id = ?", Timestamp.class, rideId)
                .toInstant();
        List<NewRecord> beaten = records.update(userId, rideId, startedAt, curve, s.distanceM(), s.ascentM(),
                efforts);
        jdbc.update("""
                UPDATE rides SET power_curve = ?::int[], records = CAST(? AS jsonb) WHERE id = ?""",
                curve == null ? null : SqlArrays.literal(curve), json.writeValueAsString(beaten), rideId);
        jdbc.update("""
                UPDATE rides SET status = 'COMPLETED', ended_at = now(), distance_m = ?, moving_time_s = ?,
                    elapsed_time_s = ?, ascent_m = ?, avg_power = ?, max_power = ?, normalized_power = ?, avg_hr = ?,
                    max_hr = ?, avg_cadence = ?, avg_speed_kmh = ?, kj = ?, tss = ?, intensity_factor = ?,
                    pee_breaks = (SELECT count(*) FROM ride_events WHERE ride_id = ? AND type = 'PEE_BREAK_START'),
                    crashes = (SELECT count(*) FROM ride_events WHERE ride_id = ? AND type = 'CRASH')
                WHERE id = ?""", s.distanceM(), s.movingTimeS(), s.elapsedTimeS(), s.ascentM(), s.avgPower(),
                s.maxPower(), s.normalizedPower(), s.avgHr(), s.maxHr(), s.avgCadence(), s.avgSpeedKmh(), s.kj(),
                s.tss(), s.intensityFactor(), rideId, rideId, rideId);
        jdbc.update("""
                INSERT INTO user_explored_edges (user_id, edge_id, first_ridden_at, times)
                SELECT ?, e.id, now(), 1
                FROM (SELECT DISTINCT edge_id FROM ride_edges WHERE ride_id = ?) re
                JOIN road_edges e ON e.id = re.edge_id
                ON CONFLICT (user_id, edge_id) DO UPDATE SET times = user_explored_edges.times + 1""", userId,
                rideId);
        return get(userId, rideId);
    }

    /** Segments ridden in full, from the edges entered (with their start distance) and the samples. */
    private List<SegmentTiming.Effort> segmentEfforts(UUID rideId, List<RideMetrics.Sample> samples,
            double endDistanceM) {
        List<SegmentTiming.EnteredEdge> entered = jdbc.query("""
                SELECT edge_id, direction, start_m FROM ride_edges WHERE ride_id = ? ORDER BY seq""",
                (rs, i) -> rs.getBigDecimal("start_m") == null
                        ? null
                        : new SegmentTiming.EnteredEdge(rs.getLong("edge_id"), rs.getInt("direction"),
                                rs.getDouble("start_m")),
                rideId);
        if (entered.isEmpty() || entered.contains(null) || samples.isEmpty()) {
            return List.of();
        }
        Long[] ids = entered.stream().map(SegmentTiming.EnteredEdge::edgeId).distinct().toArray(Long[]::new);
        Map<Long, Double> lengths = new HashMap<>();
        jdbc.query("SELECT id, length_m FROM road_edges WHERE id = ANY(?)",
                rs -> {
                    lengths.put(rs.getLong(1), rs.getDouble(2));
                }, (Object) ids);
        List<SegmentTiming.Segment> segments = jdbc.query("""
                SELECT id, edge_ids, edge_directions FROM segments WHERE edge_ids <@ ?::bigint[]""",
                (rs, i) -> new SegmentTiming.Segment(rs.getObject("id", UUID.class), SqlArrays.longs(rs, "edge_ids"),
                        SqlArrays.ints(rs, "edge_directions")),
                (Object) ids);
        if (segments.isEmpty()) {
            return List.of();
        }
        List<SegmentTiming.Point> points = samples.stream()
                .map(x -> new SegmentTiming.Point(x.t(), x.distanceM(), x.power()))
                .toList();
        return SegmentTiming.efforts(entered, endDistanceM, lengths, segments, points);
    }

    @Transactional(readOnly = true)
    public Page<RideSummary> list(UUID userId, int page, int size, UUID routeId) {
        int p = Math.max(0, page);
        int sz = Math.max(1, Math.min(MAX_PAGE_SIZE, size));
        String filter = routeId == null ? "" : " AND r.route_id = ?";
        Object[] countArgs = routeId == null ? new Object[]{userId} : new Object[]{userId, routeId};
        Long total = jdbc.queryForObject("SELECT count(*) FROM rides r WHERE r.user_id = ?" + filter, Long.class,
                countArgs);
        List<Object> args = new ArrayList<>(List.of(countArgs));
        args.add(sz);
        args.add((long) p * sz);
        List<RideSummary> content = jdbc.query("SELECT " + SUMMARY_COLUMNS
                + " FROM rides r LEFT JOIN routes ro ON ro.id = r.route_id WHERE r.user_id = ?" + filter
                + " ORDER BY r.started_at DESC LIMIT ? OFFSET ?", (rs, i) -> summary(rs), args.toArray());
        long t = total == null ? 0 : total;
        return new Page<>(content, p, sz, t, (int) ((t + sz - 1) / sz));
    }

    /** The user's most recent completed ride, if any. */
    @Transactional(readOnly = true)
    public Optional<RideSummary> lastCompleted(UUID userId) {
        return jdbc.query("SELECT " + SUMMARY_COLUMNS + """
                 FROM rides r LEFT JOIN routes ro ON ro.id = r.route_id
                WHERE r.user_id = ? AND r.status = 'COMPLETED' ORDER BY r.started_at DESC LIMIT 1""",
                (rs, i) -> summary(rs), userId).stream().findFirst();
    }

    @Transactional(readOnly = true)
    public RideDetail get(UUID userId, UUID rideId) {
        RideSummary ride = summary(userId, rideId);
        String recordsJson = jdbc.queryForObject("SELECT records::text FROM rides WHERE id = ?", String.class, rideId);
        List<NewRecord> newRecords = recordsJson == null
                ? List.of()
                : json.readValue(recordsJson, new TypeReference<List<NewRecord>>() {
                });
        List<SegmentEffortDto> efforts = jdbc.query("""
                SELECT e.segment_id, s.name, s.type, s.length_m, s.avg_grade, e.elapsed_s, e.avg_power,
                       1 + (SELECT count(*) FROM segment_efforts o
                            WHERE o.user_id = e.user_id AND o.segment_id = e.segment_id
                              AND o.elapsed_s < e.elapsed_s) AS rank
                FROM segment_efforts e JOIN segments s ON s.id = e.segment_id
                WHERE e.ride_id = ? ORDER BY e.created_at, e.id""", (rs, i) -> {
            int rank = rs.getInt("rank");
            return new SegmentEffortDto(rs.getObject("segment_id", UUID.class), rs.getString("name"),
                    rs.getString("type"), rs.getDouble("length_m"), dbl(rs, "avg_grade"), rs.getInt("elapsed_s"),
                    rs.getObject("avg_power", Integer.class), rank == 1, rank);
        }, rideId);
        List<EventDto> events = jdbc.query("""
                SELECT id, t_s, type, distance_m, payload::text AS payload FROM ride_events
                WHERE ride_id = ? ORDER BY t_s, type""", (rs, i) -> new EventDto(rs.getObject("id", UUID.class),
                rs.getInt("t_s"), RideEventType.valueOf(rs.getString("type")),
                dbl(rs, "distance_m"), payload(rs.getString("payload"))), rideId);
        return new RideDetail(ride, events, newRecords, efforts);
    }

    @Transactional(readOnly = true)
    public SamplesColumns samples(UUID userId, UUID rideId) {
        lockOwnedReadOnly(userId, rideId);
        record Row(int t, double d, Double lat, Double lon, Double ele, Double grade, Integer power, Integer cad,
                Integer hr, Double speed, String state) {
        }
        List<Row> rows = jdbc.query("""
                SELECT t_s, distance_m, lat, lon, ele, grade, power, cadence, hr, speed_kmh, avatar_state
                FROM ride_samples WHERE ride_id = ? ORDER BY t_s""", (rs, i) -> new Row(rs.getInt(1), rs.getDouble(2),
                rs.getObject(3, Double.class), rs.getObject(4, Double.class), dbl(rs, 5),
                dbl(rs, 6), rs.getObject(7, Integer.class), rs.getObject(8, Integer.class),
                rs.getObject(9, Integer.class), dbl(rs, 10), rs.getString(11)), rideId);
        int n = rows.size();
        var c = new SamplesColumns(new int[n], new double[n], new Double[n], new Double[n], new Double[n],
                new Double[n], new Integer[n], new Integer[n], new Integer[n], new Double[n], new String[n]);
        for (int i = 0; i < n; i++) {
            Row r = rows.get(i);
            c.t()[i] = r.t();
            c.distanceM()[i] = r.d();
            c.lat()[i] = r.lat();
            c.lon()[i] = r.lon();
            c.ele()[i] = r.ele();
            c.grade()[i] = r.grade();
            c.power()[i] = r.power();
            c.cadence()[i] = r.cad();
            c.hr()[i] = r.hr();
            c.speedKmh()[i] = r.speed();
            c.avatarState()[i] = r.state();
        }
        return c;
    }

    /** Deletes the ride; if it was completed, its roads stop counting as explored (unless ridden in other rides). */
    @Transactional
    public void delete(UUID userId, UUID rideId) {
        RideStatus status = lockOwned(userId, rideId);
        if (status == RideStatus.COMPLETED) {
            jdbc.update("""
                    UPDATE user_explored_edges u SET times = u.times - 1
                    WHERE u.user_id = ? AND u.edge_id IN (SELECT DISTINCT edge_id FROM ride_edges WHERE ride_id = ?)""",
                    userId, rideId);
            jdbc.update("DELETE FROM user_explored_edges WHERE user_id = ? AND times <= 0", userId);
        }
        jdbc.update("DELETE FROM rides WHERE id = ? AND user_id = ?", rideId, userId);
        if (status == RideStatus.COMPLETED) {
            records.rebuild(userId);
        }
    }

    private void requireInProgress(UUID userId, UUID rideId) {
        RideStatus status = lockOwnedReadOnly(userId, rideId);
        if (status != RideStatus.IN_PROGRESS) {
            throw ApiException.conflict("L'uscita è già conclusa");
        }
    }

    private RideStatus lockOwned(UUID userId, UUID rideId) {
        return jdbc.query("SELECT status FROM rides WHERE id = ? AND user_id = ? FOR UPDATE",
                (rs, i) -> RideStatus.valueOf(rs.getString(1)), rideId, userId)
                .stream()
                .findFirst()
                .orElseThrow(RideService::notFound);
    }

    private RideStatus lockOwnedReadOnly(UUID userId, UUID rideId) {
        return jdbc.query("SELECT status FROM rides WHERE id = ? AND user_id = ?",
                (rs, i) -> RideStatus.valueOf(rs.getString(1)), rideId, userId)
                .stream()
                .findFirst()
                .orElseThrow(RideService::notFound);
    }

    private RideSummary summary(UUID userId, UUID rideId) {
        return jdbc.query("SELECT " + SUMMARY_COLUMNS
                + " FROM rides r LEFT JOIN routes ro ON ro.id = r.route_id WHERE r.id = ? AND r.user_id = ?",
                (rs, i) -> summary(rs), rideId, userId).stream().findFirst().orElseThrow(RideService::notFound);
    }

    private static NotFoundException notFound() {
        return new NotFoundException("Uscita non trovata");
    }

    private Map<String, Object> payload(String text) {
        return text == null ? null : json.readValue(text, new TypeReference<Map<String, Object>>() {
        });
    }

    private static RideSummary summary(ResultSet rs) throws SQLException {
        Timestamp ended = rs.getTimestamp("ended_at");
        return new RideSummary(rs.getObject("id", UUID.class), rs.getObject("route_id", UUID.class),
                rs.getString("route_name"), rs.getTimestamp("started_at").toInstant(),
                ended == null ? null : ended.toInstant(), RideStatus.valueOf(rs.getString("status")),
                RideMode.valueOf(rs.getString("mode")), dbl(rs, "distance_m"),
                rs.getObject("moving_time_s", Integer.class), rs.getObject("elapsed_time_s", Integer.class),
                dbl(rs, "ascent_m"), rs.getObject("avg_power", Integer.class),
                rs.getObject("max_power", Integer.class), rs.getObject("normalized_power", Integer.class),
                rs.getObject("avg_hr", Integer.class), rs.getObject("max_hr", Integer.class),
                rs.getObject("avg_cadence", Integer.class), dbl(rs, "avg_speed_kmh"),
                dbl(rs, "kj"), dbl(rs, "tss"),
                dbl(rs, "intensity_factor"), rs.getInt("pee_breaks"), rs.getInt("crashes"));
    }

    /** Nullable numeric column as Double (numeric columns come back as BigDecimal). */
    private static Double dbl(ResultSet rs, String column) throws SQLException {
        java.math.BigDecimal v = rs.getBigDecimal(column);
        return v == null ? null : v.doubleValue();
    }

    private static Double dbl(ResultSet rs, int column) throws SQLException {
        java.math.BigDecimal v = rs.getBigDecimal(column);
        return v == null ? null : v.doubleValue();
    }
}
