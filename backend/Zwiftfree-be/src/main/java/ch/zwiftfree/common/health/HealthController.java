package ch.zwiftfree.common.health;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/health")
@Tag(name = "health")
public class HealthController {

    private final HealthService healthService;
    private final String version;

    public HealthController(HealthService healthService, ObjectProvider<BuildProperties> buildProperties) {
        this.healthService = healthService;
        BuildProperties props = buildProperties.getIfAvailable();
        this.version = props != null ? props.getVersion() : "dev";
    }

    @GetMapping
    @Operation(summary = "Application and database status")
    public HealthResponse health() {
        return healthService.check(version);
    }
}
