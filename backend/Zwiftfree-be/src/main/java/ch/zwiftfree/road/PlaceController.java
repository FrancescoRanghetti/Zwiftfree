package ch.zwiftfree.road;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Tag(name = "places")
@SecurityRequirement(name = "bearer")
public class PlaceController {

    public record Place(long id, String name, String kind, Integer population, double lat, double lon) {
    }

    private final JdbcTemplate jdbc;

    public PlaceController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/places")
    @Operation(summary = "Search Ticino localities (accent-insensitive); empty query = main towns")
    public List<Place> search(@RequestParam(defaultValue = "") String q,
            @RequestParam(defaultValue = "10") int limit) {
        int n = Math.max(1, Math.min(limit, 25));
        String query = q.strip();
        if (query.isEmpty()) {
            return jdbc.query("""
                    SELECT id, name, kind, population, lat, lon FROM places
                    WHERE rank <= 3 ORDER BY rank, population DESC NULLS LAST, name LIMIT ?""",
                    (rs, i) -> map(rs), n);
        }
        String like = escapeLike(query.toLowerCase());
        return jdbc.query("""
                SELECT id, name, kind, population, lat, lon FROM places
                WHERE lower(f_unaccent(name)) LIKE '%' || lower(f_unaccent(?)) || '%'
                ORDER BY (lower(f_unaccent(name)) = lower(f_unaccent(?))) DESC,
                         (lower(f_unaccent(name)) LIKE lower(f_unaccent(?)) || '%') DESC,
                         rank, population DESC NULLS LAST, name
                LIMIT ?""", (rs, i) -> map(rs), like, query.toLowerCase(), like, n);
    }

    /** Every locality (about 900), loaded once by the ride screen to name the next village ahead. */
    @GetMapping("/api/places/all")
    @Operation(summary = "All Ticino localities")
    public List<Place> all() {
        return jdbc.query("SELECT id, name, kind, population, lat, lon FROM places ORDER BY rank, name",
                (rs, i) -> map(rs));
    }

    private static Place map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Place(rs.getLong("id"), rs.getString("name"), rs.getString("kind"),
                (Integer) rs.getObject("population"), rs.getDouble("lat"), rs.getDouble("lon"));
    }

    private static String escapeLike(String s) {
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
