package ch.zwiftfree.ride;

import ch.zwiftfree.ride.RideDtos.Explored;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** "Hai pedalato il 3.2% delle strade del Ticino": explored share by length plus the explored roads as GeoJSON. */
@Service
public class ExploredService {

    private final JdbcTemplate jdbc;
    private final JsonMapper json;

    public ExploredService(JdbcTemplate jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional(readOnly = true)
    public Explored explored(UUID userId) {
        return jdbc.queryForObject(
                """
                        WITH mine AS (
                            SELECT e.id, e.name, e.length_m, e.geom
                            FROM user_explored_edges u JOIN road_edges e ON e.id = u.edge_id
                            WHERE u.user_id = ?),
                        total AS (SELECT count(*) AS n, coalesce(sum(length_m), 0) AS len FROM road_edges)
                        SELECT (SELECT count(*) FROM mine) AS explored_n,
                               (SELECT coalesce(sum(length_m), 0) FROM mine) AS explored_len,
                               total.n AS total_n, total.len AS total_len,
                               json_build_object('type', 'FeatureCollection', 'features', coalesce(
                                   (SELECT json_agg(json_build_object(
                                        'type', 'Feature',
                                        'properties', json_build_object('id', id, 'name', name),
                                        'geometry', ST_AsGeoJSON(ST_Force2D(ST_SimplifyPreserveTopology(geom, 0.00002)), 6)::json))
                                    FROM mine), '[]'::json))::text AS geojson
                        FROM total""",
                (rs, i) -> {
                    double exploredLen = rs.getDouble("explored_len");
                    double totalLen = rs.getDouble("total_len");
                    double percent = totalLen <= 0 ? 0 : Math.round(exploredLen / totalLen * 100 * 100) / 100.0;
                    return new Explored(rs.getInt("explored_n"), rs.getInt("total_n"),
                            Math.round(exploredLen / 100) / 10.0, Math.round(totalLen / 100) / 10.0, percent,
                            json.readValue(rs.getString("geojson"), new TypeReference<Map<String, Object>>() {
                            }));
                }, userId);
    }
}
