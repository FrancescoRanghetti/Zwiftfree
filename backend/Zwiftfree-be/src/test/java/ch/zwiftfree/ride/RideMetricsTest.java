package ch.zwiftfree.ride;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class RideMetricsTest {

    @Test
    void steadyPowerGivesNpEqualToAverage() {
        int[] p = new int[600];
        java.util.Arrays.fill(p, 200);
        assertThat(RideMetrics.normalizedPower(p)).isEqualTo(200);
    }

    @Test
    void variablePowerGivesNpAboveAverage() {
        int[] p = new int[1200];
        for (int i = 0; i < p.length; i++) {
            p[i] = (i / 60) % 2 == 0 ? 300 : 100; // 1 min on / 1 min off, average 200
        }
        assertThat(RideMetrics.normalizedPower(p)).isBetween(220, 260);
    }

    @Test
    void shortRideHasNoNp() {
        assertThat(RideMetrics.normalizedPower(new int[29])).isNull();
    }

    @Test
    void summaryOfOneHourAtFtpIsHundredTss() {
        List<RideMetrics.Sample> s = new ArrayList<>();
        for (int t = 0; t < 3600; t++) {
            s.add(new RideMetrics.Sample(t, t * 9.0, 300.0 + (t % 2), 250, 90, 150, 32.4));
        }
        var sum = RideMetrics.summarize(s, 250);
        assertThat(sum.elapsedTimeS()).isEqualTo(3600);
        assertThat(sum.movingTimeS()).isEqualTo(3600);
        assertThat(sum.normalizedPower()).isEqualTo(250);
        assertThat(sum.intensityFactor()).isEqualTo(1.0);
        assertThat(sum.tss()).isCloseTo(100.0, within(0.1));
        assertThat(sum.kj()).isEqualTo(900.0);
        assertThat(sum.avgSpeedKmh()).isCloseTo(32.4, within(0.1));
        assertThat(sum.ascentM()).isEqualTo(1800.0); // +1 m every other second
        assertThat(sum.avgHr()).isEqualTo(150);
        assertThat(sum.avgCadence()).isEqualTo(90);
    }

    @Test
    void stoppedSecondsAreNotMovingTimeAndZerosDoNotSkewHrOrCadence() {
        List<RideMetrics.Sample> s = new ArrayList<>();
        for (int t = 0; t < 100; t++) {
            boolean stopped = t >= 50;
            s.add(new RideMetrics.Sample(t, Math.min(t, 50) * 10.0, null, stopped ? 0 : 200, stopped ? 0 : 90,
                    stopped ? 0 : 140, stopped ? 0 : 36));
        }
        var sum = RideMetrics.summarize(s, null);
        assertThat(sum.movingTimeS()).isEqualTo(50);
        assertThat(sum.elapsedTimeS()).isEqualTo(100);
        assertThat(sum.avgPower()).isEqualTo(100);
        assertThat(sum.avgCadence()).isEqualTo(90);
        assertThat(sum.avgHr()).isEqualTo(140);
        assertThat(sum.tss()).isNull();
        assertThat(sum.distanceM()).isEqualTo(500.0);
    }

    @Test
    void emptyRide() {
        var sum = RideMetrics.summarize(List.of(), 200);
        assertThat(sum.distanceM()).isZero();
        assertThat(sum.normalizedPower()).isNull();
    }
}
