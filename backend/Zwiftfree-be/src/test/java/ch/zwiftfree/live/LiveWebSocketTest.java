package ch.zwiftfree.live;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ch.zwiftfree.TestcontainersConfig;
import com.jayway.jsonpath.JsonPath;
import java.lang.reflect.Type;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.web.client.RestClient;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

/** STOMP over a real WebSocket: authentication in CONNECT, allowed destinations, second-screen fan-out. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfig.class)
class LiveWebSocketTest {

    @LocalServerPort
    int port;

    @Autowired
    SimpUserRegistry users;

    private WebSocketStompClient client;

    @BeforeEach
    void setUp() {
        client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new JacksonJsonMessageConverter());
    }

    @AfterEach
    void tearDown() {
        client.stop();
    }

    private String register(String name) {
        String body = RestClient.create("http://localhost:" + port)
                .post()
                .uri("/api/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("email", "live-" + UUID.randomUUID() + "@example.ch", "password", "una-password-sicura",
                        "displayName", name))
                .retrieve()
                .body(String.class);
        return JsonPath.read(body, "$.accessToken");
    }

    private StompSession connect(String token) throws Exception {
        StompHeaders headers = new StompHeaders();
        if (token != null) {
            headers.add("Authorization", "Bearer " + token);
        }
        return client.connectAsync("ws://localhost:" + port + "/ws", new WebSocketHttpHeaders(), headers,
                new StompSessionHandlerAdapter() {
                }).get(5, TimeUnit.SECONDS);
    }

    @SuppressWarnings("unchecked")
    private static BlockingQueue<Map<String, Object>> subscribe(StompSession session, String destination) {
        BlockingQueue<Map<String, Object>> queue = new LinkedBlockingQueue<>();
        session.subscribe(destination, new StompFrameHandler() {

            @Override
            public Type getPayloadType(StompHeaders headers) {
                return Map.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                queue.add((Map<String, Object>) payload);
            }
        });
        return queue;
    }

    @Test
    void positionReachesTheSecondScreenAndTheRouteTopic() throws Exception {
        String token = register("Giulia");
        StompSession bike = connect(token);
        StompSession phone = connect(token);
        StompSession stranger = connect(register("Altro"));
        var mine = subscribe(phone, "/user/queue/live");
        var strangersQueue = subscribe(stranger, "/user/queue/live");
        var route = subscribe(stranger, "/topic/routes/free/riders");
        Thread.sleep(300); // let the subscriptions register

        bike.send("/app/live/position", Map.of("distanceM", 1234.5, "speedKmh", 31.2, "power", 240, "hr", 150,
                "avatarState", "RIDING", "lat", 46.15, "lon", 8.95, "road", "Via Cantonale"));

        Map<String, Object> got = mine.poll(5, TimeUnit.SECONDS);
        assertThat(got).isNotNull();
        assertThat(got).containsEntry("displayName", "Giulia")
                .containsEntry("power", 240)
                .containsEntry("avatarState", "RIDING")
                .containsEntry("routeId", "free")
                .containsEntry("road", "Via Cantonale");
        assertThat(route.poll(5, TimeUnit.SECONDS)).containsEntry("displayName", "Giulia");
        // Another user's private queue gets nothing.
        assertThat(strangersQueue.poll(500, TimeUnit.MILLISECONDS)).isNull();

        // A burst is thinned out (at most one message every 250 ms per user).
        Thread.sleep(300);
        bike.send("/app/live/position", Map.of("distanceM", 1240.0, "avatarState", "RIDING"));
        bike.send("/app/live/position", Map.of("distanceM", 1241.0, "avatarState", "RIDING"));
        assertThat(mine.poll(5, TimeUnit.SECONDS)).isNotNull();
        assertThat(mine.poll(500, TimeUnit.MILLISECONDS)).isNull();

        // …but a change of state is never dropped (the ride screen sends FINISHED right after its last position).
        Thread.sleep(300);
        bike.send("/app/live/position", Map.of("distanceM", 1250.0, "avatarState", "RIDING"));
        Thread.sleep(50);
        bike.send("/app/live/position", Map.of("distanceM", 1250.0, "avatarState", "FINISHED"));
        var states = new java.util.HashSet<Object>();
        for (int i = 0; i < 2; i++) {
            Map<String, Object> m = mine.poll(5, TimeUnit.SECONDS);
            assertThat(m).isNotNull();
            states.add(m.get("avatarState"));
        }
        assertThat(states).containsExactlyInAnyOrder("RIDING", "FINISHED");
    }

    @Test
    void connectWithoutAValidTokenIsRefused() {
        assertThatThrownBy(() -> connect(null)).isInstanceOf(Exception.class);
        assertThatThrownBy(() -> connect("not-a-jwt")).isInstanceOf(Exception.class);
    }

    @Test
    void subscribingOutsideTheAllowedDestinationsClosesTheSession() throws Exception {
        StompSession session = connect(register("Curioso"));
        subscribe(session, "/topic/everything");
        for (int i = 0; i < 50 && session.isConnected(); i++) {
            Thread.sleep(100);
        }
        assertThat(session.isConnected()).isFalse();
        assertThat(users.findSubscriptions(s -> s.getDestination().equals("/topic/everything"))).isEmpty();
    }
}
