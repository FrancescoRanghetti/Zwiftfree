package ch.zwiftfree.road;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Finds continuous climbs in the road graph: follows uphill edges from junction to junction, staying on the road
 * with the same name or the highest rank, and keeps the stretches with average grade above 4%, longer than 800 m and
 * gaining more than 50 m. Pure in-memory algorithm, independent of the database.
 */
public final class ClimbDetector {

    public static final double MIN_AVG_GRADE = 0.04;
    public static final double MIN_LENGTH_M = 800;
    public static final double MIN_GAIN_M = 50;
    /** An edge continues a climb when it rises at least this much (fraction). */
    static final double CONTINUE_GRADE = 0.01;
    /** Leading/trailing edges flatter than this are cut from the climb. */
    static final double TRIM_GRADE = 0.03;
    static final int MAX_EDGES = 600;

    /** Graph edge with only what climb detection needs. */
    public record Edge(long id, long source, long target, String name, int rank, double length, double ascent,
            double descent, boolean forward, boolean backward) {
    }

    public record Climb(List<Long> edgeIds, List<Integer> directions, double lengthM, double gainM,
            String roadName) {

        public double avgGrade() {
            return lengthM > 0 ? gainM / lengthM * 100 : 0;
        }
    }

    private record D(Edge e, int dir) {

        long from() {
            return dir == 1 ? e.source : e.target;
        }

        long to() {
            return dir == 1 ? e.target : e.source;
        }

        double net() {
            return dir == 1 ? e.ascent - e.descent : e.descent - e.ascent;
        }

        double grade() {
            return e.length > 0 ? net() / e.length : 0;
        }

        boolean uphill() {
            return e.length > 0 && grade() >= CONTINUE_GRADE;
        }

        String key() {
            return e.id + (dir == 1 ? "+" : "-");
        }
    }

    private ClimbDetector() {
    }

    public static List<Climb> detect(Collection<Edge> edges) {
        Map<Long, List<D>> out = new HashMap<>();
        for (Edge e : edges) {
            if (e.forward)
                out.computeIfAbsent(e.source, k -> new ArrayList<>()).add(new D(e, 1));
            if (e.backward)
                out.computeIfAbsent(e.target, k -> new ArrayList<>()).add(new D(e, -1));
        }
        Map<String, D> successor = new HashMap<>();
        Set<String> hasPredecessor = new HashSet<>();
        List<D> uphill = new ArrayList<>();
        for (List<D> list : out.values()) {
            for (D d : list) {
                if (!d.uphill())
                    continue;
                uphill.add(d);
                D next = choose(d, out.getOrDefault(d.to(), List.of()));
                if (next != null) {
                    successor.put(d.key(), next);
                    hasPredecessor.add(next.key());
                }
            }
        }
        List<Climb> found = new ArrayList<>();
        for (D start : uphill) {
            if (hasPredecessor.contains(start.key()))
                continue;
            List<D> chain = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (D cur = start; cur != null && chain.size() < MAX_EDGES && seen.add(cur.key()); cur = successor.get(
                    cur.key())) {
                chain.add(cur);
            }
            Climb c = evaluate(trim(chain));
            if (c != null)
                found.add(c);
        }
        return dedupe(found);
    }

    /** Next uphill edge: same road name first, then the most important road, then the steepest. */
    private static D choose(D in, List<D> candidates) {
        return candidates.stream()
                .filter(c -> c.uphill() && c.e.id != in.e.id)
                .min(Comparator.<D>comparingInt(c -> Objects.equals(c.e.name, in.e.name) && in.e.name != null ? 0 : 1)
                        .thenComparingInt(c -> c.e.rank)
                        .thenComparingDouble(c -> -c.grade()))
                .orElse(null);
    }

    private static List<D> trim(List<D> chain) {
        int a = 0, b = chain.size();
        while (a < b && chain.get(a).grade() < TRIM_GRADE)
            a++;
        while (b > a && chain.get(b - 1).grade() < TRIM_GRADE)
            b--;
        return chain.subList(a, b);
    }

    private static Climb evaluate(List<D> chain) {
        if (chain.isEmpty())
            return null;
        double len = 0, gain = 0;
        Map<String, Double> nameLength = new LinkedHashMap<>();
        for (D d : chain) {
            len += d.e.length;
            gain += d.net();
            if (d.e.name != null && !d.e.name.isBlank())
                nameLength.merge(d.e.name, d.e.length, Double::sum);
        }
        if (len < MIN_LENGTH_M || gain < MIN_GAIN_M || gain / len < MIN_AVG_GRADE)
            return null;
        String name = nameLength.entrySet()
                .stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(null);
        return new Climb(chain.stream().map(d -> d.e.id).toList(), chain.stream().map(D::dir).toList(),
                Math.round(len * 10) / 10.0, Math.round(gain * 10) / 10.0, name);
    }

    /** Keeps the biggest climbs; drops any that shares more than half of its edges with an already kept one. */
    private static List<Climb> dedupe(List<Climb> climbs) {
        climbs.sort(Comparator.comparingDouble(Climb::gainM).reversed());
        Set<String> taken = new HashSet<>();
        List<Climb> kept = new ArrayList<>();
        for (Climb c : climbs) {
            int overlap = 0;
            for (int i = 0; i < c.edgeIds().size(); i++) {
                if (taken.contains(c.edgeIds().get(i) + ":" + c.directions().get(i)))
                    overlap++;
            }
            if (overlap * 2 > c.edgeIds().size())
                continue;
            for (int i = 0; i < c.edgeIds().size(); i++) {
                taken.add(c.edgeIds().get(i) + ":" + c.directions().get(i));
            }
            kept.add(c);
        }
        return kept;
    }
}
