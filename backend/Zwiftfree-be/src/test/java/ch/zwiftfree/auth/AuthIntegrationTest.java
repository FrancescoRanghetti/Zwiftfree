package ch.zwiftfree.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.zwiftfree.IntegrationTest;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class AuthIntegrationTest extends IntegrationTest {

    @Test
    void registerReturnsWorkingTokens() throws Exception {
        Session s = register();
        assertThat(s.accessToken()).isNotBlank();
        assertThat(s.refreshToken()).hasSizeGreaterThan(40);
        me(s).andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(s.email()))
                .andExpect(jsonPath("$.displayName").value("Mario Rossi"));
    }

    @Test
    void registerRejectsDuplicateEmailIgnoringCase() throws Exception {
        Session s = register();
        postJson("/api/auth/register", """
                {"email":"%s","password":"%s","displayName":"Altro"}""".formatted(s.email().toUpperCase(), PASSWORD))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.detail").value("Esiste già un account con questa email"));
    }

    @Test
    void registerValidatesInputInItalian() throws Exception {
        postJson("/api/auth/register", """
                {"email":"not-an-email","password":"short","displayName":""}""")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.email").value("Email non valida"))
                .andExpect(jsonPath("$.errors.password").value("La password deve avere tra 10 e 128 caratteri"))
                .andExpect(jsonPath("$.errors.displayName").value("Il nome è obbligatorio"));
    }

    @Test
    void loginWorksCaseInsensitivelyAndRejectsWrongPassword() throws Exception {
        Session s = register();
        postJson("/api/auth/login", """
                {"email":"  %s ","password":"%s"}""".formatted(s.email().toUpperCase(), PASSWORD))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.expiresIn").value(900));
        postJson("/api/auth/login", """
                {"email":"%s","password":"wrong-password!"}""".formatted(s.email()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("Email o password non corretti"));
        postJson("/api/auth/login", """
                {"email":"nobody@example.ch","password":"whatever-123"}""")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("Email o password non corretti"));
    }

    @Test
    void refreshRotatesAndDetectsReuse() throws Exception {
        Session s = register();
        String body = postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(s.refreshToken()))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String newRefresh = JsonPath.read(body, "$.refreshToken");
        assertThat(newRefresh).isNotEqualTo(s.refreshToken());

        // Replaying the old token is treated as theft: it fails and kills the new one too.
        postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(s.refreshToken()))
                .andExpect(status().isUnauthorized());
        postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(newRefresh))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void logoutRevokesTheRefreshToken() throws Exception {
        Session s = register();
        postJson("/api/auth/logout", """
                {"refreshToken":"%s"}""".formatted(s.refreshToken()))
                .andExpect(status().isNoContent());
        postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(s.refreshToken()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void replayingALoggedOutTokenDoesNotEndOtherSessions() throws Exception {
        Session s = register();
        String other = JsonPath.read(postJson("/api/auth/login", """
                {"email":"%s","password":"%s"}""".formatted(s.email(), PASSWORD))
                .andReturn()
                .getResponse()
                .getContentAsString(), "$.refreshToken");
        postJson("/api/auth/logout", """
                {"refreshToken":"%s"}""".formatted(s.refreshToken())).andExpect(status().isNoContent());
        postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(s.refreshToken())).andExpect(status().isUnauthorized());
        postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(other)).andExpect(status().isOk());
    }

    @Test
    void unknownRefreshTokenIsRejected() throws Exception {
        postJson("/api/auth/refresh", """
                {"refreshToken":"nope"}""").andExpect(status().isUnauthorized());
    }

    @Test
    void loginIsRateLimitedPerEmail() throws Exception {
        Session s = register();
        for (int i = 0; i < 5; i++) {
            postJson("/api/auth/login", """
                    {"email":"%s","password":"wrong-password!"}""".formatted(s.email()))
                    .andExpect(status().isUnauthorized());
        }
        // Even the right password is refused while the window is full.
        postJson("/api/auth/login", """
                {"email":"%s","password":"%s"}""".formatted(s.email(), PASSWORD))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.detail").value("Troppi tentativi di accesso. Riprova più tardi."));
    }

    @Test
    void protectedEndpointsNeedAValidToken() throws Exception {
        mvc.perform(get("/api/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
        Session s = register();
        String tampered = s.accessToken().substring(0, s.accessToken().length() - 4) + "AAAA";
        mvc.perform(get("/api/me").header("Authorization", "Bearer " + tampered))
                .andExpect(status().isUnauthorized());
    }
}
