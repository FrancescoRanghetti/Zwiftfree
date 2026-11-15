package ch.zwiftfree.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import ch.zwiftfree.ride.RideMetrics;
import ch.zwiftfree.ride.SegmentTiming;
import ch.zwiftfree.ride.SegmentTiming.EnteredEdge;
import ch.zwiftfree.ride.SegmentTiming.Point;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class StatsCalculationsTest {

    @Test
    void bestPowerUsesASlidingWindow() {
        int[] power = new int[600];
        Arrays.fill(power, 150);
        for (int i = 100; i < 110; i++) {
            power[i] = 600; // 10 s sprint
        }
        Integer[] best = RideMetrics.bestPower(power, new int[]{5, 10, 60, 600, 1200});
        assertThat(best[0]).isEqualTo(600);
        assertThat(best[1]).isEqualTo(600);
        assertThat(best[2]).isEqualTo((600 * 10 + 150 * 50) / 60);
        assertThat(best[3]).isEqualTo(158); // 157.5 rounded
        assertThat(best[4]).isNull();
    }

    @Test
    void curveDurationsGoFromFiveSecondsToAnHour() {
        assertThat(RideMetrics.CURVE_DURATIONS_S[0]).isEqualTo(5);
        assertThat(RideMetrics.CURVE_DURATIONS_S[RideMetrics.CURVE_DURATIONS_S.length - 1]).isEqualTo(3600);
        assertThat(RideMetrics.CURVE_DURATIONS_S).isSorted();
    }

    private static List<Point> steady(double speed, int seconds, int power) {
        List<Point> out = new ArrayList<>();
        for (int t = 0; t <= seconds; t++) {
            out.add(new Point(t, t * speed, power));
        }
        return out;
    }

    private static final UUID SEG = UUID.randomUUID();
    private static final Map<Long, Double> LENGTHS = Map.of(1L, 100.0, 2L, 200.0, 3L, 300.0, 4L, 50.0);
    private static final List<SegmentTiming.Segment> SEGMENTS = List
            .of(new SegmentTiming.Segment(SEG, List.of(2L, 3L), List.of(1, -1)));

    @Test
    void segmentIsTimedBetweenItsStartAndEnd() {
        List<EnteredEdge> entered = List.of(new EnteredEdge(1, 1, 0), new EnteredEdge(2, 1, 100),
                new EnteredEdge(3, -1, 300), new EnteredEdge(4, 1, 600));
        var efforts = SegmentTiming.efforts(entered, 650, LENGTHS, SEGMENTS, steady(4, 170, 250));
        assertThat(efforts).hasSize(1);
        assertThat(efforts.getFirst().startM()).isEqualTo(100);
        assertThat(efforts.getFirst().endM()).isEqualTo(600);
        assertThat(efforts.getFirst().elapsedS()).isEqualTo(125); // 500 m at 4 m/s
        assertThat(efforts.getFirst().avgPower()).isEqualTo(250);
    }

    @Test
    void segmentNeedsEveryEdgeInFullAndInTheRightDirection() {
        // Started in the middle of edge 2.
        var partialStart = List.of(new EnteredEdge(2, 1, 0), new EnteredEdge(3, -1, 150), new EnteredEdge(4, 1, 450));
        assertThat(SegmentTiming.efforts(partialStart, 500, LENGTHS, SEGMENTS, steady(5, 100, 200))).isEmpty();
        // Turned around inside edge 3.
        var turned = List.of(new EnteredEdge(2, 1, 0), new EnteredEdge(3, -1, 200), new EnteredEdge(3, 1, 300));
        assertThat(SegmentTiming.efforts(turned, 400, LENGTHS, SEGMENTS, steady(5, 80, 200))).isEmpty();
        // Wrong direction on edge 3.
        var wrong = List.of(new EnteredEdge(2, 1, 0), new EnteredEdge(3, 1, 200), new EnteredEdge(4, 1, 500));
        assertThat(SegmentTiming.efforts(wrong, 550, LENGTHS, SEGMENTS, steady(5, 110, 200))).isEmpty();
        // Ride ended before the end of edge 3.
        var shortRide = List.of(new EnteredEdge(2, 1, 0), new EnteredEdge(3, -1, 200));
        assertThat(SegmentTiming.efforts(shortRide, 450, LENGTHS, SEGMENTS, steady(5, 90, 200))).isEmpty();
    }

    @Test
    void segmentRiddenTwiceGivesTwoEfforts() {
        var loop = List.of(new EnteredEdge(2, 1, 0), new EnteredEdge(3, -1, 200), new EnteredEdge(4, 1, 500),
                new EnteredEdge(2, 1, 550), new EnteredEdge(3, -1, 750));
        var efforts = SegmentTiming.efforts(loop, 1050, LENGTHS, SEGMENTS, steady(5, 210, 200));
        assertThat(efforts).hasSize(2);
        assertThat(efforts).extracting(SegmentTiming.Effort::elapsedS).containsExactly(100, 100);
    }

    @Test
    void timeIsInterpolatedBetweenSamples() {
        List<Point> pts = List.of(new Point(0, 0, 0), new Point(1, 10, 0), new Point(2, 20, 0));
        assertThat(SegmentTiming.timeAt(pts, 15)).isCloseTo(1.5, within(1e-9));
        assertThat(SegmentTiming.timeAt(pts, 20.5)).isEqualTo(2.0);
        assertThat(SegmentTiming.timeAt(pts, 40)).isNull();
    }

    @Test
    void trainingLoadFollowsExponentialAverages() {
        LocalDate d0 = LocalDate.of(2026, 1, 1);
        var days = TrainingLoad.compute(Map.of(d0, 100.0), d0, d0, d0.plusDays(6));
        assertThat(days).hasSize(7);
        assertThat(days.getFirst().ctl()).isCloseTo(100 / 42.0, within(0.05));
        assertThat(days.getFirst().atl()).isCloseTo(100 / 7.0, within(0.05));
        assertThat(days.getFirst().tsb()).isLessThan(0);
        // Without riding, fatigue drops faster than fitness.
        assertThat(days.getLast().atl() / days.getFirst().atl())
                .isLessThan(days.getLast().ctl() / days.getFirst().ctl());
        assertThat(days.getLast().tss()).isZero();
    }

    @Test
    void trainingLoadIsSeededBeforeTheRequestedRange() {
        LocalDate d0 = LocalDate.of(2026, 1, 1);
        var days = TrainingLoad.compute(Map.of(d0, 100.0), d0, d0.plusDays(30), d0.plusDays(30));
        assertThat(days).hasSize(1);
        assertThat(days.getFirst().ctl()).isGreaterThan(0);
    }
}
