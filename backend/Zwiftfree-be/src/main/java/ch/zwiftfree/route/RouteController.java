package ch.zwiftfree.route;

import ch.zwiftfree.common.security.CurrentUser;
import ch.zwiftfree.route.RouteDtos.CreateRoute;
import ch.zwiftfree.route.RouteDtos.RouteDetail;
import ch.zwiftfree.route.RouteDtos.RouteSummary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/routes")
@Tag(name = "routes")
@SecurityRequirement(name = "bearer")
public class RouteController {

    private final RouteService routes;

    public RouteController(RouteService routes) {
        this.routes = routes;
    }

    @GetMapping
    @Operation(summary = "Official, own and public routes (without full geometry)")
    public List<RouteSummary> list(@AuthenticationPrincipal Jwt jwt) {
        return routes.list(CurrentUser.id(jwt));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Route with full 3D track, elevation profile and the segments it contains")
    public RouteDetail get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return routes.get(CurrentUser.id(jwt), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Save a planned or ridden route (sequence of directed edges)")
    public RouteDetail create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CreateRoute req) {
        return routes.create(CurrentUser.id(jwt), req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        routes.delete(CurrentUser.id(jwt), id);
    }
}
