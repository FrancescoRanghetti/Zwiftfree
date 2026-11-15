package ch.zwiftfree.road;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RouteAssemblerTest {

    @Test
    void profileIsSampledEvery50mWithGrades() {
        // 300 m straight line climbing 30 m (10 %)
        double[][] c = {{9.0, 46.0, 100}, {9.0, 46.0027, 130}};
        double[] d = {0, Geo.distance(9.0, 46.0, 9.0, 46.0027)};
        double[][] p = RouteAssembler.profile(c, d);
        assertThat(p.length).isEqualTo(8); // 0,50,...,300
        assertThat(p[0][1]).isEqualTo(100);
        assertThat(p[2][2]).isCloseTo(10, org.assertj.core.data.Offset.offset(0.2));
    }

    @Test
    void maxGradeIsMeasuredOver200mAndIgnoresArtefacts() {
        // a single 50 m spike of +10 m (DEM noise) averages out over 200 m
        double[][] spike = {{0, 100, 0}, {50, 100, 0}, {100, 110, 20}, {150, 100, -20}, {200, 100, 0},
                {250, 100, 0}};
        assertThat(RouteAssembler.maxGrade(spike)).isZero();
        // a real, steady 6 % ramp is reported as 6 %
        double[][] ramp = {{0, 100, 0}, {50, 103, 6}, {100, 106, 6}, {150, 109, 6}, {200, 112, 6}};
        assertThat(RouteAssembler.maxGrade(ramp)).isCloseTo(6, org.assertj.core.data.Offset.offset(1e-9));
        // tunnel: +100 m in 200 m (50 %) is not a road grade
        double[][] tunnel = {{0, 100, 0}, {50, 125, 0}, {100, 150, 0}, {150, 175, 0}, {200, 200, 0}};
        assertThat(RouteAssembler.maxGrade(tunnel)).isZero();
    }
}
