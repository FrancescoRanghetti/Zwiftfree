package ch.zwiftfree.road;

/**
 * Cost functions for pgRouting. Uphill effort depends on the travel direction: {@code cost} (source→target) uses
 * {@code ascent_m}, {@code reverse_cost} uses {@code descent_m}. Forbidden directions keep -1.
 */
public enum PlanProfile {

    /** Length only. */
    SHORTEST("length_m", "length_m"),

    /** length · (1 + uphill grade / 2), uphill grade in % from the climbing done in that direction. */
    AVOID_CLIMBS(
            "length_m * (1 + greatest(100 * ascent_m / greatest(length_m, 1), 0) / 2)",
            "length_m * (1 + greatest(100 * descent_m / greatest(length_m, 1), 0) / 2)"),

    /** Uphill edges get cheaper the steeper they are; flat and downhill edges keep their length. */
    SEEK_CLIMBS(
            "length_m / (1 + least(100 * ascent_m / greatest(length_m, 1), 15) / 2)",
            "length_m / (1 + least(100 * descent_m / greatest(length_m, 1), 15) / 2)"),

    /** Busy roads are penalized, small roads preferred. */
    QUIET(
            "length_m * " + Penalty.SQL,
            "length_m * " + Penalty.SQL);

    final String forward;
    final String backward;

    PlanProfile(String forward, String backward) {
        this.forward = forward;
        this.backward = backward;
    }

    private static final class Penalty {

        static final String SQL = """
                (CASE highway WHEN 'trunk' THEN 4 WHEN 'trunk_link' THEN 4 WHEN 'primary' THEN 2.5
                 WHEN 'primary_link' THEN 2.5 WHEN 'secondary' THEN 1.4 WHEN 'secondary_link' THEN 1.4
                 WHEN 'track' THEN 1.5 ELSE 1 END)""";
    }
}
