package ch.zwiftfree.road;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param dataDir folder produced by data/scarica_ticino.py (contains load_postgis.sql, CSVs, stats.json); blank
 *            disables the import
 * @param importEnabled run the import at startup when the data changed
 * @param tileCacheSize number of vector tiles kept in memory
 */
@ConfigurationProperties(prefix = "zwiftfree.roads")
public record RoadProperties(String dataDir, boolean importEnabled, int tileCacheSize) {

    public RoadProperties {
        if (tileCacheSize <= 0)
            tileCacheSize = 4000;
    }
}
