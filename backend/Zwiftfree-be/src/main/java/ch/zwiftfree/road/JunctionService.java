package ch.zwiftfree.road;

import ch.zwiftfree.common.web.NotFoundException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import org.springframework.stereotype.Service;

/** What a rider can do at the end of an edge: free-ride turn choices. */
@Service
public class JunctionService {

    /** Bearings are measured over this many metres from the junction. */
    static final double BEARING_SPAN_M = 25;
    static final double STRAIGHT_DEG = 35;

    private final RoadRepository roads;

    public JunctionService(RoadRepository roads) {
        this.roads = roads;
    }

    public List<TurnOption> next(long edgeId, int direction) {
        RoadEdge in = roads.edge(edgeId).orElseThrow(() -> new NotFoundException("Strada non trovata"));
        return options(in, direction, roads.edgesAt(in.endNode(direction)));
    }

    /** Pure function of the incoming edge and the edges touching its end node (testable without a database). */
    static List<TurnOption> options(RoadEdge in, int direction, List<RoadEdge> atNode) {
        long node = in.endNode(direction);
        double inBearing = Geo.polylineBearing(in.coords(direction), true, BEARING_SPAN_M);
        List<Candidate> cands = new ArrayList<>();
        for (RoadEdge out : atNode) {
            for (int dir : new int[]{1, -1}) {
                if (out.startNode(dir) != node || !out.canTravel(dir))
                    continue;
                if (out.id() == in.id() && dir == -direction)
                    continue; // U-turn handled below
                double outBearing = Geo.polylineBearing(out.coords(dir), false, BEARING_SPAN_M);
                cands.add(new Candidate(out, dir, Geo.turn(inBearing, outBearing)));
            }
        }
        if (cands.isEmpty()) {
            // Dead end: turn around, but never against a one-way.
            if (in.canTravel(-direction)) {
                return List.of(toOption(new Candidate(in, -direction, 180), true, "U_TURN"));
            }
            return List.of();
        }
        int bestRank = cands.stream().mapToInt(c -> c.edge.rank()).min().orElse(9);
        Candidate preferred = cands.stream()
                .min(Comparator.comparingDouble(c -> score(c, in, bestRank)))
                .orElseThrow();
        return cands.stream()
                .sorted(Comparator.comparingDouble(c -> c.turn))
                .map(c -> toOption(c, c == preferred, maneuver(c.turn)))
                .toList();
    }

    /** Lower is better: as straight as possible, staying on the most important road, keeping the same name. */
    private static double score(Candidate c, RoadEdge in, int bestRank) {
        double s = Math.abs(c.turn) + 30.0 * (c.edge.rank() - bestRank);
        if (in.name() != null && Objects.equals(in.name(), c.edge.name()))
            s -= 25;
        return s;
    }

    static String maneuver(double turn) {
        if (Math.abs(turn) <= STRAIGHT_DEG)
            return "STRAIGHT";
        if (Math.abs(turn) >= 160)
            return "U_TURN";
        return turn < 0 ? "LEFT" : "RIGHT";
    }

    private static TurnOption toOption(Candidate c, boolean preferred, String maneuver) {
        RoadEdge e = c.edge;
        double grade = e.lengthM() > 0 ? (e.gain(c.dir) - e.loss(c.dir)) / e.lengthM() * 100 : 0;
        return new TurnOption(e.id(), c.dir, e.name(), e.highway(), e.rank(), e.lengthM(),
                Math.round(grade * 10) / 10.0, Math.round(c.turn), maneuver, preferred);
    }

    private record Candidate(RoadEdge edge, int dir, double turn) {
    }
}
