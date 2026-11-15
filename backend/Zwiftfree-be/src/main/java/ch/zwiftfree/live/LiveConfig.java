package ch.zwiftfree.live;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * STOMP over WebSocket on {@code /ws}. Clients authenticate in the CONNECT frame with
 * {@code Authorization: Bearer <accessToken>} (browsers cannot set headers on the WebSocket handshake), see
 * {@link StompAuthInterceptor}. In-memory broker: {@code /topic} for a route's riders, {@code /user/queue} for the
 * rider's own position on a second screen.
 */
@Configuration
@EnableWebSocketMessageBroker
public class LiveConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthInterceptor auth;

    public LiveConfig(StompAuthInterceptor auth) {
        this.auth = auth;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Any origin: the session is authenticated by the bearer token in the CONNECT frame, never by cookies, so a
        // foreign page cannot ride on the user's session. This lets a phone on the LAN (http://192.168.x.y:4280) act
        // as a second screen.
        registry.addEndpoint("/ws").setAllowedOriginPatterns("*");
        // Incoming frames are not forced into order: that would run StompAuthInterceptor asynchronously, after the
        // subscription is already acknowledged. Positions come once a second, and LiveController drops anything
        // closer than 250 ms to the previous one, so reordering cannot show.
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue")
                .setHeartbeatValue(new long[]{10_000, 10_000})
                .setTaskScheduler(heartbeatScheduler());
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
        registry.setPreservePublishOrder(true);
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(auth);
    }

    private static ThreadPoolTaskScheduler heartbeatScheduler() {
        var scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("stomp-heartbeat-");
        scheduler.initialize();
        return scheduler;
    }
}
