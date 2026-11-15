package ch.zwiftfree.common.security;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

/** Extracts the authenticated user id (JWT subject). Use with {@code @AuthenticationPrincipal Jwt jwt}. */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static UUID id(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
