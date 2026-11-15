package ch.zwiftfree.ride;

import java.util.List;

/** Pure ride calculations (1 sample = 1 second). */
public final class RideMetrics {

    /** Below this virtual speed a second does not count as moving time. */
    static final double MOVING_KMH = 1.0;
    static final int NP_WINDOW_S = 30;

    private RideMetrics() {
    }

    public record Sample(int t, double distanceM, Double ele, int power, int cadence, int hr, double speedKmh) {
    }

    public record Summary(
            double distanceM,
            int movingTimeS,
            int elapsedTimeS,
            double ascentM,
            int avgPower,
            int maxPower,
            Integer normalizedPower,
            Integer avgHr,
            Integer maxHr,
            Integer avgCadence,
            double avgSpeedKmh,
            double kj,
            Double tss,
            Double intensityFactor) {
    }

    /**
     * @param samples ordered by time
     * @param ftp functional threshold power, for IF and TSS (null or ≤ 0: not computed)
     */
    public static Summary summarize(List<Sample> samples, Integer ftp) {
        if (samples.isEmpty()) {
            return new Summary(0, 0, 0, 0, 0, 0, null, null, null, null, 0, 0, null, null);
        }
        int n = samples.size();
        double distance = 0, ascent = 0;
        long powerSum = 0, hrSum = 0, cadSum = 0;
        int maxPower = 0, maxHr = 0, moving = 0, hrN = 0, cadN = 0;
        Double prevEle = null;
        int[] power = new int[n];
        for (int i = 0; i < n; i++) {
            Sample s = samples.get(i);
            distance = Math.max(distance, s.distanceM());
            if (s.speedKmh() >= MOVING_KMH) {
                moving++;
            }
            if (s.ele() != null) {
                if (prevEle != null && s.ele() > prevEle) {
                    ascent += s.ele() - prevEle;
                }
                prevEle = s.ele();
            }
            power[i] = Math.max(0, s.power());
            powerSum += power[i];
            maxPower = Math.max(maxPower, power[i]);
            if (s.hr() > 0) {
                hrSum += s.hr();
                hrN++;
                maxHr = Math.max(maxHr, s.hr());
            }
            if (s.cadence() > 0) {
                cadSum += s.cadence();
                cadN++;
            }
        }
        int elapsed = samples.getLast().t() + 1;
        Integer np = normalizedPower(power);
        Double intensity = null, tss = null;
        if (np != null && ftp != null && ftp > 0) {
            intensity = round2((double) np / ftp);
            tss = round1(elapsed * np * ((double) np / ftp) / (ftp * 3600.0) * 100);
        }
        return new Summary(round1(distance), moving, elapsed, round1(ascent), (int) Math.round((double) powerSum / n),
                maxPower, np, hrN == 0 ? null : (int) Math.round((double) hrSum / hrN), hrN == 0 ? null : maxHr,
                cadN == 0 ? null : (int) Math.round((double) cadSum / cadN),
                moving == 0 ? 0 : round1(distance / moving * 3.6), round1(powerSum / 1000.0), tss, intensity);
    }

    /** 30 s rolling average, raised to the 4th power, averaged, 4th root. Null for rides shorter than 30 s. */
    public static Integer normalizedPower(int[] power) {
        if (power.length < NP_WINDOW_S) {
            return null;
        }
        double window = 0, sum4 = 0;
        int count = 0;
        for (int i = 0; i < power.length; i++) {
            window += power[i];
            if (i >= NP_WINDOW_S) {
                window -= power[i - NP_WINDOW_S];
            }
            if (i >= NP_WINDOW_S - 1) {
                sum4 += Math.pow(window / NP_WINDOW_S, 4);
                count++;
            }
        }
        return (int) Math.round(Math.pow(sum4 / count, 0.25));
    }

    /** Durations of the power curve, in seconds (5 s → 60 min). */
    public static final int[] CURVE_DURATIONS_S = {5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600};

    /**
     * Best average power for each duration, with a sliding window over 1 Hz samples.
     *
     * @return one entry per duration of {@code durations}; null where the ride is shorter than the duration
     */
    public static Integer[] bestPower(int[] power, int[] durations) {
        long[] prefix = new long[power.length + 1];
        for (int i = 0; i < power.length; i++) {
            prefix[i + 1] = prefix[i] + Math.max(0, power[i]);
        }
        Integer[] best = new Integer[durations.length];
        for (int d = 0; d < durations.length; d++) {
            int w = durations[d];
            if (w <= 0 || w > power.length) {
                continue;
            }
            long max = 0;
            for (int end = w; end <= power.length; end++) {
                max = Math.max(max, prefix[end] - prefix[end - w]);
            }
            best[d] = (int) Math.round((double) max / w);
        }
        return best;
    }

    static double round1(double v) {
        return Math.round(v * 10) / 10.0;
    }

    static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }
}
