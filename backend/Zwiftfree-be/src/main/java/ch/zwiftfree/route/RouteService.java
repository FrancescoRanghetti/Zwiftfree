package ch.zwiftfree.route;

import ch.zwiftfree.common.db.SqlArrays;
import ch.zwiftfree.common.web.ApiException;
import ch.zwiftfree.common.web.NotFoundException;
import ch.zwiftfree.road.Geo;
import ch.zwiftfree.road.PlannedRoute;
import ch.zwiftfree.road.RouteAssembler;
import ch.zwiftfree.road.SegmentService;
import ch.zwiftfree.route.RouteDtos.CreateRoute;
import ch.zwiftfree.route.RouteDtos.RouteDetail;
import ch.zwiftfree.route.RouteDtos.RouteSummary;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Saved routes: official (owner NULL) and user-made. Geometry is kept with the route, so it survives re-imports. */
@Service
public class RouteService {

    private static final String SUMMARY_COLUMNS = """
            r.id, r.slug, r.name, r.description, r.owner_id, r.is_public, r.length_m, r.ascent_m, r.descent_m,
            r.min_ele, r.max_ele, r.max_grade, r.is_loop, r.profile, r.created_at,
            ST_AsText(ST_Force2D(ST_SimplifyPreserveTopology(r.geom, 0.0008))) AS preview_wkt""";

    /** Official, own, or public routes. */
    private static final String VISIBLE = "(r.owner_id IS NULL OR r.owner_id = ? OR r.is_public)";

    private final JdbcTemplate jdbc;
    private final RouteAssembler assembler;
    private final SegmentService segments;

    public RouteService(JdbcTemplate jdbc, RouteAssembler assembler, SegmentService segments) {
        this.jdbc = jdbc;
        this.assembler = assembler;
        this.segments = segments;
    }

    @Transactional(readOnly = true)
    public List<RouteSummary> list(UUID userId) {
        return jdbc.query("SELECT " + SUMMARY_COLUMNS + " FROM routes r WHERE " + VISIBLE
                + " ORDER BY (r.owner_id IS NULL) DESC, r.created_at DESC",
                (rs, i) -> summary(rs, userId), userId);
    }

    @Transactional(readOnly = true)
    public RouteDetail get(UUID userId, UUID routeId) {
        record Row(RouteSummary summary, List<Long> edges, List<Integer> dirs, String wkt) {
        }
        Row row = jdbc.query("SELECT " + SUMMARY_COLUMNS + ", r.edge_ids, r.edge_directions, ST_AsText(r.geom) AS wkt"
                + " FROM routes r WHERE r.id = ? AND " + VISIBLE,
                (rs, i) -> new Row(summary(rs, userId), SqlArrays.longs(rs, "edge_ids"),
                        SqlArrays.ints(rs, "edge_directions"), rs.getString("wkt")),
                routeId, userId).stream().findFirst().orElseThrow(() -> new NotFoundException("Percorso non trovato"));
        double[][] coords = parse(row.wkt());
        double[] dist = new double[coords.length];
        for (int i = 1; i < coords.length; i++) {
            dist[i] = dist[i - 1] + Geo.distance(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
        }
        return new RouteDetail(row.summary(), row.edges(), row.dirs(), edgeStarts(row.edges(), row.dirs(), coords),
                coords,
                RouteAssembler.elevationProfile(coords, dist), segments.onRoute(row.edges(), row.dirs()));
    }

    /** Edge boundaries, only if today's network still produces exactly the stored geometry. */
    private double[] edgeStarts(List<Long> edges, List<Integer> dirs, double[][] coords) {
        try {
            PlannedRoute p = assembler.assemble(edges, dirs);
            return p.coordinates().length == coords.length ? p.edgeStartsM() : null;
        } catch (ApiException e) {
            return null;
        }
    }

    @Transactional
    public RouteDetail create(UUID userId, CreateRoute req) {
        PlannedRoute planned = assembler.assemble(req.edgeIds(), req.directions());
        UUID id = insert(userId, null, req.name().strip(), blankToNull(req.description()), req.isPublic(), planned,
                req.profile());
        return get(userId, id);
    }

    @Transactional
    public void delete(UUID userId, UUID routeId) {
        int n = jdbc.update("DELETE FROM routes WHERE id = ? AND owner_id = ?", routeId, userId);
        if (n == 0) {
            throw new NotFoundException("Percorso non trovato");
        }
    }

    /** Creates or replaces an official route (owner NULL) identified by slug. */
    @Transactional
    public UUID upsertOfficial(String slug, String name, String description, PlannedRoute planned, String profile) {
        Optional<UUID> existing = jdbc.query("SELECT id FROM routes WHERE slug = ?",
                (rs, i) -> rs.getObject(1, UUID.class), slug).stream().findFirst();
        existing.ifPresent(id -> jdbc.update("DELETE FROM routes WHERE id = ?", id));
        return insert(null, slug, name, description, false, planned, profile);
    }

    public boolean officialExists(String slug) {
        Boolean b = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM routes WHERE slug = ? AND owner_id IS NULL)",
                Boolean.class, slug);
        return Boolean.TRUE.equals(b);
    }

    private UUID insert(UUID ownerId, String slug, String name, String description, boolean isPublic,
            PlannedRoute p, String profile) {
        if (p.coordinates().length < 2) {
            throw ApiException.badRequest("Percorso troppo corto");
        }
        UUID id = UUID.randomUUID();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("""
                    INSERT INTO routes (id, owner_id, slug, name, description, is_public, edge_ids, edge_directions,
                                        geom, length_m, ascent_m, descent_m, min_ele, max_ele, max_grade, is_loop,
                                        profile, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ST_GeomFromText(?, 4326), ?, ?, ?, ?, ?, ?, ?, ?, now())""");
            ps.setObject(1, id);
            ps.setObject(2, ownerId, Types.OTHER);
            ps.setString(3, slug);
            ps.setString(4, name);
            ps.setString(5, description);
            ps.setBoolean(6, isPublic);
            ps.setArray(7, SqlArrays.bigints(con, p.edgeIds()));
            ps.setArray(8, SqlArrays.smallints(con, p.directions()));
            ps.setString(9, toWkt(p.coordinates()));
            ps.setDouble(10, p.lengthM());
            ps.setDouble(11, p.ascentM());
            ps.setDouble(12, p.descentM());
            ps.setDouble(13, p.minEle());
            ps.setDouble(14, p.maxEle());
            ps.setDouble(15, p.maxGrade());
            ps.setBoolean(16, p.loop());
            ps.setString(17, profile);
            return ps;
        });
        return id;
    }

    private static RouteSummary summary(ResultSet rs, UUID userId) throws SQLException {
        UUID owner = rs.getObject("owner_id", UUID.class);
        Instant created = rs.getTimestamp("created_at").toInstant();
        return new RouteSummary(rs.getObject("id", UUID.class), rs.getString("slug"), rs.getString("name"),
                rs.getString("description"), owner == null, owner != null && owner.equals(userId),
                rs.getBoolean("is_public"), rs.getDouble("length_m"), rs.getDouble("ascent_m"),
                rs.getDouble("descent_m"), rs.getDouble("min_ele"), rs.getDouble("max_ele"),
                rs.getDouble("max_grade"), rs.getBoolean("is_loop"), rs.getString("profile"), created,
                preview(rs.getString("preview_wkt")));
    }

    private static double[][] preview(String wkt) {
        double[][] c = parse(wkt);
        double[][] out = new double[c.length][];
        for (int i = 0; i < c.length; i++) {
            out[i] = new double[]{Math.round(c[i][0] * 1e5) / 1e5, Math.round(c[i][1] * 1e5) / 1e5};
        }
        return out;
    }

    private static double[][] parse(String wkt) {
        return ch.zwiftfree.road.WktLines.parse(wkt);
    }

    private static String toWkt(double[][] c) {
        return ch.zwiftfree.road.WktLines.toLineStringZ(c);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
