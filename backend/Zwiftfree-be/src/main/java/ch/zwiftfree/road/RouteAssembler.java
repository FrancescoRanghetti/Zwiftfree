package ch.zwiftfree.road;

import ch.zwiftfree.common.web.ApiException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Turns a list of directed edges into geometry, profile and statistics. */
@Component
public class RouteAssembler {

    static final double PROFILE_STEP_M = 50;

    private final RoadRepository roads;

    public RouteAssembler(RoadRepository roads) {
        this.roads = roads;
    }

    public PlannedRoute assemble(List<Long> edgeIds, List<Integer> directions) {
        if (edgeIds.isEmpty() || edgeIds.size() != directions.size()) {
            throw ApiException.badRequest("Percorso vuoto o non valido");
        }
        Map<Long, RoadEdge> byId = roads.edges(new LinkedHashSet<>(edgeIds));
        List<RoadEdge> ordered = new ArrayList<>(edgeIds.size());
        for (Long id : edgeIds) {
            RoadEdge e = byId.get(id);
            if (e == null) {
                throw ApiException.badRequest("Strada inesistente: " + id);
            }
            ordered.add(e);
        }
        return assembleEdges(ordered, directions);
    }

    /** Validates connectivity and one-way rules, then builds the route. */
    public PlannedRoute assembleEdges(List<RoadEdge> edges, List<Integer> directions) {
        List<double[]> coords = new ArrayList<>();
        double length = 0, ascent = 0, descent = 0;
        LinkedHashSet<String> names = new LinkedHashSet<>();
        long prevEnd = -1;
        int[] startIdx = new int[edges.size()];
        for (int i = 0; i < edges.size(); i++) {
            RoadEdge e = edges.get(i);
            int dir = directions.get(i);
            if (dir != 1 && dir != -1) {
                throw ApiException.badRequest("Direzione non valida");
            }
            if (!e.canTravel(dir)) {
                throw ApiException.badRequest("La strada " + e.id() + " è a senso unico in questa direzione");
            }
            if (i > 0 && e.startNode(dir) != prevEnd) {
                throw ApiException.badRequest("Le strade " + edges.get(i - 1).id() + " e " + e.id()
                        + " non sono collegate");
            }
            prevEnd = e.endNode(dir);
            double[][] pts = e.coords(dir);
            startIdx[i] = coords.isEmpty() ? 0 : coords.size() - 1;
            for (int k = (coords.isEmpty() ? 0 : 1); k < pts.length; k++) {
                coords.add(pts[k]);
            }
            length += e.lengthM();
            ascent += e.gain(dir);
            descent += e.loss(dir);
            if (e.name() != null && !e.name().isBlank()) {
                names.add(e.name());
            }
        }
        double[][] c = coords.toArray(double[][]::new);
        double[] dist = new double[c.length];
        double minEle = Double.POSITIVE_INFINITY, maxEle = Double.NEGATIVE_INFINITY;
        for (int i = 0; i < c.length; i++) {
            if (i > 0) {
                dist[i] = dist[i - 1] + Geo.distance(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]);
            }
            minEle = Math.min(minEle, c[i][2]);
            maxEle = Math.max(maxEle, c[i][2]);
        }
        double[] edgeStarts = new double[edges.size()];
        for (int i = 0; i < edges.size(); i++) {
            edgeStarts[i] = round1(dist[startIdx[i]]);
        }
        boolean loop = edges.size() > 1 && edges.getFirst().startNode(directions.getFirst()) == prevEnd;
        double[][] profile = profile(c, dist);
        return new PlannedRoute(edges.stream().map(RoadEdge::id).toList(), List.copyOf(directions), c, dist,
                edgeStarts, profile, round1(length), round1(ascent), round1(descent), round1(minEle), round1(maxEle),
                round1(maxGrade(profile)), loop, List.copyOf(names));
    }

    /** Window over which the reported maximum grade is measured: 10 m samples are too noisy (bridges, DEM). */
    static final double MAX_GRADE_WINDOW_M = 200;
    /**
     * Steeper windows are elevation artefacts, not roads: in tunnels and galleries the terrain model gives the
     * mountain surface above the road.
     */
    static final double IMPLAUSIBLE_GRADE = 30;

    /** Steepest uphill grade (%) over {@link #MAX_GRADE_WINDOW_M} along the profile, ignoring artefacts. */
    static double maxGrade(double[][] profile) {
        int step = (int) Math.round(MAX_GRADE_WINDOW_M / PROFILE_STEP_M);
        double max = 0;
        for (int i = 0; i + step < profile.length; i++) {
            double d = profile[i + step][0] - profile[i][0];
            if (d <= 0) {
                continue;
            }
            double g = (profile[i + step][1] - profile[i][1]) / d * 100;
            if (g <= IMPLAUSIBLE_GRADE) {
                max = Math.max(max, g);
            }
        }
        return max;
    }

    /** Elevation sampled every {@link #PROFILE_STEP_M} metres with the grade of each step. */
    public static double[][] elevationProfile(double[][] c, double[] dist) {
        return profile(c, dist);
    }

    static double[][] profile(double[][] c, double[] dist) {
        if (c.length == 0) {
            return new double[0][];
        }
        double total = dist[dist.length - 1];
        int n = Math.max(2, (int) Math.ceil(total / PROFILE_STEP_M) + 1);
        double[][] out = new double[n][];
        int j = 0;
        double prevEle = c[0][2];
        for (int i = 0; i < n; i++) {
            double d = Math.min(total, i * PROFILE_STEP_M);
            while (j < dist.length - 2 && dist[j + 1] < d) {
                j++;
            }
            double ele;
            if (dist.length == 1) {
                ele = c[0][2];
            } else {
                double span = dist[j + 1] - dist[j];
                double t = span <= 0 ? 0 : (d - dist[j]) / span;
                ele = c[j][2] + (c[j + 1][2] - c[j][2]) * Math.max(0, Math.min(1, t));
            }
            double step = i == 0 ? 0 : d - Math.min(total, (i - 1) * PROFILE_STEP_M);
            double grade = step > 0 ? (ele - prevEle) / step * 100 : 0;
            out[i] = new double[]{round1(d), round1(ele), round1(grade)};
            prevEle = ele;
        }
        return out;
    }

    static double round1(double v) {
        return Double.isFinite(v) ? Math.round(v * 10) / 10.0 : 0;
    }
}
