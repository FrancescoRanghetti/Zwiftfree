package ch.zwiftfree.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
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

class StatsIntegrationTest extends IntegrationTest {

    private record Route(String id, List<Integer> edges, List<Integer> dirs, List<Double> starts, double lengthM) {
    }

    private Route ceneri(Session s) throws Exception {
        String list = authed(get("/api/routes"), s).andReturn().getResponse().getContentAsString();
        String id = JsonPath.<List<String>>read(list, "$[?(@.slug == 'cadenazzo-monte-ceneri')].id").getFirst();
        String d = authed(get("/api/routes/" + id), s).andReturn().getResponse().getContentAsString();
        List<Number> starts = JsonPath.read(d, "$.edgeStartsM");
        return new Route(id, JsonPath.read(d, "$.edgeIds"), JsonPath.read(d, "$.directions"),
                starts.stream().map(Number::doubleValue).toList(), trackLength(JsonPath.read(d, "$.coordinates")));
    }

    /** Length of the track as the ride screen measures it (edge starts are measured the same way). */
    private static double trackLength(List<List<Number>> coords) {
        double total = 0;
        for (int i = 1; i < coords.size(); i++) {
            double lat1 = Math.toRadians(coords.get(i - 1).get(1).doubleValue());
            double lat2 = Math.toRadians(coords.get(i).get(1).doubleValue());
            double dLat = lat2 - lat1;
            double dLon = Math.toRadians(coords.get(i).get(0).doubleValue() - coords.get(i - 1).get(0).doubleValue());
            double h = Math.pow(Math.sin(dLat / 2), 2)
                    + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(dLon / 2), 2);
            total += 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
        }
        return total;
    }

    /** Rides the whole route at a constant speed and power; returns the completed ride's JSON. */
    private String ride(Session s, Route r, double speedMs, int power) throws Exception {
        String created = authedJson(post("/api/rides"), s,
                "{\"routeId\":\"%s\",\"mode\":\"SIMULATOR\"}".formatted(r.id()))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String id = JsonPath.read(created, "$.id");
        int seconds = (int) Math.ceil(r.lengthM() / speedMs);
        StringJoiner edges = new StringJoiner(",");
        for (int i = 0; i < r.edges().size(); i++) {
            edges.add("{\"seq\":%d,\"edgeId\":%d,\"direction\":%d,\"startM\":%s}".formatted(i, r.edges().get(i),
                    r.dirs().get(i), r.starts().get(i)));
        }
        for (int from = 0; from <= seconds; from += 600) {
            StringJoiner sj = new StringJoiner(",");
            for (int t = from; t <= Math.min(seconds, from + 599); t++) {
                double d = Math.min(r.lengthM(), t * speedMs);
                sj.add("{\"t\":%d,\"distanceM\":%.1f,\"ele\":%.1f,\"power\":%d,\"cadence\":85,\"speedKmh\":%.1f}"
                        .formatted(t, d, 200 + d * 0.065, power, speedMs * 3.6));
            }
            authedJson(post("/api/rides/" + id + "/samples"), s,
                    "{\"samples\":[" + sj + "],\"edges\":[" + edges + "]}").andExpect(status().isNoContent());
        }
        return authed(post("/api/rides/" + id + "/complete"), s)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    @Test
    void segmentsRecordsAndStats() throws Exception {
        Session s = register();
        Route r = ceneri(s);

        String fast = ride(s, r, 5.0, 260);
        String fastId = JsonPath.read(fast, "$.ride.id");
        List<String> segNames = JsonPath.read(fast, "$.segmentEfforts[*].name");
        assertThat(segNames).contains("Cadenazzo – Monte Ceneri");
        int fastTime = JsonPath.<List<Integer>>read(fast,
                "$.segmentEfforts[?(@.name == 'Cadenazzo – Monte Ceneri')].elapsedS").getFirst();
        assertThat(fastTime).isBetween((int) (r.lengthM() / 5.0) - 2, (int) (r.lengthM() / 5.0) + 2);
        List<String> metrics = JsonPath.read(fast, "$.records[*].metric");
        assertThat(metrics).containsSubsequence("BEST_5S", "BEST_1MIN", "BEST_5MIN", "BEST_20MIN", "LONGEST_RIDE",
                "MOST_ASCENT");
        assertThat(metrics).anyMatch(m -> m.startsWith("segment:"));

        String slow = ride(s, r, 4.0, 200);
        String slowId = JsonPath.read(slow, "$.ride.id");
        assertThat(JsonPath.<List<Boolean>>read(slow,
                "$.segmentEfforts[?(@.name == 'Cadenazzo – Monte Ceneri')].personalBest")).containsExactly(false);
        assertThat(JsonPath.<List<Integer>>read(slow,
                "$.segmentEfforts[?(@.name == 'Cadenazzo – Monte Ceneri')].rank")).containsExactly(2);
        assertThat(JsonPath.<List<String>>read(slow, "$.records[*].metric")).isEmpty();
        // Reading the ride again gives the same records and efforts.
        authed(get("/api/rides/" + fastId), s).andExpect(jsonPath("$.records.length()", greaterThan(5)))
                .andExpect(jsonPath("$.segmentEfforts[?(@.name == 'Cadenazzo – Monte Ceneri')].personalBest")
                        .value(hasItem(true)));

        authed(get("/api/stats/summary?period=week"), s)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("WEEK"))
                .andExpect(jsonPath("$.rides").value(2))
                .andExpect(jsonPath("$.ceneri").value(2))
                .andExpect(jsonPath("$.distanceM", greaterThan(r.lengthM() * 1.9)))
                .andExpect(jsonPath("$.lastRide.id").value(slowId));
        authed(get("/api/stats/summary?period=all"), s).andExpect(jsonPath("$.from").doesNotExist());
        authed(get("/api/stats/summary?period=decade"), s).andExpect(status().isBadRequest());

        authed(get("/api/stats/power-curve?period=all"), s)
                .andExpect(jsonPath("$", hasSize(11)))
                .andExpect(jsonPath("$[0].durationS").value(5))
                .andExpect(jsonPath("$[0].watts").value(260))
                .andExpect(jsonPath("$[0].rideId").value(fastId))
                .andExpect(jsonPath("$[10].watts").doesNotExist());

        authed(get("/api/stats/training-load"), s)
                .andExpect(jsonPath("$", hasSize(90)))
                .andExpect(jsonPath("$[89].tss", greaterThan(0.0)))
                .andExpect(jsonPath("$[89].ctl", greaterThan(0.0)))
                .andExpect(jsonPath("$[0].tss").value(0.0));
        authed(get("/api/stats/training-load?from=2026-01-10&to=2026-01-01"), s).andExpect(status().isBadRequest());

        authed(get("/api/stats/records"), s)
                .andExpect(jsonPath("$[0].metric").value("BEST_5S"))
                .andExpect(jsonPath("$[0].value").value(260.0))
                .andExpect(jsonPath("$[?(@.segment.name == 'Cadenazzo – Monte Ceneri')].value")
                        .value(hasItem((double) fastTime)));

        authed(get("/api/routes/" + r.id() + "/leaderboard"), s)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.name == 'Cadenazzo – Monte Ceneri')].efforts[0].rideId")
                        .value(hasItem(fastId)))
                .andExpect(jsonPath("$[?(@.name == 'Cadenazzo – Monte Ceneri')].efforts.length()").value(hasItem(2)));
        authed(get("/api/routes/" + UUID.randomUUID() + "/leaderboard"), s).andExpect(status().isNotFound());

        // Another user sees none of it.
        Session other = register();
        authed(get("/api/stats/summary?period=all"), other).andExpect(jsonPath("$.rides").value(0))
                .andExpect(jsonPath("$.lastRide").doesNotExist());
        authed(get("/api/stats/records"), other).andExpect(jsonPath("$", hasSize(0)));

        // Deleting the record ride gives the records back to the other ride.
        authed(delete("/api/rides/" + fastId), s).andExpect(status().isNoContent());
        authed(get("/api/stats/records"), s)
                .andExpect(jsonPath("$[0].value").value(200.0))
                .andExpect(jsonPath("$[0].rideId").value(slowId));
        authed(get("/api/stats/summary?period=all"), s).andExpect(jsonPath("$.rides").value(1));
    }

    @Test
    void partialRideTimesNoSegment() throws Exception {
        Session s = register();
        Route r = ceneri(s);
        // Only half of the route: the edges list ends early and the ride stops in the middle of an edge.
        Route half = new Route(r.id(), r.edges(), r.dirs(), r.starts(), r.lengthM() / 2);
        String done = ride(s, half, 5.0, 220);
        assertThat(JsonPath.<List<String>>read(done, "$.segmentEfforts[*].name"))
                .doesNotContain("Cadenazzo – Monte Ceneri");
    }
}
