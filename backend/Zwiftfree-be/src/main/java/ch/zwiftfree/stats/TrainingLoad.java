package ch.zwiftfree.stats;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Fitness (CTL), fatigue (ATL) and form (TSB) from daily TSS, as exponentially weighted averages over 42 and 7 days:
 * {@code CTL(d) = CTL(d-1) + (TSS(d) - CTL(d-1)) / 42}, same for ATL with 7, and {@code TSB = CTL - ATL}.
 */
public final class TrainingLoad {

    static final double CTL_DAYS = 42;
    static final double ATL_DAYS = 7;

    private TrainingLoad() {
    }

    public record Day(LocalDate date, double tss, double ctl, double atl, double tsb) {
    }

    /**
     * @param dailyTss TSS per day (days without rides are 0)
     * @param since first day to start the averages from (both start at 0); usually the first ride
     * @return one entry per day from {@code from} to {@code to}, both included
     */
    public static List<Day> compute(Map<LocalDate, Double> dailyTss, LocalDate since, LocalDate from, LocalDate to) {
        List<Day> out = new ArrayList<>();
        double ctl = 0, atl = 0;
        LocalDate start = since.isBefore(from) ? since : from;
        for (LocalDate d = start; !d.isAfter(to); d = d.plusDays(1)) {
            double tss = dailyTss.getOrDefault(d, 0.0);
            ctl += (tss - ctl) / CTL_DAYS;
            atl += (tss - atl) / ATL_DAYS;
            if (!d.isBefore(from)) {
                out.add(new Day(d, round1(tss), round1(ctl), round1(atl), round1(ctl - atl)));
            }
        }
        return out;
    }

    private static double round1(double v) {
        return Math.round(v * 10) / 10.0;
    }
}
