package ch.zwiftfree.road;

import java.util.List;

/**
 * A route expressed as a sequence of directed edges plus everything the UI needs before riding it.
 *
 * @param coordinates [lon, lat, ele] in travel order, junction points de-duplicated
 * @param distances cumulative distance in metres for each coordinate
 * @param edgeStartsM distance along the route where each edge starts
 * @param profile elevation profile sampled every ~50 m: [distanceM, ele, gradePercent]
 */
public record PlannedRoute(
        List<Long> edgeIds,
        List<Integer> directions,
        double[][] coordinates,
        double[] distances,
        double[] edgeStartsM,
        double[][] profile,
        double lengthM,
        double ascentM,
        double descentM,
        double minEle,
        double maxEle,
        double maxGrade,
        boolean loop,
        List<String> roadNames) {
}
