package ch.zwiftfree;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.zwiftfree.auth.LoginAttemptLimiter;
import com.jayway.jsonpath.JsonPath;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Base for API tests: real PostgreSQL via Testcontainers, full security chain, MockMvc. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfig.class)
public abstract class IntegrationTest {

    public static final String PASSWORD = "correct-horse-battery";

    @Autowired
    protected MockMvc mvc;

    @Autowired
    private LoginAttemptLimiter limiter;

    @BeforeEach
    void resetLimiter() {
        limiter.reset();
    }

    protected record Session(String email, String accessToken, String refreshToken) {
    }

    protected static String uniqueEmail() {
        return "rider-" + UUID.randomUUID() + "@example.ch";
    }

    protected Session register() throws Exception {
        return register(uniqueEmail(), PASSWORD, "Mario Rossi");
    }

    protected Session register(String email, String password, String name) throws Exception {
        String body = postJson("/api/auth/register",
                """
                        {"email":"%s","password":"%s","displayName":"%s"}""".formatted(email, password, name))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return new Session(email, JsonPath.read(body, "$.accessToken"), JsonPath.read(body, "$.refreshToken"));
    }

    protected ResultActions postJson(String url, String json) throws Exception {
        return mvc.perform(post(url).contentType(MediaType.APPLICATION_JSON).content(json));
    }

    protected ResultActions authed(MockHttpServletRequestBuilder req, Session s) throws Exception {
        return mvc.perform(req.header("Authorization", "Bearer " + s.accessToken()));
    }

    protected ResultActions authedJson(MockHttpServletRequestBuilder req, Session s, String json) throws Exception {
        return authed(req.contentType(MediaType.APPLICATION_JSON).content(json), s);
    }

    protected ResultActions me(Session s) throws Exception {
        return authed(get("/api/me"), s);
    }
}
