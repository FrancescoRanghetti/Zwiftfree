package ch.zwiftfree.road;

import ch.zwiftfree.common.web.ApiException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** A→B(→C…) planning with pgr_dijkstra on the road graph, with optional loop back to the start. */
@Service
public class PlannerService {

    /** Waypoints farther than this from any road are rejected. */
    static final double MAX_SNAP_M = 1500;
    /** Search the graph only within this margin (degrees, ~11 km) around a leg; widened on failure. */
    static final double[] BBOX_MARGINS = {0.1, 0.3, -1};
    /** Cost multiplier for edges already used, so the way back of a loop takes other roads. */
    static final double LOOP_PENALTY = 6;

    public record Waypoint(double lat, double lon) {
    }

    private final JdbcTemplate jdbc;
    private final RoadRepository roads;
    private final RouteAssembler assembler;

    public PlannerService(JdbcTemplate jdbc, RoadRepository roads, RouteAssembler assembler) {
        this.jdbc = jdbc;
        this.roads = roads;
        this.assembler = assembler;
    }

    @Transactional(readOnly = true)
    public PlannedRoute plan(List<Waypoint> waypoints, PlanProfile profile, boolean loop) {
        if (waypoints == null || waypoints.size() < 2) {
            throw ApiException.badRequest("Servono almeno partenza e arrivo");
        }
        if (waypoints.size() > 25) {
            throw ApiException.badRequest("Al massimo 25 punti");
        }
        List<RoadRepository.NodeHit> nodes = new ArrayList<>();
        for (int i = 0; i < waypoints.size(); i++) {
            Waypoint w = waypoints.get(i);
            int idx = i + 1;
            nodes.add(roads.nearestNode(w.lat(), w.lon(), MAX_SNAP_M)
                    .orElseThrow(
                            () -> new ApiException(HttpStatus.UNPROCESSABLE_CONTENT,
                                    "Nessuna strada vicino al punto " + idx)));
        }
        List<Long> edgeIds = new ArrayList<>();
        List<Integer> dirs = new ArrayList<>();
        Set<Long> used = new HashSet<>();
        List<RoadRepository.NodeHit> stops = new ArrayList<>(nodes);
        if (loop && nodes.getFirst().id() != nodes.getLast().id()) {
            stops.add(nodes.getFirst());
        }
        for (int i = 0; i + 1 < stops.size(); i++) {
            RoadRepository.NodeHit a = stops.get(i);
            RoadRepository.NodeHit b = stops.get(i + 1);
            if (a.id() == b.id()) {
                continue;
            }
            boolean returnLeg = loop && i == stops.size() - 2;
            List<long[]> leg = leg(a, b, profile, returnLeg ? used : Set.of());
            if (leg.isEmpty()) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT,
                        "Nessun percorso trovato tra il punto " + (i + 1) + " e il punto " + (i + 2));
            }
            for (long[] step : leg) {
                edgeIds.add(step[0]);
                dirs.add((int) step[1]);
                used.add(step[0]);
            }
        }
        if (edgeIds.isEmpty()) {
            throw ApiException.badRequest("Partenza e arrivo coincidono");
        }
        return assembler.assemble(edgeIds, dirs);
    }

    /** @return [edgeId, direction] in travel order, empty when unreachable */
    List<long[]> leg(RoadRepository.NodeHit a, RoadRepository.NodeHit b, PlanProfile profile,
            Collection<Long> penalized) {
        for (double margin : BBOX_MARGINS) {
            List<long[]> r = dijkstra(a, b, profile, penalized, margin);
            if (!r.isEmpty()) {
                return r;
            }
        }
        return List.of();
    }

    private List<long[]> dijkstra(RoadRepository.NodeHit a, RoadRepository.NodeHit b, PlanProfile profile,
            Collection<Long> penalized, double margin) {
        String penalty = penalized.isEmpty()
                ? ""
                : " * (CASE WHEN id IN (" + penalized.stream()
                        .map(String::valueOf)
                        .collect(Collectors.joining(",")) + ") THEN " + LOOP_PENALTY + " ELSE 1 END)";
        String bbox = margin < 0
                ? ""
                : " WHERE geom && ST_MakeEnvelope(%f, %f, %f, %f, 4326)".formatted(
                        Math.min(a.lon(), b.lon()) - margin, Math.min(a.lat(), b.lat()) - margin,
                        Math.max(a.lon(), b.lon()) + margin, Math.max(a.lat(), b.lat()) + margin);
        // Only numbers and constant SQL fragments are concatenated: no user input reaches this string.
        String edgesSql = """
                SELECT id, source, target,
                       CASE WHEN cost < 0 THEN -1 ELSE (%s)%s END AS cost,
                       CASE WHEN reverse_cost < 0 THEN -1 ELSE (%s)%s END AS reverse_cost
                FROM road_edges%s""".formatted(profile.forward, penalty, profile.backward, penalty, bbox);
        return jdbc.query("""
                SELECT d.node, d.edge, e.source
                FROM pgr_dijkstra(?, ?::bigint, ?::bigint, directed => true) d
                JOIN road_edges e ON e.id = d.edge
                ORDER BY d.path_seq""",
                (rs, i) -> new long[]{rs.getLong("edge"), rs.getLong("node") == rs.getLong("source") ? 1 : -1},
                edgesSql, a.id(), b.id());
    }
}
