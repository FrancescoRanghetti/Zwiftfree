package ch.zwiftfree.stats;

import ch.zwiftfree.common.web.ApiException;
import ch.zwiftfree.ride.RecordService;
import ch.zwiftfree.ride.RideMetrics;
import ch.zwiftfree.ride.RideService;
import ch.zwiftfree.road.SegmentOnRoute;
import ch.zwiftfree.route.RouteService;
import ch.zwiftfree.stats.StatsDtos.BoardEntry;
import ch.zwiftfree.stats.StatsDtos.CurvePoint;
import ch.zwiftfree.stats.StatsDtos.LoadDay;
import ch.zwiftfree.stats.StatsDtos.Period;
import ch.zwiftfree.stats.StatsDtos.RecordDto;
import ch.zwiftfree.stats.StatsDtos.SegmentBoard;
import ch.zwiftfree.stats.StatsDtos.SegmentRef;
import ch.zwiftfree.stats.StatsDtos.Summary;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Totals, power curve, training load, records and segment leaderboards of one user (completed rides only). */
@Service
public class StatsService {

    /** Weeks, months and years start in Ticino's time zone. */
    static final ZoneId ZONE = ZoneId.of("Europe/Zurich");
    static final int MAX_LOAD_DAYS = 3 * 366;
    static final int LEADERBOARD_SIZE = 5;

    private final JdbcTemplate jdbc;
    private final RideService rides;
    private final RouteService routes;
    private final Clock clock;

    public StatsService(JdbcTemplate jdbc, RideService rides, RouteService routes, Clock clock) {
        this.jdbc = jdbc;
        this.rides = rides;
        this.routes = routes;
        this.clock = clock;
    }

    /** Start of the period containing now, or null for ALL. */
    Instant periodStart(Period period) {
        LocalDate today = LocalDate.now(clock.withZone(ZONE));
        LocalDate start = switch (period) {
            case WEEK -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case MONTH -> today.withDayOfMonth(1);
            case YEAR -> today.withDayOfYear(1);
            case ALL -> null;
        };
        return start == null ? null : start.atStartOfDay(ZONE).toInstant();
    }

    @Transactional(readOnly = true)
    public Summary summary(UUID userId, Period period) {
        Instant from = periodStart(period);
        Timestamp since = Timestamp.from(from == null ? Instant.EPOCH : from);
        return jdbc.queryForObject("""
                SELECT count(*) AS rides, coalesce(sum(distance_m), 0) AS distance,
                       coalesce(sum(moving_time_s), 0) AS moving, coalesce(sum(ascent_m), 0) AS ascent,
                       coalesce(sum(kj), 0) AS kj, coalesce(sum(tss), 0) AS tss,
                       coalesce(sum(pee_breaks), 0) AS pee, coalesce(sum(crashes), 0) AS crashes,
                       (SELECT count(DISTINCT e.ride_id) FROM segment_efforts e
                            JOIN segments s ON s.id = e.segment_id JOIN rides r2 ON r2.id = e.ride_id
                        WHERE e.user_id = ? AND s.type = 'CLIMB' AND s.name ILIKE '%Monte Ceneri%'
                          AND r2.status = 'COMPLETED' AND r2.started_at >= ?) AS ceneri
                FROM rides WHERE user_id = ? AND status = 'COMPLETED' AND started_at >= ?""",
                (rs, i) -> new Summary(period, from, rs.getInt("rides"), round1(rs.getDouble("distance")),
                        rs.getLong("moving"), round1(rs.getDouble("ascent")), round1(rs.getDouble("kj")),
                        round1(rs.getDouble("tss")), rs.getInt("pee"), rs.getInt("crashes"), rs.getInt("ceneri"),
                        rides.lastCompleted(userId).orElse(null)),
                userId, since, userId, since);
    }

    @Transactional(readOnly = true)
    public List<CurvePoint> powerCurve(UUID userId, Period period) {
        Instant from = periodStart(period);
        int[] durations = RideMetrics.CURVE_DURATIONS_S;
        Integer[] best = new Integer[durations.length];
        UUID[] ride = new UUID[durations.length];
        Instant[] date = new Instant[durations.length];
        jdbc.query("""
                SELECT id, started_at, power_curve FROM rides
                WHERE user_id = ? AND status = 'COMPLETED' AND power_curve IS NOT NULL AND started_at >= ?
                ORDER BY started_at""", rs -> {
            Integer[] curve = (Integer[]) rs.getArray("power_curve").getArray();
            for (int d = 0; d < Math.min(curve.length, durations.length); d++) {
                if (curve[d] != null && curve[d] > 0 && (best[d] == null || curve[d] > best[d])) {
                    best[d] = curve[d];
                    ride[d] = rs.getObject("id", UUID.class);
                    date[d] = rs.getTimestamp("started_at").toInstant();
                }
            }
        }, userId, Timestamp.from(from == null ? Instant.EPOCH : from));
        List<CurvePoint> out = new ArrayList<>();
        for (int d = 0; d < durations.length; d++) {
            out.add(new CurvePoint(durations[d], best[d], ride[d], date[d]));
        }
        return out;
    }

    /** Daily TSS with CTL/ATL/TSB, seeded from the first ride so the averages are right at {@code from}. */
    @Transactional(readOnly = true)
    public List<LoadDay> trainingLoad(UUID userId, LocalDate from, LocalDate to) {
        LocalDate today = LocalDate.now(clock.withZone(ZONE));
        LocalDate end = to == null ? today : to;
        LocalDate start = from == null ? end.minusDays(89) : from;
        if (start.isAfter(end)) {
            throw ApiException.badRequest("La data iniziale è dopo quella finale");
        }
        if (ChronoUnit.DAYS.between(start, end) >= MAX_LOAD_DAYS) {
            throw ApiException.badRequest("Intervallo troppo lungo (massimo 3 anni)");
        }
        Map<LocalDate, Double> daily = new HashMap<>();
        jdbc.query("""
                SELECT (started_at AT TIME ZONE 'Europe/Zurich')::date AS day, sum(tss) AS tss FROM rides
                WHERE user_id = ? AND status = 'COMPLETED' AND tss IS NOT NULL
                  AND (started_at AT TIME ZONE 'Europe/Zurich')::date <= ?
                GROUP BY 1""", rs -> {
            daily.put(rs.getDate("day").toLocalDate(), rs.getDouble("tss"));
        }, userId, Date.valueOf(end));
        LocalDate since = daily.keySet().stream().min(LocalDate::compareTo).orElse(start);
        return TrainingLoad.compute(daily, since, start, end)
                .stream()
                .map(d -> new LoadDay(d.date(), d.tss(), d.ctl(), d.atl(), d.tsb()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<RecordDto> records(UUID userId) {
        List<RecordDto> out = jdbc.query("""
                SELECT p.metric, p.value, p.ride_id, p.achieved_at, s.id AS sid, s.name, s.type, s.length_m,
                       s.avg_grade
                FROM personal_records p
                LEFT JOIN segments s ON p.metric LIKE 'segment:%' AND s.id::text = substr(p.metric, 9)
                WHERE p.user_id = ?""", (rs, i) -> {
            UUID sid = rs.getObject("sid", UUID.class);
            SegmentRef seg = sid == null
                    ? null
                    : new SegmentRef(sid, rs.getString("name"), rs.getString("type"), rs.getDouble("length_m"),
                            rs.getBigDecimal("avg_grade") == null ? null : rs.getDouble("avg_grade"));
            return new RecordDto(rs.getString("metric"), rs.getDouble("value"), rs.getObject("ride_id", UUID.class),
                    rs.getTimestamp("achieved_at").toInstant(), seg);
        }, userId);
        // Segment records whose segment no longer exists are left out; power first, then distance, then segments.
        List<String> order = new ArrayList<>(Arrays.asList("BEST_5S", "BEST_1MIN", "BEST_5MIN", "BEST_20MIN",
                "BEST_60MIN", RecordService.LONGEST_RIDE, RecordService.MOST_ASCENT));
        return out.stream()
                .filter(r -> !r.metric().startsWith(RecordService.SEGMENT_PREFIX) || r.segment() != null)
                .sorted((a, b) -> {
                    int ia = order.indexOf(a.metric()), ib = order.indexOf(b.metric());
                    ia = ia < 0 ? order.size() : ia;
                    ib = ib < 0 ? order.size() : ib;
                    if (ia != ib) {
                        return Integer.compare(ia, ib);
                    }
                    return a.segment() == null ? 0 : a.segment().name().compareTo(b.segment().name());
                })
                .toList();
    }

    /** The user's best times on each segment of a route (404 if the route is not visible to the user). */
    @Transactional(readOnly = true)
    public List<SegmentBoard> leaderboard(UUID userId, UUID routeId) {
        List<SegmentOnRoute> segments = routes.get(userId, routeId).segments();
        List<SegmentBoard> out = new ArrayList<>();
        for (SegmentOnRoute s : segments) {
            List<BoardEntry> best = jdbc.query("""
                    SELECT e.ride_id, e.elapsed_s, e.avg_power, r.started_at
                    FROM segment_efforts e JOIN rides r ON r.id = e.ride_id
                    WHERE e.user_id = ? AND e.segment_id = ? AND r.status = 'COMPLETED'
                    ORDER BY e.elapsed_s, r.started_at LIMIT ?""",
                    (rs, i) -> new BoardEntry(rs.getObject("ride_id", UUID.class), rs.getInt("elapsed_s"),
                            rs.getObject("avg_power", Integer.class), rs.getTimestamp("started_at").toInstant()),
                    userId, s.id(), LEADERBOARD_SIZE);
            out.add(new SegmentBoard(s.id(), s.name(), s.type(), s.startM(), s.lengthM(), s.avgGrade(), best));
        }
        return out;
    }

    private static double round1(double v) {
        return Math.round(v * 10) / 10.0;
    }
}
