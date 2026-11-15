package ch.zwiftfree.road;

import ch.zwiftfree.common.web.NotFoundException;
import ch.zwiftfree.road.RoadDtos.EdgeDto;
import ch.zwiftfree.road.RoadDtos.NearestDto;
import ch.zwiftfree.road.RoadDtos.NearestEdgeDto;
import ch.zwiftfree.road.RoadDtos.NodeDto;
import ch.zwiftfree.road.RoadDtos.PlanRequest;
import ch.zwiftfree.road.RoadDtos.RouteGeometryDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.Duration;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@Tag(name = "roads")
public class RoadController {

    static final MediaType MVT = MediaType.parseMediaType("application/vnd.mapbox-vector-tile");

    private final TileService tiles;
    private final RoadRepository roads;
    private final JunctionService junctions;
    private final PlannerService planner;

    public RoadController(TileService tiles, RoadRepository roads, JunctionService junctions, PlannerService planner) {
        this.tiles = tiles;
        this.roads = roads;
        this.junctions = junctions;
        this.planner = planner;
    }

    @GetMapping("/api/tiles/roads/{z}/{x}/{y}.mvt")
    @Operation(summary = "Vector tile of the road network (public, cached 1 day)")
    public ResponseEntity<byte[]> tile(@PathVariable int z, @PathVariable int x, @PathVariable int y) {
        byte[] body = tiles.roads(z, x, y);
        return ResponseEntity.ok()
                .contentType(MVT)
                .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
                .body(body);
    }

    @GetMapping("/api/roads/nearest")
    @SecurityRequirement(name = "bearer")
    @Operation(summary = "Nearest junction and road to a point (within 1.5 km)")
    public NearestDto nearest(@RequestParam double lat, @RequestParam double lon) {
        var node = roads.nearestNode(lat, lon, PlannerService.MAX_SNAP_M)
                .orElseThrow(() -> new NotFoundException("Nessuna strada nelle vicinanze"));
        var edge = roads.nearestEdge(lat, lon, PlannerService.MAX_SNAP_M).orElseThrow();
        return new NearestDto(new NodeDto(node.id(), node.lat(), node.lon(), node.ele(), round(node.distanceM())),
                new NearestEdgeDto(edge.edge().id(), edge.edge().name(), edge.edge().highway(),
                        round(edge.distanceM()), edge.fraction()));
    }

    @GetMapping("/api/roads/edges/{id}")
    @SecurityRequirement(name = "bearer")
    public EdgeDto edge(@PathVariable long id) {
        return roads.edge(id).map(EdgeDto::of).orElseThrow(() -> new NotFoundException("Strada non trovata"));
    }

    @GetMapping("/api/roads/next")
    @SecurityRequirement(name = "bearer")
    @Operation(summary = "Ways out of the junction at the end of an edge, with turn angles")
    public List<TurnOption> next(@RequestParam long edgeId,
            @RequestParam @Min(-1) @Max(1) int direction) {
        return junctions.next(edgeId, direction == 0 ? 1 : direction);
    }

    @GetMapping("/api/roads/area")
    @SecurityRequirement(name = "bearer")
    @Operation(summary = "Every edge within a radius (max 3 km), for instant turns in free ride")
    public List<EdgeDto> area(@RequestParam double lat, @RequestParam double lon,
            @RequestParam(defaultValue = "2000") @Min(50) @Max(3000) double radius) {
        return roads.area(lat, lon, radius).stream().map(EdgeDto::of).toList();
    }

    @PostMapping("/api/roads/plan")
    @SecurityRequirement(name = "bearer")
    @Operation(summary = "Plan a route through the waypoints with the chosen cost profile")
    public RouteGeometryDto plan(@Valid @RequestBody PlanRequest req) {
        var points = req.waypoints().stream().map(p -> new PlannerService.Waypoint(p.lat(), p.lon())).toList();
        return RouteGeometryDto.of(planner.plan(points,
                req.profile() == null ? PlanProfile.SHORTEST : req.profile(), req.loop()));
    }

    private static double round(double v) {
        return Math.round(v * 10) / 10.0;
    }
}
