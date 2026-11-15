package ch.zwiftfree.user;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.zwiftfree.IntegrationTest;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

class MeIntegrationTest extends IntegrationTest {

    private static final String VALID_PROFILE = """
            {"displayName":"Lucia","weightKg":62.5,"heightCm":168,"birthYear":1990,"ftpWatts":240,
             "maxHr":185,"restingHr":48,"bikeWeightKg":7.2,"units":"metric",
             "avatar":{"jerseyColor":"#00aa55","helmetColor":"#ffffff","bikeColor":"#123456"}}""";

    @Test
    void newUserHasDefaultProfileAndSettings() throws Exception {
        me(register()).andExpect(status().isOk())
                .andExpect(jsonPath("$.profile.weightKg").value(75.0))
                .andExpect(jsonPath("$.profile.ftpWatts").value(200))
                .andExpect(jsonPath("$.profile.bikeWeightKg").value(8.0))
                .andExpect(jsonPath("$.profile.avatar.jerseyColor").value("#ff9800"))
                .andExpect(jsonPath("$.settings.peeBreakEnabled").value(true))
                .andExpect(jsonPath("$.settings.peeBreakAfterSeconds").value(20))
                .andExpect(jsonPath("$.settings.crashEventsEnabled").value(true))
                .andExpect(jsonPath("$.settings.trainerDifficulty").value(1.0));
    }

    @Test
    void updateProfilePersists() throws Exception {
        Session s = register();
        authedJson(put("/api/me/profile"), s, VALID_PROFILE).andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Lucia"));
        me(s).andExpect(jsonPath("$.profile.weightKg").value(62.5))
                .andExpect(jsonPath("$.profile.ftpWatts").value(240))
                .andExpect(jsonPath("$.profile.maxHr").value(185))
                .andExpect(jsonPath("$.profile.avatar.jerseyColor").value("#00aa55"));
    }

    @Test
    void updateProfileValidates() throws Exception {
        authedJson(put("/api/me/profile"), register(), """
                {"displayName":"x","weightKg":10,"ftpWatts":2000,"bikeWeightKg":8,
                 "avatar":{"jerseyColor":"red","helmetColor":"#ffffff","bikeColor":"#123456"}}""")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.weightKg").value("Peso minimo 30 kg"))
                .andExpect(jsonPath("$.errors.ftpWatts").value("FTP massima 600 W"))
                .andExpect(jsonPath("$.errors['avatar.jerseyColor']").value("Colore non valido (formato #rrggbb)"));
    }

    @Test
    void updateSettingsPersistsAndValidates() throws Exception {
        Session s = register();
        authedJson(put("/api/me/settings"), s, """
                {"peeBreakEnabled":false,"peeBreakAfterSeconds":45,"crashEventsEnabled":false,
                 "trainerDifficulty":0.5,"audioEnabled":false,"cornerAssistEnabled":true}""")
                .andExpect(status().isOk());
        me(s).andExpect(jsonPath("$.settings.peeBreakEnabled").value(false))
                .andExpect(jsonPath("$.settings.peeBreakAfterSeconds").value(45))
                .andExpect(jsonPath("$.settings.trainerDifficulty").value(0.5))
                .andExpect(jsonPath("$.settings.cornerAssistEnabled").value(true));
        authedJson(put("/api/me/settings"), s, """
                {"peeBreakEnabled":true,"peeBreakAfterSeconds":1,"crashEventsEnabled":true,
                 "trainerDifficulty":1.5,"audioEnabled":true,"cornerAssistEnabled":false}""")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.peeBreakAfterSeconds").value("Minimo 5 secondi"))
                .andExpect(jsonPath("$.errors.trainerDifficulty").value("Difficoltà tra 0 e 1"));
    }

    @Test
    void changePasswordRevokesOldSessions() throws Exception {
        Session s = register();
        authedJson(put("/api/me/password"), s, """
                {"currentPassword":"wrong-one-here","newPassword":"a-brand-new-password"}""")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("La password attuale non è corretta"));

        String body = authedJson(put("/api/me/password"), s, """
                {"currentPassword":"%s","newPassword":"a-brand-new-password"}""".formatted(PASSWORD))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String newRefresh = JsonPath.read(body, "$.refreshToken");

        postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(s.refreshToken())).andExpect(status().isUnauthorized());
        postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(newRefresh)).andExpect(status().isOk());
        postJson("/api/auth/login", """
                {"email":"%s","password":"a-brand-new-password"}""".formatted(s.email())).andExpect(status().isOk());
        postJson("/api/auth/login", """
                {"email":"%s","password":"%s"}""".formatted(s.email(), PASSWORD))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void deleteAccountNeedsPasswordAndRemovesEverything() throws Exception {
        Session s = register();
        authedJson(delete("/api/me"), s, """
                {"password":"wrong-password!"}""").andExpect(status().isBadRequest());
        authedJson(delete("/api/me"), s, """
                {"password":"%s"}""".formatted(PASSWORD)).andExpect(status().isNoContent());

        postJson("/api/auth/login", """
                {"email":"%s","password":"%s"}""".formatted(s.email(), PASSWORD))
                .andExpect(status().isUnauthorized());
        postJson("/api/auth/refresh", """
                {"refreshToken":"%s"}""".formatted(s.refreshToken())).andExpect(status().isUnauthorized());
        me(s).andExpect(status().isNotFound());
    }

    @Test
    void usersOnlySeeThemselves() throws Exception {
        Session a = register();
        Session b = register();
        me(a).andExpect(jsonPath("$.email").value(a.email()));
        me(b).andExpect(jsonPath("$.email").value(b.email()));
    }
}
