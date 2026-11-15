package ch.zwiftfree.road;

import ch.zwiftfree.common.db.SqlArrays;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SegmentService {

    private final JdbcTemplate jdbc;

    public SegmentService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private record Seg(UUID id, String name, String type, List<Long> edges, List<Integer> dirs, double length,
            double grade, double ascent) {
    }

    /** Segments whose directed edges appear contiguously, in order, inside the route. */
    public List<SegmentOnRoute> onRoute(List<Long> edgeIds, List<Integer> dirs) {
        if (edgeIds.isEmpty()) {
            return List.of();
        }
        Map<Long, Double> lengths = new HashMap<>();
        jdbc.query("SELECT id, length_m FROM road_edges WHERE id = ANY(?)",
                rs -> {
                    lengths.put(rs.getLong(1), rs.getDouble(2));
                }, (Object) edgeIds.toArray(Long[]::new));
        double[] startAt = new double[edgeIds.size() + 1];
        for (int i = 0; i < edgeIds.size(); i++) {
            startAt[i + 1] = startAt[i] + lengths.getOrDefault(edgeIds.get(i), 0.0);
        }
        List<Seg> candidates = jdbc.query("""
                SELECT id, name, type, edge_ids, edge_directions, length_m, avg_grade, ascent_m FROM segments
                WHERE edge_ids <@ ?::bigint[]""",
                (rs, i) -> new Seg(rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("type"),
                        SqlArrays.longs(rs, "edge_ids"), SqlArrays.ints(rs, "edge_directions"),
                        rs.getDouble("length_m"), rs.getDouble("avg_grade"), rs.getDouble("ascent_m")),
                (Object) edgeIds.toArray(Long[]::new));
        List<SegmentOnRoute> out = new ArrayList<>();
        for (Seg s : candidates) {
            int at = indexOf(edgeIds, dirs, s.edges, s.dirs);
            if (at >= 0) {
                out.add(new SegmentOnRoute(s.id, s.name, s.type, round(startAt[at]),
                        round(startAt[at + s.edges.size()]), round(s.length), round(s.grade), round(s.ascent)));
            }
        }
        out.sort((a, b) -> Double.compare(a.startM(), b.startM()));
        return out;
    }

    static int indexOf(List<Long> edges, List<Integer> dirs, List<Long> sub, List<Integer> subDirs) {
        outer : for (int i = 0; i + sub.size() <= edges.size(); i++) {
            for (int k = 0; k < sub.size(); k++) {
                if (!edges.get(i + k).equals(sub.get(k)) || !dirs.get(i + k).equals(subDirs.get(k))) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }

    private static double round(double v) {
        return Math.round(v * 10) / 10.0;
    }
}
