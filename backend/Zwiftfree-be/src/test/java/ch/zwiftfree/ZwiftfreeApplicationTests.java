package ch.zwiftfree;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
@Import(TestcontainersConfig.class)
class ZwiftfreeApplicationTests {

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void flywayCreatesTheCoreSchema() {
        List<String> tables = jdbc.queryForList(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'", String.class);
        assertThat(tables)
                .contains(
                        "users",
                        "user_profiles",
                        "user_settings",
                        "refresh_tokens",
                        "routes",
                        "segments",
                        "rides",
                        "ride_samples",
                        "ride_events",
                        "segment_efforts",
                        "ride_edges",
                        "user_explored_edges",
                        "personal_records");
    }

    @Test
    void spatialExtensionsAreInstalled() {
        List<String> ext = jdbc.queryForList("SELECT extname FROM pg_extension", String.class);
        assertThat(ext).contains("postgis", "pgrouting", "citext");
    }
}
