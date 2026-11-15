package ch.zwiftfree.stats;

import ch.zwiftfree.ride.RideDtos.RideSummary;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class StatsDtos {

    private StatsDtos() {
    }

    public enum Period {
        WEEK, MONTH, YEAR, ALL
    }

    /**
     * Totals of the completed rides started in the period, plus the fun counters.
     *
     * @param from start of the period (Europe/Zurich), null for ALL
     * @param ceneri rides in which a Monte Ceneri climb was completed
     * @param lastRide most recent completed ride, whatever the period
     */
    public record Summary(Period period, Instant from, int rides, double distanceM, long movingTimeS, double ascentM,
            double kj, double tss, int peeBreaks, int crashes, int ceneri, RideSummary lastRide) {
    }

    /** Best average power for one duration, and the ride where it was done (null watts: no ride long enough). */
    public record CurvePoint(int durationS, Integer watts, UUID rideId, Instant date) {
    }

    public record LoadDay(LocalDate date, double tss, double ctl, double atl, double tsb) {
    }

    /**
     * @param metric BEST_5S, …, BEST_60MIN (W), LONGEST_RIDE, MOST_ASCENT (m) or segment:&lt;id&gt; (s)
     * @param segment the segment, for segment records
     */
    public record RecordDto(String metric, double value, UUID rideId, Instant achievedAt, SegmentRef segment) {
    }

    public record SegmentRef(UUID id, String name, String type, double lengthM, Double avgGrade) {
    }

    /** Personal leaderboard of one segment of a route. */
    public record SegmentBoard(UUID segmentId, String name, String type, double startM, double lengthM,
            double avgGrade, List<BoardEntry> efforts) {
    }

    public record BoardEntry(UUID rideId, int elapsedS, Integer avgPower, Instant date) {
    }
}
