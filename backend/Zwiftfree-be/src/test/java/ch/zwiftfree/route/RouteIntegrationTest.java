package ch.zwiftfree.route;

import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.zwiftfree.IntegrationTest;
import com.jayway.jsonpath.JsonPath;
import java.util.List;
import org.junit.jupiter.api.Test;

class RouteIntegrationTest extends IntegrationTest {

    @Test
    void officialRouteIsListedWithSegmentAndProfile() throws Exception {
        Session s = register();
        String list = authed(get("/api/routes"), s)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].official").value(true))
                .andExpect(jsonPath("$[?(@.slug == 'cadenazzo-monte-ceneri')].name").value(
                        hasItem("Cadenazzo – Monte Ceneri")))
                .andReturn()
                .getResponse()
                .getContentAsString();
        String id = JsonPath.<List<String>>read(list, "$[?(@.slug == 'cadenazzo-monte-ceneri')].id").getFirst();
        authed(get("/api/routes/" + id), s)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.lengthM", greaterThan(5000.0)))
                .andExpect(jsonPath("$.coordinates.length()", greaterThan(100)))
                .andExpect(jsonPath("$.elevationProfile.length()", greaterThan(100)))
                .andExpect(jsonPath("$.segments[?(@.name == 'Cadenazzo – Monte Ceneri')].startM").value(hasItem(0.0)));
    }

    @Test
    void usersSaveTheirOwnRoutesAndOnlySeeVisibleOnes() throws Exception {
        Session owner = register();
        Session other = register();
        String plan = authedJson(post("/api/roads/plan"), owner, """
                {"waypoints":[{"lat":46.1517,"lon":8.9479},{"lat":46.1921,"lon":9.0206}],"profile":"QUIET"}""")
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        List<Integer> ids = JsonPath.read(plan, "$.edgeIds");
        List<Integer> dirs = JsonPath.read(plan, "$.directions");
        String created = authedJson(post("/api/routes"), owner, """
                {"name":"Verso Bellinzona","description":"Tranquillo","isPublic":false,
                 "edgeIds":%s,"directions":%s,"profile":"QUIET"}""".formatted(ids, dirs))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.summary.mine").value(true))
                .andExpect(jsonPath("$.summary.official").value(false))
                .andExpect(jsonPath("$.summary.profile").value("QUIET"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        String id = JsonPath.read(created, "$.summary.id");

        authed(get("/api/routes/" + id), other).andExpect(status().isNotFound());
        authed(delete("/api/routes/" + id), other).andExpect(status().isNotFound());
        authed(get("/api/routes"), other)
                .andExpect(jsonPath("$[?(@.id == '%s')]".formatted(id)).isEmpty());

        authed(delete("/api/routes/" + id), owner).andExpect(status().isNoContent());
        authed(get("/api/routes/" + id), owner).andExpect(status().isNotFound());
    }

    @Test
    void publicRoutesAreVisibleToOthers() throws Exception {
        Session owner = register();
        Session other = register();
        String plan = authedJson(post("/api/roads/plan"), owner, """
                {"waypoints":[{"lat":46.1517,"lon":8.9479},{"lat":46.1405,"lon":8.9130}]}""")
                .andReturn()
                .getResponse()
                .getContentAsString();
        String created = authedJson(post("/api/routes"), owner, """
                {"name":"Pubblico","isPublic":true,"edgeIds":%s,"directions":%s}""".formatted(
                JsonPath.read(plan, "$.edgeIds").toString(), JsonPath.read(plan, "$.directions").toString()))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String id = JsonPath.read(created, "$.summary.id");
        authed(get("/api/routes/" + id), other)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.mine").value(false));
    }

    @Test
    void officialRoutesCannotBeDeletedAndBrokenRoutesAreRejected() throws Exception {
        Session s = register();
        String list = authed(get("/api/routes"), s).andReturn().getResponse().getContentAsString();
        String official = JsonPath.<List<String>>read(list, "$[?(@.official == true)].id").getFirst();
        authed(delete("/api/routes/" + official), s).andExpect(status().isNotFound());

        String detail = authed(get("/api/routes/" + official), s).andReturn().getResponse().getContentAsString();
        List<Integer> ids = JsonPath.read(detail, "$.edgeIds");
        // Drop a middle edge: the chain is no longer connected.
        List<Integer> broken = new java.util.ArrayList<>(ids);
        broken.remove(broken.size() / 2);
        List<Integer> dirs = new java.util.ArrayList<>(JsonPath.<List<Integer>>read(detail, "$.directions"));
        dirs.remove(dirs.size() / 2);
        authedJson(post("/api/routes"), s, """
                {"name":"Rotto","edgeIds":%s,"directions":%s}""".formatted(broken, dirs))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("non sono collegate")));
        authedJson(post("/api/routes"), s, """
                {"name":"","edgeIds":[],"directions":[]}""")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.name").value("Il nome è obbligatorio"));
    }
}
