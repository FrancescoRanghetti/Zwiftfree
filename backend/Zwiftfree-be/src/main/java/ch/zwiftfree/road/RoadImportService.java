package ch.zwiftfree.road;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.Statement;
import java.util.HexFormat;
import java.util.Optional;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Loads data/out (scarica_ticino.py output) into road_nodes/road_edges when the tables are empty or stats.json
 * changed, then adds the columns, indexes and the simplified view used by tiles and routing.
 */
@Service
public class RoadImportService {

    private static final Logger log = LoggerFactory.getLogger(RoadImportService.class);

    /** Lower = more important road. Used for tiles at low zoom and for "stay on the main road" choices. */
    static final String RANK_SQL = """
            CASE highway
                WHEN 'trunk' THEN 1 WHEN 'trunk_link' THEN 2
                WHEN 'primary' THEN 2 WHEN 'primary_link' THEN 3
                WHEN 'secondary' THEN 3 WHEN 'secondary_link' THEN 4
                WHEN 'tertiary' THEN 4 WHEN 'tertiary_link' THEN 5
                WHEN 'unclassified' THEN 5 WHEN 'road' THEN 5
                WHEN 'residential' THEN 6 WHEN 'living_street' THEN 7 WHEN 'cycleway' THEN 6
                WHEN 'service' THEN 8 WHEN 'track' THEN 8
                ELSE 9 END""";

    private static final String[] POST_IMPORT = {
            "ALTER TABLE road_edges ADD COLUMN IF NOT EXISTS rank smallint",
            "UPDATE road_edges SET rank = " + RANK_SQL,
            "ALTER TABLE road_edges ADD COLUMN IF NOT EXISTS geom_3857 geometry(LineString, 3857)",
            "UPDATE road_edges SET geom_3857 = ST_Transform(ST_Force2D(geom), 3857)",
            // Steepest grade regardless of direction, for colouring the map.
            "ALTER TABLE road_edges ADD COLUMN IF NOT EXISTS steepest real",
            "UPDATE road_edges SET steepest = greatest(abs(coalesce(max_grade, 0)), abs(coalesce(min_grade, 0)))",
            "CREATE INDEX IF NOT EXISTS road_edges_geom_3857_idx ON road_edges USING gist (geom_3857)",
            // Waypoints only snap to junctions of the main connected network, never to isolated fragments.
            "ALTER TABLE road_nodes ADD COLUMN IF NOT EXISTS component bigint",
            """
                    UPDATE road_nodes n SET component = c.component
                    FROM pgr_connectedComponents(
                        'SELECT id, source, target, 1.0 AS cost, 1.0 AS reverse_cost FROM road_edges') c
                    WHERE c.node = n.id""",
            "ALTER TABLE road_nodes ADD COLUMN IF NOT EXISTS routable boolean NOT NULL DEFAULT false",
            """
                    UPDATE road_nodes SET routable = (component = (
                        SELECT component FROM road_nodes WHERE component IS NOT NULL
                        GROUP BY component ORDER BY count(*) DESC LIMIT 1))""",
            "CREATE INDEX IF NOT EXISTS road_nodes_routable_geom_idx ON road_nodes USING gist (geom) WHERE routable",
            "CREATE INDEX IF NOT EXISTS road_edges_rank_idx ON road_edges (rank)",
            """
                    CREATE MATERIALIZED VIEW road_edges_display AS
                    SELECT id, name, highway, rank, steepest, length_m, ascent_m, descent_m, oneway,
                           ST_SimplifyPreserveTopology(geom_3857, 15) AS geom_3857
                    FROM road_edges WHERE rank <= 6""",
            "CREATE INDEX road_edges_display_geom_idx ON road_edges_display USING gist (geom_3857)",
            "CREATE INDEX road_edges_display_rank_idx ON road_edges_display (rank)",
            "ANALYZE road_edges",
            "ANALYZE road_edges_display"
    };

    private final DataSource dataSource;
    private final JdbcTemplate jdbc;
    private final RoadProperties props;
    private final ApplicationEventPublisher events;

    public RoadImportService(DataSource dataSource, JdbcTemplate jdbc, RoadProperties props,
            ApplicationEventPublisher events) {
        this.dataSource = dataSource;
        this.jdbc = jdbc;
        this.props = props;
        this.events = events;
    }

    /** Imports if needed and publishes {@link RoadNetworkImportedEvent} when a network is available. */
    public void importIfNeeded() {
        Optional<Path> dir = dataDir();
        boolean networkPresent = roadTablesPresent() && edgeCount() > 0;
        if (dir.isEmpty() || !props.importEnabled()) {
            if (networkPresent) {
                events.publishEvent(new RoadNetworkImportedEvent(false));
            } else {
                log.warn("No road network loaded and no data folder configured (ROAD_DATA_DIR). "
                        + "Run data/scarica_ticino.py and set ROAD_DATA_DIR to its out/ folder.");
            }
            return;
        }
        String hash = statsHash(dir.get());
        String current = networkPresent
                ? jdbc.query("SELECT stats_hash FROM road_import_state",
                        rs -> rs.next() ? rs.getString(1) : null)
                : null;
        if (networkPresent && hash.equals(current)) {
            log.info("Road network up to date ({} edges)", edgeCount());
            events.publishEvent(new RoadNetworkImportedEvent(false));
            return;
        }
        runImport(dir.get(), hash);
        events.publishEvent(new RoadNetworkImportedEvent(true));
    }

    void runImport(Path dir, String hash) {
        long t0 = System.currentTimeMillis();
        log.info("Importing road network from {} ...", dir);
        try (Connection conn = dataSource.getConnection()) {
            boolean autoCommit = conn.getAutoCommit();
            conn.setAutoCommit(false);
            try {
                try (Statement st = conn.createStatement()) {
                    st.execute("DROP MATERIALIZED VIEW IF EXISTS road_edges_display");
                }
                SqlScriptRunner.run(conn, dir.resolve("load_postgis.sql"));
                try (Statement st = conn.createStatement()) {
                    for (String sql : POST_IMPORT) {
                        st.execute(sql);
                    }
                    st.execute(
                            """
                                    INSERT INTO road_import_state (id, stats_hash, edges, nodes, imported_at)
                                    VALUES (1, '%s', (SELECT count(*) FROM road_edges), (SELECT count(*) FROM road_nodes), now())
                                    ON CONFLICT (id) DO UPDATE SET stats_hash = EXCLUDED.stats_hash, edges = EXCLUDED.edges,
                                        nodes = EXCLUDED.nodes, imported_at = EXCLUDED.imported_at"""
                                    .formatted(hash));
                }
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                throw e;
            } finally {
                conn.setAutoCommit(autoCommit);
            }
        } catch (Exception e) {
            throw new IllegalStateException("Road network import failed: " + e.getMessage(), e);
        }
        log.info("Road network imported: {} edges in {} s", edgeCount(), (System.currentTimeMillis() - t0) / 1000);
    }

    public boolean roadTablesPresent() {
        Boolean present = jdbc.queryForObject(
                "SELECT to_regclass('public.road_edges') IS NOT NULL AND to_regclass('public.road_edges_display') IS NOT NULL",
                Boolean.class);
        return Boolean.TRUE.equals(present);
    }

    public long edgeCount() {
        if (!roadTablesPresent()) {
            return 0;
        }
        Long n = jdbc.queryForObject("SELECT count(*) FROM road_edges", Long.class);
        return n == null ? 0 : n;
    }

    public Optional<String> importedHash() {
        return Optional.ofNullable(jdbc.query("SELECT stats_hash FROM road_import_state",
                rs -> rs.next() ? rs.getString(1) : null));
    }

    private Optional<Path> dataDir() {
        if (props.dataDir() == null || props.dataDir().isBlank()) {
            return Optional.empty();
        }
        Path dir = Path.of(props.dataDir()).toAbsolutePath().normalize();
        if (!Files.isRegularFile(dir.resolve("load_postgis.sql")) || !Files.isRegularFile(dir.resolve("stats.json"))) {
            log.warn("Road data folder {} has no load_postgis.sql/stats.json: skipping import", dir);
            return Optional.empty();
        }
        return Optional.of(dir);
    }

    /** Bump when the post-import processing changes, to force a re-import of unchanged data. */
    static final String PROCESSING_VERSION = "5";

    static String statsHash(Path dir) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(Files.readAllBytes(dir.resolve("stats.json")));
            md.update(("processing:" + PROCESSING_VERSION).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(md.digest());
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Cannot hash stats.json", e);
        }
    }
}
