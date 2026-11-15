package ch.zwiftfree.live;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

/**
 * Live position: the ride screen publishes once a second on {@code /app/live/position}; the server forwards it to
 * {@code /topic/routes/{routeId|free}/riders} (future: several riders on the same map) and to the rider's own
 * {@code /user/queue/live} (second screen, e.g. a phone next to the trainer).
 */
@Controller
public class LiveController {

    /** Messages closer than this to the previous one from the same user are dropped (unless the state changed). */
    static final Duration MIN_INTERVAL = Duration.ofMillis(250);

    private final SimpMessagingTemplate broker;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final Cache<String, String> names = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofMinutes(10))
            .build();
    private record Last(Instant at, String state) {
    }

    private final Cache<String, Last> lastSeen = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterAccess(Duration.ofMinutes(5))
            .build();

    public LiveController(SimpMessagingTemplate broker, JdbcTemplate jdbc, Clock clock) {
        this.broker = broker;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** What the ride screen sends. Everything but the state is optional. */
    public record LivePosition(
            UUID routeId,
            @Min(0) Double distanceM,
            @Min(0) @Max(200) Double speedKmh,
            @Min(0) @Max(3000) Integer power,
            @Min(0) @Max(300) Integer cadence,
            @Min(0) @Max(260) Integer hr,
            @Min(-40) @Max(40) Double grade,
            @Min(-90) @Max(90) Double lat,
            @Min(-180) @Max(180) Double lon,
            @Min(0) Double remainingM,
            @Min(0) Integer elapsedS,
            @Size(max = 20) String avatarState,
            @Size(max = 120) String road,
            @Size(max = 120) String title) {
    }

    /** What subscribers receive. */
    public record LiveRider(String userId, String displayName, String routeId, Double distanceM, Double speedKmh,
            Integer power, Integer cadence, Integer hr, Double grade, Double lat, Double lon, Double remainingM,
            Integer elapsedS, String avatarState, String road, String title, Instant at) {
    }

    @MessageMapping("/live/position")
    public void position(@Payload @Valid LivePosition p, Principal user) {
        String userId = user.getName();
        Instant now = clock.instant();
        // Atomic check-and-set: two frames handled at the same moment cannot both pass. A change of state (e.g. the
        // final FINISHED) always goes through, however soon after the previous position it comes.
        boolean[] accepted = {false};
        lastSeen.asMap().compute(userId, (id, previous) -> {
            if (previous != null && Duration.between(previous.at(), now).compareTo(MIN_INTERVAL) < 0
                    && Objects.equals(previous.state(), p.avatarState())) {
                return previous;
            }
            accepted[0] = true;
            return new Last(now, p.avatarState());
        });
        if (!accepted[0]) {
            return;
        }
        String route = p.routeId() == null ? "free" : p.routeId().toString();
        LiveRider rider = new LiveRider(userId, displayName(userId), route, p.distanceM(), p.speedKmh(), p.power(),
                p.cadence(), p.hr(), p.grade(), p.lat(), p.lon(), p.remainingM(), p.elapsedS(), p.avatarState(),
                p.road(), p.title(), now);
        broker.convertAndSend("/topic/routes/" + route + "/riders", rider);
        broker.convertAndSendToUser(userId, "/queue/live", rider);
    }

    private String displayName(String userId) {
        return names.get(userId, id -> jdbc.query("SELECT display_name FROM users WHERE id = ?::uuid",
                (rs, i) -> rs.getString(1), id).stream().findFirst().orElse(""));
    }
}
