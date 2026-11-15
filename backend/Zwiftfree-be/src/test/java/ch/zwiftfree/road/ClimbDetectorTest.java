package ch.zwiftfree.road;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ClimbDetectorTest {

    /** Chain of n edges 0→1→…→n, each {@code len} m long rising {@code gain} m. */
    private static List<ClimbDetector.Edge> chain(int n, double len, double gain, String name, int rank,
            long firstId) {
        List<ClimbDetector.Edge> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            out.add(new ClimbDetector.Edge(firstId + i, firstId + i, firstId + i + 1, name, rank, len, gain, 0, true,
                    true));
        }
        return out;
    }

    @Test
    void detectsAContinuousClimbInTheUphillDirectionOnly() {
        List<ClimbDetector.Climb> climbs = ClimbDetector.detect(chain(10, 100, 6, "Via Monte Ceneri", 3, 1));
        assertThat(climbs).hasSize(1);
        ClimbDetector.Climb c = climbs.getFirst();
        assertThat(c.lengthM()).isEqualTo(1000);
        assertThat(c.gainM()).isEqualTo(60);
        assertThat(c.avgGrade()).isEqualTo(6);
        assertThat(c.directions()).containsOnly(1);
        assertThat(c.roadName()).isEqualTo("Via Monte Ceneri");
    }

    @Test
    void ignoresClimbsThatAreTooShortTooFlatOrTooSmall() {
        assertThat(ClimbDetector.detect(chain(7, 100, 8, "short", 3, 1))).isEmpty(); // 700 m
        assertThat(ClimbDetector.detect(chain(30, 100, 3.5, "flat", 3, 1))).isEmpty(); // 3.5 %
        assertThat(ClimbDetector.detect(chain(9, 100, 5, "small", 3, 1))).isEmpty(); // 45 m gain
    }

    @Test
    void trimsFlatStartAndNeverClimbsAgainstOneWay() {
        List<ClimbDetector.Edge> edges = new ArrayList<>(chain(3, 100, 1.5, "Via", 3, 1)); // gentle start
        edges.addAll(chain(10, 100, 7, "Via", 3, 4));
        List<ClimbDetector.Climb> climbs = ClimbDetector.detect(edges);
        assertThat(climbs).hasSize(1);
        assertThat(climbs.getFirst().edgeIds().getFirst()).isEqualTo(4L);

        List<ClimbDetector.Edge> oneWayDown = new ArrayList<>();
        for (ClimbDetector.Edge e : chain(10, 100, 7, "Discesa", 3, 1)) {
            oneWayDown.add(new ClimbDetector.Edge(e.id(), e.source(), e.target(), e.name(), e.rank(), e.length(),
                    0, 7, true, false)); // descends source→target, uphill only backwards, which is forbidden
        }
        assertThat(ClimbDetector.detect(oneWayDown)).isEmpty();
    }

    @Test
    void followsTheSameRoadAtAJunction() {
        List<ClimbDetector.Edge> edges = new ArrayList<>(chain(5, 100, 7, "Main", 3, 1)); // nodes 1..6
        // At node 6 two ways continue uphill: a side road (more important but different name) and Main.
        edges.add(new ClimbDetector.Edge(100, 6, 200, "Side", 2, 300, 20, 0, true, true));
        edges.addAll(List.of(
                new ClimbDetector.Edge(6, 6, 7, "Main", 3, 100, 7, 0, true, true),
                new ClimbDetector.Edge(7, 7, 8, "Main", 3, 100, 7, 0, true, true),
                new ClimbDetector.Edge(8, 8, 9, "Main", 3, 100, 7, 0, true, true)));
        List<ClimbDetector.Climb> climbs = ClimbDetector.detect(edges);
        assertThat(climbs).singleElement()
                .satisfies(c -> assertThat(c.edgeIds()).containsExactly(1L, 2L, 3L, 4L, 5L, 6L, 7L, 8L));
    }
}
