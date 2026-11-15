package ch.zwiftfree.common.health;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HealthService {

    private static final Logger log = LoggerFactory.getLogger(HealthService.class);

    private final JdbcTemplate jdbc;

    public HealthService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public HealthResponse check(String version) {
        try {
            String postgis = jdbc.queryForObject("SELECT extversion FROM pg_extension WHERE extname = 'postgis'",
                    String.class);
            String pgrouting = jdbc.query(
                    "SELECT extversion FROM pg_extension WHERE extname = 'pgrouting'",
                    rs -> rs.next() ? rs.getString(1) : null);
            return new HealthResponse("UP", version, "UP", postgis, pgrouting);
        } catch (DataAccessException e) {
            log.warn("Database health check failed: {}", e.getMessage());
            return new HealthResponse("DEGRADED", version, "DOWN", null, null);
        }
    }
}
