package ch.zwiftfree.ride;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Finds timed segments in a ride: the segment's directed edges must have been ridden one after the other and in
 * full (a ride that starts, turns around or stops in the middle of one of them does not count). The time is the
 * ride clock between crossing the segment's start and its end, interpolated between the 1 Hz samples.
 */
public final class SegmentTiming {

    /** Course lengths are measured on the polyline, edge lengths in the database: allow a small difference. */
    static final double LENGTH_TOLERANCE_M = 3;
    static final double LENGTH_TOLERANCE_REL = 0.02;

    private SegmentTiming() {
    }

    /** An edge entered during the ride, at {@code startM} metres of ride distance. */
    public record EnteredEdge(long edgeId, int direction, double startM) {
    }

    public record Segment(UUID id, List<Long> edgeIds, List<Integer> directions) {
    }

    /** A sample reduced to what timing needs. */
    public record Point(int t, double distanceM, int power) {
    }

    public record Effort(UUID segmentId, double startM, double endM, int elapsedS, Integer avgPower) {
    }

    /**
     * @param entered edges in the order they were entered; must have a start distance
     * @param endDistanceM distance at the end of the ride (closes the last edge)
     * @param edgeLengths length of each edge in the database
     * @param points samples ordered by time
     */
    public static List<Effort> efforts(List<EnteredEdge> entered, double endDistanceM, Map<Long, Double> edgeLengths,
            List<Segment> segments, List<Point> points) {
        int n = entered.size();
        boolean[] full = new boolean[n];
        double[] endAt = new double[n];
        for (int i = 0; i < n; i++) {
            endAt[i] = i + 1 < n ? entered.get(i + 1).startM() : endDistanceM;
            Double len = edgeLengths.get(entered.get(i).edgeId());
            double ridden = endAt[i] - entered.get(i).startM();
            full[i] = len != null && Math.abs(ridden - len) <= Math.max(LENGTH_TOLERANCE_M, len * LENGTH_TOLERANCE_REL);
        }
        List<Effort> out = new ArrayList<>();
        for (Segment s : segments) {
            int k = s.edgeIds().size();
            for (int i = 0; i + k <= n; i++) {
                if (!matches(entered, full, i, s)) {
                    continue;
                }
                double a = entered.get(i).startM();
                double b = endAt[i + k - 1];
                Double ta = timeAt(points, a);
                Double tb = timeAt(points, b);
                if (ta == null || tb == null || tb <= ta) {
                    continue;
                }
                out.add(new Effort(s.id(), a, b, Math.max(1, (int) Math.round(tb - ta)), avgPower(points, ta, tb)));
                i += k - 1;
            }
        }
        return out;
    }

    private static boolean matches(List<EnteredEdge> entered, boolean[] full, int at, Segment s) {
        for (int j = 0; j < s.edgeIds().size(); j++) {
            EnteredEdge e = entered.get(at + j);
            if (!full[at + j] || e.edgeId() != s.edgeIds().get(j) || e.direction() != s.directions().get(j)) {
                return false;
            }
        }
        return true;
    }

    /** Ride clock (s) when the distance was first reached, linearly interpolated; null if never reached. */
    public static Double timeAt(List<Point> points, double distanceM) {
        Point prev = null;
        for (Point p : points) {
            if (p.distanceM() >= distanceM) {
                if (prev == null || p.distanceM() <= prev.distanceM()) {
                    return (double) p.t();
                }
                double f = (distanceM - prev.distanceM()) / (p.distanceM() - prev.distanceM());
                return prev.t() + f * (p.t() - prev.t());
            }
            prev = p;
        }
        // The ride may end a few centimetres short of the last sample's rounding.
        if (prev != null && distanceM - prev.distanceM() < 1) {
            return (double) prev.t();
        }
        return null;
    }

    private static Integer avgPower(List<Point> points, double ta, double tb) {
        long sum = 0;
        int count = 0;
        for (Point p : points) {
            if (p.t() > ta && p.t() <= tb) {
                sum += Math.max(0, p.power());
                count++;
            }
        }
        return count == 0 ? null : (int) Math.round((double) sum / count);
    }
}
