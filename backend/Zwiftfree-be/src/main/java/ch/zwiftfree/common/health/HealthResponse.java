package ch.zwiftfree.common.health;

/**
 * Lightweight status for the UI.
 *
 * @param status UP when the database answers
 * @param postgis PostGIS version, or null when unavailable
 * @param pgrouting pgRouting version, or null when the extension is not installed yet
 */
public record HealthResponse(String status, String version, String database, String postgis, String pgrouting) {
}
