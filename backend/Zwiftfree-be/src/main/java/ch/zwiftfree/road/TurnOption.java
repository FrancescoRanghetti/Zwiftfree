package ch.zwiftfree.road;

/**
 * A way to leave a junction.
 *
 * @param turnDegrees signed turn: negative left, positive right, 0 straight
 * @param maneuver LEFT, STRAIGHT, RIGHT or U_TURN
 * @param preferred the option taken when the rider chooses nothing (straightest, same or higher-rank road)
 */
public record TurnOption(
        long edgeId,
        int direction,
        String name,
        String highway,
        int rank,
        double lengthM,
        double gradePercent,
        double turnDegrees,
        String maneuver,
        boolean preferred) {
}
