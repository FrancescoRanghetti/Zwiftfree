package ch.zwiftfree.road;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.lessThan;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.zwiftfree.IntegrationTest;
import com.jayway.jsonpath.JsonPath;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** Runs against the fixture network (Cadenazzo – Monte Ceneri – Bellinzona) imported at startup. */
class RoadIntegrationTest extends IntegrationTest {

    static final String CADENAZZO = "{\"lat\":46.1517,\"lon\":8.9479}";
    static final String CENERI = "{\"lat\":46.1405,\"lon\":8.9130}";

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void importCreatesNetworkViewsAndState() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM road_edges", Long.class)).isEqualTo(4694);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM road_edges_display", Long.class)).isGreaterThan(1000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM road_edges WHERE geom_3857 IS NULL OR rank IS NULL",
                Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT edges FROM road_import_state", Integer.class)).isEqualTo(4694);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM places", Long.class)).isGreaterThan(800);
        long routable = jdbc.queryForObject("SELECT count(*) FROM road_nodes WHERE routable", Long.class);
        long all = jdbc.queryForObject("SELECT count(*) FROM road_nodes", Long.class);
        assertThat(routable).isGreaterThan(all / 2).isLessThanOrEqualTo(all);
    }

    @Test
    void tilesArePublicCachedVectorTiles() throws Exception {
        // z14 tile containing Cadenazzo
        byte[] body = mvc.perform(get("/api/tiles/roads/14/8599/5819.mvt"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/vnd.mapbox-vector-tile"))
                .andExpect(header().string("Cache-Control", "max-age=86400, public"))
                .andReturn()
                .getResponse()
                .getContentAsByteArray();
        assertThat(body.length).isGreaterThan(1000);
        // Low zoom uses the simplified view, still returns data
        assertThat(mvc.perform(get("/api/tiles/roads/10/537/363.mvt"))
                .andReturn()
                .getResponse()
                .getContentAsByteArray().length).isGreaterThan(0);
        // Far outside Ticino: empty tile
        assertThat(mvc.perform(get("/api/tiles/roads/14/0/0.mvt"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsByteArray()).isEmpty();
    }

    @Test
    void nearestAndEdgeDetails() throws Exception {
        Session s = register();
        String body = authed(get("/api/roads/nearest?lat=46.1517&lon=8.9479"), s)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.node.distanceM", lessThan(300.0)))
                .andReturn()
                .getResponse()
                .getContentAsString();
        int edgeId = JsonPath.read(body, "$.edge.id");
        authed(get("/api/roads/edges/" + edgeId), s)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coordinates[0]", hasSize(3)))
                .andExpect(jsonPath("$.lengthM", greaterThan(0.0)));
        authed(get("/api/roads/nearest?lat=46.53&lon=8.61"), s).andExpect(status().isNotFound());
    }

    @Test
    void nextOffersOnlyLegalTurnsWithOnePreferred() throws Exception {
        Session s = register();
        // A two-way edge whose end node is a real junction (3+ edges)
        Map<String, Object> e = jdbc.queryForMap("""
                SELECT e.id FROM road_edges e
                WHERE e.cost >= 0 AND e.reverse_cost >= 0 AND e.rank <= 4
                  AND (SELECT count(*) FROM road_edges x WHERE x.source = e.target OR x.target = e.target) >= 3
                ORDER BY e.id LIMIT 1""");
        String body = authed(get("/api/roads/next?edgeId=" + e.get("id") + "&direction=1"), s)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        List<Map<String, Object>> options = JsonPath.read(body, "$");
        assertThat(options).hasSizeGreaterThanOrEqualTo(2);
        assertThat(options.stream().filter(o -> (Boolean) o.get("preferred")).count()).isEqualTo(1);
        for (Map<String, Object> o : options) {
            long id = ((Number) o.get("edgeId")).longValue();
            int dir = ((Number) o.get("direction")).intValue();
            Double cost = jdbc.queryForObject(
                    "SELECT CASE WHEN ? = 1 THEN cost ELSE reverse_cost END FROM road_edges WHERE id = ?",
                    Double.class, dir, id);
            assertThat(cost).as("never against a one-way").isGreaterThanOrEqualTo(0);
        }
    }

    @Test
    void planShortestCadenazzoToCeneri() throws Exception {
        Session s = register();
        String body = authedJson(post("/api/roads/plan"), s, """
                {"waypoints":[%s,%s],"profile":"SHORTEST"}""".formatted(CADENAZZO, CENERI))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lengthM", greaterThan(5000.0)))
                .andExpect(jsonPath("$.lengthM", lessThan(10000.0)))
                .andExpect(jsonPath("$.ascentM", greaterThan(250.0)))
                .andExpect(jsonPath("$.loop").value(false))
                .andReturn()
                .getResponse()
                .getContentAsString();
        List<Integer> ids = JsonPath.read(body, "$.edgeIds");
        List<List<Double>> profile = JsonPath.read(body, "$.profile");
        assertThat(ids).isNotEmpty();
        assertThat(profile.size()).isGreaterThan(100);
        double shortest = ((Number) JsonPath.read(body, "$.lengthM")).doubleValue();

        for (String profileName : List.of("AVOID_CLIMBS", "SEEK_CLIMBS", "QUIET")) {
            String other = authedJson(post("/api/roads/plan"), s, """
                    {"waypoints":[%s,%s],"profile":"%s"}""".formatted(CADENAZZO, CENERI, profileName))
                    .andExpect(status().isOk())
                    .andReturn()
                    .getResponse()
                    .getContentAsString();
            assertThat(((Number) JsonPath.read(other, "$.lengthM")).doubleValue())
                    .as(profileName + " is never shorter than SHORTEST")
                    .isGreaterThanOrEqualTo(shortest - 0.5);
        }
    }

    @Test
    void planLoopReturnsToStart() throws Exception {
        Session s = register();
        String body = authedJson(post("/api/roads/plan"), s, """
                {"waypoints":[%s,%s],"profile":"SHORTEST","loop":true}""".formatted(CADENAZZO, CENERI))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.loop").value(true))
                .andReturn()
                .getResponse()
                .getContentAsString();
        List<List<Double>> c = JsonPath.read(body, "$.coordinates");
        assertThat(c.getFirst().get(0)).isEqualTo(c.getLast().get(0));
        assertThat(c.getFirst().get(1)).isEqualTo(c.getLast().get(1));
    }

    @Test
    void planRejectsBadInput() throws Exception {
        Session s = register();
        authedJson(post("/api/roads/plan"), s, """
                {"waypoints":[%s]}""".formatted(CADENAZZO)).andExpect(status().isBadRequest());
        authedJson(post("/api/roads/plan"), s, """
                {"waypoints":[%s,{"lat":46.53,"lon":8.61}]}""".formatted(CADENAZZO))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.detail").value("Nessuna strada vicino al punto 2"));
        authedJson(post("/api/roads/plan"), s, """
                {"waypoints":[%s,{"lat":48.0,"lon":8.61}]}""".formatted(CADENAZZO))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors['waypoints[1].lat']").value("Fuori dal Ticino"));
        mvc.perform(post("/api/roads/plan")).andExpect(status().isUnauthorized());
    }

    @Test
    void placesSearchIsAccentInsensitiveAndRanked() throws Exception {
        Session s = register();
        authed(get("/api/places?q=bellin"), s)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Bellinzona"));
        authed(get("/api/places?q=bre sopra lug"), s)
                .andExpect(jsonPath("$[0].name").value("Brè sopra Lugano"));
        authed(get("/api/places"), s)
                .andExpect(jsonPath("$[0].name").value("Lugano"))
                .andExpect(jsonPath("$", hasSize(10)));
        authed(get("/api/places?q=%25"), s).andExpect(content().string("[]"));
        authed(get("/api/places/all"), s).andExpect(jsonPath("$.length()", greaterThan(800)));
    }

    @Test
    void climbsAreDetected() {
        List<Map<String, Object>> climbs = jdbc.queryForList(
                "SELECT name, length_m, avg_grade, ascent_m, start_ele, end_ele FROM segments WHERE source = 'AUTO'");
        assertThat(climbs).isNotEmpty();
        for (Map<String, Object> c : climbs) {
            assertThat(((Number) c.get("length_m")).doubleValue()).isGreaterThanOrEqualTo(800);
            assertThat(((Number) c.get("avg_grade")).doubleValue()).isGreaterThan(4);
            assertThat(((Number) c.get("ascent_m")).doubleValue()).isGreaterThanOrEqualTo(50);
            assertThat((String) c.get("name")).startsWith("Salita").contains(" – ");
            assertThat(((Number) c.get("end_ele")).doubleValue())
                    .isGreaterThan(((Number) c.get("start_ele")).doubleValue());
        }
    }
}
