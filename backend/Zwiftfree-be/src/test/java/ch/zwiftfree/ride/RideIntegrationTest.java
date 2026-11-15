package ch.zwiftfree.ride;

import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.zwiftfree.IntegrationTest;
import com.jayway.jsonpath.JsonPath;
import java.util.List;
import java.util.StringJoiner;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RideIntegrationTest extends IntegrationTest {

    private String plan(Session s) throws Exception {
        return authedJson(post("/api/roads/plan"), s, """
                {"waypoints":[{"lat":46.1517,"lon":8.9479},{"lat":46.1405,"lon":8.9130}]}""")
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    private String startRide(Session s, String body) throws Exception {
        String created = authedJson(post("/api/rides"), s, body)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        return JsonPath.read(created, "$.id");
    }

    /** {@code seconds} samples at 200 W, 36 km/h (10 m/s), climbing 0.1 m per second. */
    private static String samples(int from, int seconds, List<Integer> edges, List<Integer> dirs) {
        StringJoiner sj = new StringJoiner(",");
        for (int t = from; t < from + seconds; t++) {
            sj.add("""
                    {"t":%d,"distanceM":%d,"lat":46.15,"lon":8.94,"ele":%.1f,"grade":1.0,"power":200,"cadence":90,
                     "hr":140,"speedKmh":36,"avatarState":"RIDING","edgeId":%d,"edgeOffsetM":5}"""
                    .formatted(t, t * 10, 200 + t * 0.1, edges.getFirst()));
        }
        StringJoiner ej = new StringJoiner(",");
        for (int i = 0; i < edges.size(); i++) {
            ej.add("{\"seq\":%d,\"edgeId\":%d,\"direction\":%d}".formatted(i, edges.get(i), dirs.get(i)));
        }
        return "{\"samples\":[" + sj + "],\"edges\":[" + ej + "]}";
    }

    @Test
    void fullRideLifecycle() throws Exception {
        Session s = register();
        String plan = plan(s);
        List<Integer> edges = JsonPath.<List<Integer>>read(plan, "$.edgeIds").subList(0, 3);
        List<Integer> dirs = JsonPath.<List<Integer>>read(plan, "$.directions").subList(0, 3);
        String id = startRide(s, "{\"mode\":\"SIMULATOR\"}");

        authed(get("/api/me/explored"), s).andExpect(jsonPath("$.exploredEdges").value(0))
                .andExpect(jsonPath("$.percent").value(0.0));

        String block1 = samples(0, 30, edges, dirs);
        authedJson(post("/api/rides/" + id + "/samples"), s, block1).andExpect(status().isNoContent());
        authedJson(post("/api/rides/" + id + "/samples"), s, block1).andExpect(status().isNoContent());
        authedJson(post("/api/rides/" + id + "/samples"), s, samples(30, 30, edges, dirs))
                .andExpect(status().isNoContent());

        String event = """
                {"events":[{"id":"%s","t":12,"type":"PAUSE","distanceM":120},
                           {"id":"%s","t":12,"type":"PEE_BREAK_START","distanceM":120,"payload":{"note":"ok"}}]}"""
                .formatted(UUID.randomUUID(), UUID.randomUUID());
        authedJson(post("/api/rides/" + id + "/events"), s, event).andExpect(status().isNoContent());
        authedJson(post("/api/rides/" + id + "/events"), s, event).andExpect(status().isNoContent());

        authed(post("/api/rides/" + id + "/complete"), s)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ride.status").value("COMPLETED"))
                .andExpect(jsonPath("$.ride.elapsedTimeS").value(60))
                .andExpect(jsonPath("$.ride.movingTimeS").value(60))
                .andExpect(jsonPath("$.ride.distanceM").value(590.0))
                .andExpect(jsonPath("$.ride.avgPower").value(200))
                .andExpect(jsonPath("$.ride.normalizedPower").value(200))
                .andExpect(jsonPath("$.ride.avgSpeedKmh").value(35.4))
                .andExpect(jsonPath("$.ride.ascentM").value(5.9))
                .andExpect(jsonPath("$.ride.intensityFactor").value(1.0))
                .andExpect(jsonPath("$.ride.peeBreaks").value(1))
                .andExpect(jsonPath("$.events", hasSize(2)))
                .andExpect(jsonPath("$.events[1].payload.note").value("ok"));
        // Completing twice does not count the roads twice.
        authed(post("/api/rides/" + id + "/complete"), s).andExpect(status().isOk());

        authed(get("/api/me/explored"), s)
                .andExpect(jsonPath("$.exploredEdges").value(3))
                .andExpect(jsonPath("$.percent", greaterThan(0.0)))
                .andExpect(jsonPath("$.geojson.features", hasSize(3)));

        authedJson(post("/api/rides/" + id + "/samples"), s, block1).andExpect(status().isConflict());

        authed(get("/api/rides/" + id + "/samples"), s)
                .andExpect(jsonPath("$.t", hasSize(60)))
                .andExpect(jsonPath("$.power[59]").value(200))
                .andExpect(jsonPath("$.avatarState[0]").value("RIDING"));

        authed(get("/api/rides?page=0&size=10"), s)
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(id));

        authed(delete("/api/rides/" + id), s).andExpect(status().isNoContent());
        authed(get("/api/rides/" + id), s).andExpect(status().isNotFound());
        authed(get("/api/me/explored"), s).andExpect(jsonPath("$.exploredEdges").value(0));
    }

    @Test
    void ridesArePrivate() throws Exception {
        Session owner = register();
        Session other = register();
        String id = startRide(owner, "{\"mode\":\"SIMULATOR\"}");
        String body = "{\"samples\":[{\"t\":0,\"distanceM\":0,\"power\":100}],\"edges\":[]}";

        authed(get("/api/rides/" + id), other).andExpect(status().isNotFound());
        authed(get("/api/rides/" + id + "/samples"), other).andExpect(status().isNotFound());
        authedJson(post("/api/rides/" + id + "/samples"), other, body).andExpect(status().isNotFound());
        authed(post("/api/rides/" + id + "/complete"), other).andExpect(status().isNotFound());
        authed(delete("/api/rides/" + id), other).andExpect(status().isNotFound());
        authed(get("/api/rides"), other).andExpect(jsonPath("$.totalElements").value(0));

        authed(get("/api/rides/" + id), owner).andExpect(status().isOk());
        authed(get("/api/rides"), owner).andExpect(jsonPath("$.content", hasSize(1)));
    }

    @Test
    void rideOnSavedRouteAndValidation() throws Exception {
        Session s = register();
        String list = authed(get("/api/routes"), s).andReturn().getResponse().getContentAsString();
        String routeId = JsonPath.<List<String>>read(list, "$[?(@.slug == 'cadenazzo-monte-ceneri')].id").getFirst();
        authed(get("/api/routes/" + routeId), s)
                .andExpect(jsonPath("$.edgeStartsM[0]").value(0.0))
                .andExpect(jsonPath("$.edgeStartsM.length()", greaterThan(1)));

        String id = startRide(s, "{\"routeId\":\"%s\",\"mode\":\"SIMULATOR\"}".formatted(routeId));
        authed(get("/api/rides/" + id), s).andExpect(jsonPath("$.ride.routeName").value("Cadenazzo – Monte Ceneri"));
        authed(get("/api/rides?routeId=" + routeId), s).andExpect(jsonPath("$.totalElements").value(1));

        authedJson(post("/api/rides"), s, "{\"mode\":\"BIKE\"}").andExpect(status().isBadRequest());
        authedJson(post("/api/rides"), s, "{}").andExpect(status().isBadRequest());
        authedJson(post("/api/rides"), s, "{\"routeId\":\"%s\",\"mode\":\"SIMULATOR\"}".formatted(UUID.randomUUID()))
                .andExpect(status().isNotFound());
        authedJson(post("/api/rides/" + id + "/samples"), s, "{\"samples\":[{\"t\":-1}]}")
                .andExpect(status().isBadRequest());
    }

    @Test
    void plannedRouteHasEdgeStarts() throws Exception {
        Session s = register();
        String plan = plan(s);
        List<Double> starts = JsonPath.read(plan, "$.edgeStartsM");
        List<Integer> ids = JsonPath.read(plan, "$.edgeIds");
        org.assertj.core.api.Assertions.assertThat(starts).hasSize(ids.size());
        org.assertj.core.api.Assertions.assertThat(starts.getFirst()).isZero();
        org.assertj.core.api.Assertions.assertThat(starts).isSorted();
    }
}
