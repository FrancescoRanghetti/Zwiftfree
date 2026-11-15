package ch.zwiftfree.road;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** Runs the import once Flyway has created the app schema. */
@Component
@Order(10)
public class RoadStartup implements ApplicationRunner {

    private final RoadImportService importService;

    public RoadStartup(RoadImportService importService) {
        this.importService = importService;
    }

    @Override
    public void run(ApplicationArguments args) {
        importService.importIfNeeded();
    }
}
