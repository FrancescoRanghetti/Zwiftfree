package ch.zwiftfree.road;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class RoadRepository {

    static final String EDGE_COLUMNS = """
            e.id, e.source, e.target, e.name, e.highway, e.surface, e.oneway, e.rank, e.length_m, e.ascent_m,
            e.descent_m, e.avg_grade, e.max_grade, e.min_grade, e.cost, e.reverse_cost, ST_AsText(e.geom) AS wkt""";

    static final RowMapper<RoadEdge> EDGE_MAPPER = RoadRepository::mapEdge;

    public record NodeHit(long id, double lon, double lat, double ele, double distanceM) {
    }

    public record EdgeHit(RoadEdge edge, double distanceM, double fraction) {
    }

    private final JdbcTemplate jdbc;

    public RoadRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Nearest junction of the main connected network, within {@code maxM} metres. */
    public Optional<NodeHit> nearestNode(double lat, double lon, double maxM) {
        List<NodeHit> hits = jdbc.query("""
                WITH p AS (SELECT ST_SetSRID(ST_MakePoint(?, ?), 4326) AS g)
                SELECT n.id, n.lon, n.lat, n.ele, ST_Distance(n.geom::geography, p.g::geography) AS d
                FROM road_nodes n, p
                WHERE n.routable
                ORDER BY n.geom <-> p.g
                LIMIT 1""",
                (rs, i) -> new NodeHit(rs.getLong("id"), rs.getDouble("lon"), rs.getDouble("lat"), rs.getDouble("ele"),
                        rs.getDouble("d")),
                lon, lat);
        return hits.stream().filter(h -> h.distanceM() <= maxM).findFirst();
    }

    public Optional<EdgeHit> nearestEdge(double lat, double lon, double maxM) {
        List<EdgeHit> hits = jdbc.query("""
                WITH p AS (SELECT ST_SetSRID(ST_MakePoint(?, ?), 4326) AS g)
                SELECT %s,
                       ST_Distance(e.geom::geography, p.g::geography) AS d,
                       ST_LineLocatePoint(ST_Force2D(e.geom), p.g) AS f
                FROM road_edges e, p
                ORDER BY e.geom <-> p.g
                LIMIT 1""".formatted(EDGE_COLUMNS),
                (rs, i) -> new EdgeHit(mapEdge(rs, i), rs.getDouble("d"), rs.getDouble("f")),
                lon, lat);
        return hits.stream().filter(h -> h.distanceM() <= maxM).findFirst();
    }

    public Optional<RoadEdge> edge(long id) {
        return jdbc.query("SELECT " + EDGE_COLUMNS + " FROM road_edges e WHERE e.id = ?", EDGE_MAPPER, id)
                .stream()
                .findFirst();
    }

    /** Edges by id, in no particular order. */
    public Map<Long, RoadEdge> edges(Collection<Long> ids) {
        Map<Long, RoadEdge> out = new LinkedHashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        jdbc.query("SELECT " + EDGE_COLUMNS + " FROM road_edges e WHERE e.id = ANY(?)",
                rs -> {
                    RoadEdge e = mapEdge(rs, 0);
                    out.put(e.id(), e);
                },
                (Object) ids.toArray(Long[]::new));
        return out;
    }

    /** Every edge touching the node (in either direction; callers check {@link RoadEdge#canTravel}). */
    public List<RoadEdge> edgesAt(long nodeId) {
        return jdbc.query("SELECT " + EDGE_COLUMNS + " FROM road_edges e WHERE e.source = ? OR e.target = ?",
                EDGE_MAPPER, nodeId, nodeId);
    }

    public List<RoadEdge> area(double lat, double lon, double radiusM) {
        return jdbc.query("""
                SELECT %s FROM road_edges e
                WHERE ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
                """.formatted(EDGE_COLUMNS), EDGE_MAPPER, lon, lat, radiusM);
    }

    static RoadEdge mapEdge(ResultSet rs, int row) throws SQLException {
        return new RoadEdge(
                rs.getLong("id"),
                rs.getLong("source"),
                rs.getLong("target"),
                rs.getString("name"),
                rs.getString("highway"),
                rs.getString("surface"),
                rs.getInt("oneway"),
                rs.getInt("rank"),
                rs.getDouble("length_m"),
                rs.getDouble("ascent_m"),
                rs.getDouble("descent_m"),
                rs.getDouble("avg_grade"),
                rs.getDouble("max_grade"),
                rs.getDouble("min_grade"),
                rs.getDouble("cost"),
                rs.getDouble("reverse_cost"),
                Wkt.lineString(rs.getString("wkt")));
    }
}
