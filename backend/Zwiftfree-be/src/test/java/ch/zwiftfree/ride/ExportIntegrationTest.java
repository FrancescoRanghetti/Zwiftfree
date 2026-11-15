package ch.zwiftfree.ride;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.zwiftfree.IntegrationTest;
import com.garmin.fit.Decode;
import com.garmin.fit.MesgBroadcaster;
import com.garmin.fit.RecordMesg;
import com.garmin.fit.SessionMesg;
import com.garmin.fit.Sport;
import com.garmin.fit.SubSport;
import com.jayway.jsonpath.JsonPath;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.StringJoiner;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;

class ExportIntegrationTest extends IntegrationTest {

    private static final int SECONDS = 120;

    /** A completed free ride of 120 s at 250 W, 90 rpm, 150 bpm, 10 m/s, moving north. */
    private String completedRide(Session s) throws Exception {
        String created = authedJson(post("/api/rides"), s, "{\"mode\":\"SIMULATOR\"}").andReturn()
                .getResponse()
                .getContentAsString();
        String id = JsonPath.read(created, "$.id");
        StringJoiner sj = new StringJoiner(",");
        for (int t = 0; t < SECONDS; t++) {
            sj.add("""
                    {"t":%d,"distanceM":%d,"lat":%.6f,"lon":8.95,"ele":%.1f,"grade":2.0,"power":250,"cadence":90,
                     "hr":150,"speedKmh":36,"avatarState":"RIDING"}""".formatted(t, t * 10, 46.15 + t * 0.00009,
                    200 + t * 0.2));
        }
        authedJson(post("/api/rides/" + id + "/samples"), s, "{\"samples\":[" + sj + "],\"edges\":[]}")
                .andExpect(status().isNoContent());
        authed(post("/api/rides/" + id + "/complete"), s).andExpect(status().isOk());
        return id;
    }

    @Test
    void gpxHasEveryPointWithHeartRateCadenceAndPower() throws Exception {
        Session s = register();
        String id = completedRide(s);
        byte[] body = authed(get("/api/rides/" + id + "/export.gpx"), s)
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/gpx+xml"))
                .andExpect(header().string("Content-Disposition",
                        org.hamcrest.Matchers.matchesPattern(
                                "attachment; filename=\"zwiftfree-\\d{4}-\\d{2}-\\d{2}-giro-libero\\.gpx\"")))
                .andReturn()
                .getResponse()
                .getContentAsByteArray();
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document doc = factory.newDocumentBuilder().parse(new ByteArrayInputStream(body));
        assertThat(doc.getDocumentElement().getLocalName()).isEqualTo("gpx");
        assertThat(doc.getDocumentElement().getAttribute("version")).isEqualTo("1.1");
        var points = doc.getElementsByTagNameNS("http://www.topografix.com/GPX/1/1", "trkpt");
        assertThat(points.getLength()).isEqualTo(SECONDS);
        var hr = doc.getElementsByTagNameNS("http://www.garmin.com/xmlschemas/TrackPointExtension/v1", "hr");
        assertThat(hr.getLength()).isEqualTo(SECONDS);
        assertThat(hr.item(0).getTextContent()).isEqualTo("150");
        assertThat(doc.getElementsByTagNameNS("http://www.topografix.com/GPX/1/1", "power").item(0).getTextContent())
                .isEqualTo("250");
        var times = doc.getElementsByTagNameNS("http://www.topografix.com/GPX/1/1", "time");
        // metadata time + one per point, one second apart
        assertThat(times.getLength()).isEqualTo(SECONDS + 1);
        assertThat(java.time.Instant.parse(times.item(2).getTextContent()))
                .isEqualTo(java.time.Instant.parse(times.item(1).getTextContent()).plusSeconds(1));
    }

    @Test
    void fitDecodesWithTheGarminSdk() throws Exception {
        Session s = register();
        String id = completedRide(s);
        byte[] body = authed(get("/api/rides/" + id + "/export.fit"), s)
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/vnd.ant.fit"))
                .andReturn()
                .getResponse()
                .getContentAsByteArray();

        assertThat(new Decode().checkFileIntegrity(new ByteArrayInputStream(body))).isTrue();
        List<RecordMesg> records = new ArrayList<>();
        List<SessionMesg> sessions = new ArrayList<>();
        Decode decode = new Decode();
        MesgBroadcaster broadcaster = new MesgBroadcaster(decode);
        broadcaster.addListener((RecordMesg m) -> records.add(m));
        broadcaster.addListener((SessionMesg m) -> sessions.add(m));
        decode.read(new ByteArrayInputStream(body), broadcaster, broadcaster);

        assertThat(records).hasSize(SECONDS);
        RecordMesg first = records.getFirst();
        assertThat(first.getPower()).isEqualTo(250);
        assertThat(first.getHeartRate()).isEqualTo((short) 150);
        assertThat(first.getCadence()).isEqualTo((short) 90);
        assertThat((double) first.getPositionLat() / ExportService.semicircles(1.0)).isCloseTo(46.15, within(1e-4));
        assertThat(first.getEnhancedSpeed()).isCloseTo(10f, org.assertj.core.data.Offset.offset(0.01f));
        assertThat(records.getLast().getTimestamp().getTimestamp() - first.getTimestamp().getTimestamp())
                .isEqualTo(SECONDS - 1);

        assertThat(sessions).hasSize(1);
        SessionMesg session = sessions.getFirst();
        assertThat(session.getSport()).isEqualTo(Sport.CYCLING);
        assertThat(session.getSubSport()).isEqualTo(SubSport.VIRTUAL_ACTIVITY);
        assertThat(session.getTotalDistance()).isCloseTo(1190f, org.assertj.core.data.Offset.offset(1f));
        assertThat(session.getAvgPower()).isEqualTo(250);
        assertThat(session.getNormalizedPower()).isEqualTo(250);
        assertThat(session.getTotalElapsedTime()).isCloseTo(120f, org.assertj.core.data.Offset.offset(0.5f));
    }

    @Test
    void exportsArePrivate() throws Exception {
        Session owner = register();
        Session other = register();
        String id = completedRide(owner);
        authed(get("/api/rides/" + id + "/export.gpx"), other).andExpect(status().isNotFound());
        authed(get("/api/rides/" + id + "/export.fit"), other).andExpect(status().isNotFound());
    }

    @Test
    void fileNamesUseTheRouteName() {
        assertThat(ExportService.slug("Cadenazzo – Monte Ceneri")).isEqualTo("cadenazzo-monte-ceneri");
        assertThat(ExportService.slug("Lugano – Monte Brè")).isEqualTo("lugano-monte-bre");
        assertThat(ExportService.slug("!!!")).isEqualTo("uscita");
    }

    private static org.assertj.core.data.Offset<Double> within(double v) {
        return org.assertj.core.data.Offset.offset(v);
    }
}
