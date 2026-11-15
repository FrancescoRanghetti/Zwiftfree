package ch.zwiftfree;

import java.nio.file.Path;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.images.builder.ImageFromDockerfile;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Real PostgreSQL + PostGIS + pgRouting, built from the same db/Dockerfile as docker-compose. */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfig {

    /** Built once and kept (docker layer cache makes later builds instant). */
    public static final DockerImageName DB_IMAGE = DockerImageName
            .parse(new ImageFromDockerfile("zwiftfree-db-test", false)
                    .withFileFromPath(".", Path.of("../../db").toAbsolutePath().normalize())
                    .get())
            .asCompatibleSubstituteFor("postgres");

    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer(DB_IMAGE);
    }
}
