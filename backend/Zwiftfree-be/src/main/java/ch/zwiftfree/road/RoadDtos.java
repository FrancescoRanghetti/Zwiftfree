package ch.zwiftfree.road;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public final class RoadDtos {

    private RoadDtos() {
    }

    public record EdgeDto(
            long id,
            long source,
            long target,
            String name,
            String highway,
            String surface,
            int oneway,
            int rank,
            double lengthM,
            double ascentM,
            double descentM,
            double avgGrade,
            double maxGrade,
            double minGrade,
            boolean forwardAllowed,
            boolean backwardAllowed,
            double[][] coordinates) {

        static EdgeDto of(RoadEdge e) {
            return new EdgeDto(e.id(), e.source(), e.target(), e.name(), e.highway(), e.surface(), e.oneway(),
                    e.rank(), e.lengthM(), e.ascentM(), e.descentM(), e.avgGrade(), e.maxGrade(), e.minGrade(),
                    e.canTravel(1), e.canTravel(-1), e.coords());
        }
    }

    public record NearestDto(NodeDto node, NearestEdgeDto edge) {
    }

    public record NodeDto(long id, double lat, double lon, double ele, double distanceM) {
    }

    public record NearestEdgeDto(long id, String name, String highway, double distanceM, double fraction) {
    }

    public record LatLon(
            @NotNull @DecimalMin(value = "45.7", message = "Fuori dal Ticino") @DecimalMax(value = "46.7", message = "Fuori dal Ticino") Double lat,
            @NotNull @DecimalMin(value = "8.3", message = "Fuori dal Ticino") @DecimalMax(value = "9.3", message = "Fuori dal Ticino") Double lon) {
    }

    public record PlanRequest(
            @NotNull @Size(min = 2, max = 25, message = "Da 2 a 25 punti") List<@Valid @NotNull LatLon> waypoints,
            PlanProfile profile,
            boolean loop) {
    }

    public record RouteGeometryDto(
            List<Long> edgeIds,
            List<Integer> directions,
            double[] edgeStartsM,
            double[][] coordinates,
            double[][] profile,
            double lengthM,
            double ascentM,
            double descentM,
            double minEle,
            double maxEle,
            double maxGrade,
            boolean loop,
            List<String> roadNames) {

        public static RouteGeometryDto of(PlannedRoute r) {
            return new RouteGeometryDto(r.edgeIds(), r.directions(), r.edgeStartsM(), r.coordinates(), r.profile(),
                    r.lengthM(),
                    r.ascentM(), r.descentM(), r.minEle(), r.maxEle(), r.maxGrade(), r.loop(), r.roadNames());
        }
    }
}
