package ch.zwiftfree.road;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class JunctionServiceTest {

    // Junction node 2 at (9.0, 46.0). Incoming edge goes north into it.
    static final double LAT = 46.0, LON = 9.0, D = 0.001; // ~110 m north, ~77 m east

    static RoadEdge edge(long id, long from, long to, double[][] coords, String name, int rank, double cost,
            double rev) {
        return new RoadEdge(id, from, to, name, "tertiary", "asphalt", 0, rank, 100, 0, 0, 0, 0, 0, cost, rev, coords);
    }

    static final RoadEdge IN = edge(1, 1, 2, new double[][]{{LON, LAT - D, 0}, {LON, LAT, 0}}, "Via A", 4, 100,
            100);
    static final RoadEdge NORTH = edge(2, 2, 3, new double[][]{{LON, LAT, 0}, {LON, LAT + D, 0}}, "Via A", 4,
            100, 100);
    static final RoadEdge EAST = edge(3, 2, 4, new double[][]{{LON, LAT, 0}, {LON + D, LAT, 0}}, "Via B", 2, 100,
            100);
    static final RoadEdge WEST_ONEWAY_IN = edge(4, 5, 2, new double[][]{{LON - D, LAT, 0}, {LON, LAT, 0}},
            "Via C", 4, 100, -1); // only travelable towards the junction

    @Test
    void classifiesTurnsAndPrefersTheSameRoadStraightOn() {
        List<TurnOption> opts = JunctionService.options(IN, 1, List.of(IN, NORTH, EAST, WEST_ONEWAY_IN));
        assertThat(opts).extracting(TurnOption::edgeId).containsExactly(2L, 3L); // west is one-way against us
        TurnOption straight = opts.get(0);
        TurnOption right = opts.get(1);
        assertThat(straight.maneuver()).isEqualTo("STRAIGHT");
        assertThat(right.maneuver()).isEqualTo("RIGHT");
        assertThat(right.turnDegrees()).isBetween(80.0, 100.0);
        assertThat(straight.preferred()).isTrue();
    }

    @Test
    void prefersTheMoreImportantRoadWhenNoRoadContinues() {
        RoadEdge northMinor = edge(2, 2, 3, NORTH.coords(), "Vicolo", 8, 100, 100);
        List<TurnOption> opts = JunctionService.options(IN, 1, List.of(IN, northMinor, EAST));
        assertThat(opts.stream().filter(TurnOption::preferred).findFirst().orElseThrow().edgeId()).isEqualTo(3L);
    }

    @Test
    void deadEndTurnsAroundUnlessOneWay() {
        List<TurnOption> opts = JunctionService.options(IN, 1, List.of(IN));
        assertThat(opts).singleElement().satisfies(o -> {
            assertThat(o.maneuver()).isEqualTo("U_TURN");
            assertThat(o.direction()).isEqualTo(-1);
        });
        RoadEdge oneWay = edge(1, 1, 2, IN.coords(), "Via A", 4, 100, -1);
        assertThat(JunctionService.options(oneWay, 1, List.of(oneWay))).isEmpty();
    }
}
