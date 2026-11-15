package ch.zwiftfree.ride;

import ch.zwiftfree.ride.RideDtos.NewRecord;
import java.sql.Array;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Personal records: best power over 5 s, 1, 5, 20 and 60 min, longest ride, most climbing, and the best time on each
 * segment ({@code segment:<id>}, lower is better). Kept in {@code personal_records}, one row per metric.
 */
@Service
public class RecordService {

    public static final String SEGMENT_PREFIX = "segment:";
    public static final String LONGEST_RIDE = "LONGEST_RIDE";
    public static final String MOST_ASCENT = "MOST_ASCENT";

    /** Power records and their duration in seconds (each one is in RideMetrics.CURVE_DURATIONS_S). */
    public static final Map<String, Integer> POWER_RECORDS = orderedPowerRecords();

    private static Map<String, Integer> orderedPowerRecords() {
        Map<String, Integer> m = new LinkedHashMap<>();
        m.put("BEST_5S", 5);
        m.put("BEST_1MIN", 60);
        m.put("BEST_5MIN", 300);
        m.put("BEST_20MIN", 1200);
        m.put("BEST_60MIN", 3600);
        return Collections.unmodifiableMap(m);
    }

    private final JdbcTemplate jdbc;

    public RecordService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Candidate values of one ride, before comparing with the stored records. */
    record Candidate(String metric, double value, boolean lowerIsBetter) {
    }

    static List<Candidate> candidates(Integer[] curve, double distanceM, double ascentM,
            List<SegmentTiming.Effort> efforts) {
        List<Candidate> out = new ArrayList<>();
        if (curve != null) {
            POWER_RECORDS.forEach((metric, duration) -> {
                int i = curveIndex(duration);
                if (i < curve.length && curve[i] != null && curve[i] > 0) {
                    out.add(new Candidate(metric, curve[i], false));
                }
            });
        }
        if (distanceM > 0) {
            out.add(new Candidate(LONGEST_RIDE, distanceM, false));
        }
        if (ascentM > 0) {
            out.add(new Candidate(MOST_ASCENT, ascentM, false));
        }
        // Segments in the order they were ridden.
        Map<UUID, Integer> bestPerSegment = new LinkedHashMap<>();
        for (SegmentTiming.Effort e : efforts.stream()
                .sorted(Comparator.comparingDouble(SegmentTiming.Effort::startM))
                .toList()) {
            bestPerSegment.merge(e.segmentId(), e.elapsedS(), Math::min);
        }
        bestPerSegment.forEach((id, s) -> out.add(new Candidate(SEGMENT_PREFIX + id, s, true)));
        return out;
    }

    static int curveIndex(int durationS) {
        for (int i = 0; i < RideMetrics.CURVE_DURATIONS_S.length; i++) {
            if (RideMetrics.CURVE_DURATIONS_S[i] == durationS) {
                return i;
            }
        }
        throw new IllegalArgumentException("No curve duration " + durationS);
    }

    /** Stores the ride's values that beat the current records and returns them (with the previous value). */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<NewRecord> update(UUID userId, UUID rideId, Instant at, Integer[] curve, double distanceM,
            double ascentM, List<SegmentTiming.Effort> efforts) {
        List<NewRecord> beaten = new ArrayList<>();
        for (Candidate c : candidates(curve, distanceM, ascentM, efforts)) {
            Double previous = jdbc.query(
                    "SELECT value FROM personal_records WHERE user_id = ? AND metric = ? FOR UPDATE",
                    (rs, i) -> rs.getBigDecimal(1).doubleValue(), userId, c.metric())
                    .stream()
                    .findFirst()
                    .orElse(null);
            boolean better = previous == null
                    || (c.lowerIsBetter() ? c.value() < previous : c.value() > previous);
            if (!better) {
                continue;
            }
            jdbc.update("""
                    INSERT INTO personal_records (user_id, metric, value, ride_id, achieved_at) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (user_id, metric) DO UPDATE SET value = EXCLUDED.value, ride_id = EXCLUDED.ride_id,
                        achieved_at = EXCLUDED.achieved_at""", userId, c.metric(), c.value(), rideId,
                    Timestamp.from(at));
            beaten.add(new NewRecord(c.metric(), c.value(), previous));
        }
        return beaten;
    }

    /** Recomputes every record of the user from the completed rides left (after a ride is deleted). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void rebuild(UUID userId) {
        record Best(double value, UUID rideId, Timestamp at) {
        }
        Map<String, Best> best = new HashMap<>();
        jdbc.query("""
                SELECT id, started_at, power_curve, distance_m, ascent_m FROM rides
                WHERE user_id = ? AND status = 'COMPLETED' ORDER BY started_at""", rs -> {
            UUID ride = rs.getObject("id", UUID.class);
            Timestamp at = rs.getTimestamp("started_at");
            Array arr = rs.getArray("power_curve");
            Integer[] curve = arr == null ? null : (Integer[]) arr.getArray();
            double distance = rs.getBigDecimal("distance_m") == null ? 0 : rs.getDouble("distance_m");
            double ascent = rs.getBigDecimal("ascent_m") == null ? 0 : rs.getDouble("ascent_m");
            for (Candidate c : candidates(curve, distance, ascent, List.of())) {
                best.merge(c.metric(), new Best(c.value(), ride, at), (a, b) -> b.value() > a.value() ? b : a);
            }
        }, userId);
        jdbc.query("""
                SELECT DISTINCT ON (e.segment_id) e.segment_id, e.elapsed_s, e.ride_id, r.started_at
                FROM segment_efforts e JOIN rides r ON r.id = e.ride_id
                WHERE e.user_id = ? AND r.status = 'COMPLETED'
                ORDER BY e.segment_id, e.elapsed_s, r.started_at""", rs -> {
            best.put(SEGMENT_PREFIX + rs.getObject("segment_id", UUID.class), new Best(rs.getInt("elapsed_s"),
                    rs.getObject("ride_id", UUID.class), rs.getTimestamp("started_at")));
        }, userId);
        jdbc.update("DELETE FROM personal_records WHERE user_id = ?", userId);
        best.forEach((metric, b) -> jdbc.update("""
                INSERT INTO personal_records (user_id, metric, value, ride_id, achieved_at) VALUES (?, ?, ?, ?, ?)""",
                userId, metric, b.value(), b.rideId(), b.at()));
    }
}
