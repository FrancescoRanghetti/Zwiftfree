package ch.zwiftfree.road;

import ch.zwiftfree.common.db.SqlArrays;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Persists automatically detected climbs and the segments of official routes. */
@Service
public class SegmentGenerator {

    private static final Logger log = LoggerFactory.getLogger(SegmentGenerator.class);

    /** Geometry assembled from the edges in travel order. */
    static final String GEOM_FROM_EDGES = """
            (SELECT ST_MakeLine(CASE WHEN u.dir = 1 THEN e.geom ELSE ST_Reverse(e.geom) END ORDER BY u.ord)
             FROM unnest(?::bigint[], ?::smallint[]) WITH ORDINALITY AS u(id, dir, ord)
             JOIN road_edges e ON e.id = u.id)""";

    private final JdbcTemplate jdbc;

    public SegmentGenerator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public int regenerateClimbs(boolean force) {
        Integer existing = jdbc.queryForObject("SELECT count(*) FROM segments WHERE source = 'AUTO'", Integer.class);
        if (!force && existing != null && existing > 0) {
            return existing;
        }
        long t0 = System.currentTimeMillis();
        List<ClimbDetector.Edge> edges = jdbc.query("""
                SELECT id, source, target, name, rank, length_m, ascent_m, descent_m, cost, reverse_cost
                FROM road_edges WHERE rank <= 7""",
                (rs, i) -> new ClimbDetector.Edge(rs.getLong("id"), rs.getLong("source"), rs.getLong("target"),
                        rs.getString("name"), rs.getInt("rank"), rs.getDouble("length_m"), rs.getDouble("ascent_m"),
                        rs.getDouble("descent_m"), rs.getDouble("cost") >= 0, rs.getDouble("reverse_cost") >= 0));
        List<ClimbDetector.Climb> climbs = ClimbDetector.detect(edges);
        jdbc.update("DELETE FROM segments WHERE source = 'AUTO'");
        jdbc.batchUpdate(
                """
                        INSERT INTO segments (name, type, source, edge_ids, edge_directions, geom, length_m, avg_grade, ascent_m)
                        VALUES (?, 'CLIMB', 'AUTO', ?, ?, %s, ?, ?, ?)"""
                        .formatted(GEOM_FROM_EDGES),
                new BatchPreparedStatementSetter() {

                    @Override
                    public void setValues(PreparedStatement ps, int i) throws SQLException {
                        ClimbDetector.Climb c = climbs.get(i);
                        ps.setString(1, c.roadName() == null ? "Salita" : "Salita " + c.roadName());
                        ps.setArray(2, SqlArrays.bigints(ps.getConnection(), c.edgeIds()));
                        ps.setArray(3, SqlArrays.smallints(ps.getConnection(), c.directions()));
                        ps.setArray(4, SqlArrays.bigints(ps.getConnection(), c.edgeIds()));
                        ps.setArray(5, SqlArrays.smallints(ps.getConnection(), c.directions()));
                        ps.setDouble(6, c.lengthM());
                        ps.setDouble(7, Math.round(c.avgGrade() * 10) / 10.0);
                        ps.setDouble(8, c.gainM());
                    }

                    @Override
                    public int getBatchSize() {
                        return climbs.size();
                    }
                });
        nameAndElevations("AUTO");
        log.info("Detected {} climbs in {} ms", climbs.size(), System.currentTimeMillis() - t0);
        return climbs.size();
    }

    /** Segment covering a whole official route (CLIMB when it rises, SPRINT otherwise). */
    @Transactional
    public void upsertRouteSegment(String slug, String name, List<Long> edgeIds, List<Integer> dirs, double lengthM,
            double ascentM, double descentM) {
        double net = ascentM - descentM;
        double grade = lengthM > 0 ? Math.round(net / lengthM * 1000) / 10.0 : 0;
        String type = grade >= 3 ? "CLIMB" : "SPRINT";
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    """
                            INSERT INTO segments (slug, name, type, source, edge_ids, edge_directions, geom, length_m, avg_grade,
                                                  ascent_m)
                            VALUES (?, ?, ?, 'ROUTE', ?, ?, %s, ?, ?, ?)
                            ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type,
                                edge_ids = EXCLUDED.edge_ids, edge_directions = EXCLUDED.edge_directions, geom = EXCLUDED.geom,
                                length_m = EXCLUDED.length_m, avg_grade = EXCLUDED.avg_grade, ascent_m = EXCLUDED.ascent_m, start_ele = NULL"""
                            .formatted(GEOM_FROM_EDGES));
            ps.setString(1, "route:" + slug);
            ps.setString(2, name);
            ps.setString(3, type);
            ps.setArray(4, SqlArrays.bigints(con, edgeIds));
            ps.setArray(5, SqlArrays.smallints(con, dirs));
            ps.setArray(6, SqlArrays.bigints(con, edgeIds));
            ps.setArray(7, SqlArrays.smallints(con, dirs));
            ps.setDouble(8, lengthM);
            ps.setDouble(9, grade);
            ps.setDouble(10, ascentM);
            return ps;
        });
        nameAndElevations("ROUTE");
    }

    /** Appends the locality nearest to the top ("Salita Via X – Rivera") and stores start/end elevations. */
    private void nameAndElevations(String source) {
        jdbc.update("""
                UPDATE segments s SET
                    start_ele = round(ST_Z(ST_StartPoint(s.geom))::numeric, 1),
                    end_ele = round(ST_Z(ST_EndPoint(s.geom))::numeric, 1),
                    name = CASE WHEN s.source = 'AUTO' THEN s.name || ' – ' || coalesce((
                        SELECT p.name FROM places p ORDER BY p.geom <-> ST_EndPoint(ST_Force2D(s.geom)) LIMIT 1), '')
                        ELSE s.name END
                WHERE s.source = ? AND s.start_ele IS NULL AND s.geom IS NOT NULL""", source);
    }
}
