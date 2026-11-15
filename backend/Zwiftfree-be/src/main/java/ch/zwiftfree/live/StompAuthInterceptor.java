package ch.zwiftfree.live;

import java.security.Principal;
import java.util.List;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * Authenticates STOMP sessions and limits what they can do:
 * <ul>
 * <li>CONNECT needs a valid access token ({@code Authorization: Bearer …}); the session's user is the JWT subject;</li>
 * <li>SUBSCRIBE only to {@code /topic/routes/{id}/riders} and the user's own {@code /user/queue/…};</li>
 * <li>SEND only to {@code /app/…}.</li>
 * </ul>
 * Anything else is refused (the client gets a STOMP ERROR frame).
 */
@Component
public class StompAuthInterceptor implements ChannelInterceptor {

    private final JwtDecoder jwtDecoder;

    public StompAuthInterceptor(JwtDecoder jwtDecoder) {
        this.jwtDecoder = jwtDecoder;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }
        StompCommand command = accessor.getCommand();
        switch (command) {
            case CONNECT, STOMP -> accessor.setUser(authenticate(accessor.getFirstNativeHeader("Authorization")));
            case SUBSCRIBE -> {
                requireUser(accessor.getUser());
                String dest = accessor.getDestination();
                if (dest == null || !(dest.matches("/topic/routes/[A-Za-z0-9-]{1,64}/riders")
                        || dest.startsWith("/user/queue/"))) {
                    throw new MessageDeliveryException("Destinazione non consentita");
                }
            }
            case SEND -> {
                requireUser(accessor.getUser());
                String dest = accessor.getDestination();
                if (dest == null || !dest.startsWith("/app/")) {
                    throw new MessageDeliveryException("Destinazione non consentita");
                }
            }
            default -> {
                // DISCONNECT, UNSUBSCRIBE, ACK…: nothing to check
            }
        }
        return message;
    }

    private Principal authenticate(String header) {
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new MessageDeliveryException("Autenticazione richiesta");
        }
        try {
            Jwt jwt = jwtDecoder.decode(header.substring(7).trim());
            return new JwtAuthenticationToken(jwt, List.of(), jwt.getSubject());
        } catch (JwtException e) {
            throw new MessageDeliveryException("Token non valido o scaduto");
        }
    }

    private static void requireUser(Principal user) {
        if (user == null) {
            throw new MessageDeliveryException("Autenticazione richiesta");
        }
    }
}
