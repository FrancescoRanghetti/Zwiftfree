package ch.zwiftfree.route;

import ch.zwiftfree.road.SegmentOnRoute;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class RouteDtos {

    private RouteDtos() {
    }

    /**
     * @param preview simplified 2D track [lon, lat] for thumbnails
     */
    public record RouteSummary(
            UUID id,
            String slug,
            String name,
            String description,
            boolean official,
            boolean mine,
            boolean isPublic,
            double lengthM,
            double ascentM,
            double descentM,
            double minEle,
            double maxEle,
            double maxGrade,
            boolean loop,
            String profile,
            Instant createdAt,
            double[][] preview) {
    }

    /**
     * @param edgeStartsM distance along {@code coordinates} where each edge starts; null when the stored edges no
     *            longer match the road network (re-import), the route can then be shown but not ridden edge by edge
     */
    public record RouteDetail(
            RouteSummary summary,
            List<Long> edgeIds,
            List<Integer> directions,
            double[] edgeStartsM,
            double[][] coordinates,
            double[][] elevationProfile,
            List<SegmentOnRoute> segments) {
    }

    public record CreateRoute(
            @NotBlank(message = "Il nome è obbligatorio") @Size(max = 80, message = "Il nome può avere al massimo 80 caratteri") String name,
            @Size(max = 1000, message = "Descrizione troppo lunga") String description,
            boolean isPublic,
            @NotEmpty(message = "Percorso vuoto") @Size(max = 20000) List<@NotNull Long> edgeIds,
            @NotEmpty(message = "Percorso vuoto") @Size(max = 20000) List<@NotNull Integer> directions,
            String profile) {
    }
}
