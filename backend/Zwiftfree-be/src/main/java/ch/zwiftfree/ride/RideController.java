package ch.zwiftfree.ride;

import ch.zwiftfree.common.security.CurrentUser;
import ch.zwiftfree.ride.RideDtos.CreateRide;
import ch.zwiftfree.ride.RideDtos.EventsBatch;
import ch.zwiftfree.ride.RideDtos.Explored;
import ch.zwiftfree.ride.RideDtos.Page;
import ch.zwiftfree.ride.RideDtos.RideDetail;
import ch.zwiftfree.ride.RideDtos.RideSummary;
import ch.zwiftfree.ride.RideDtos.SamplesBatch;
import ch.zwiftfree.ride.RideDtos.SamplesColumns;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Tag(name = "rides")
@SecurityRequirement(name = "bearer")
public class RideController {

    private final RideService rides;
    private final ExploredService explored;
    private final ExportService exports;

    public RideController(RideService rides, ExploredService explored, ExportService exports) {
        this.rides = rides;
        this.explored = explored;
        this.exports = exports;
    }

    @PostMapping("/api/rides")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Start a ride (IN_PROGRESS)")
    public RideSummary create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CreateRide req) {
        return rides.create(CurrentUser.id(jwt), req);
    }

    @PostMapping("/api/rides/{id}/samples")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Block of 1 Hz samples and ridden edges (idempotent on t and seq)")
    public void samples(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
            @Valid @RequestBody SamplesBatch batch) {
        rides.addSamples(CurrentUser.id(jwt), id, batch);
    }

    @PostMapping("/api/rides/{id}/events")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Ride events (idempotent on the client-generated id)")
    public void events(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
            @Valid @RequestBody EventsBatch batch) {
        rides.addEvents(CurrentUser.id(jwt), id, batch);
    }

    @PostMapping("/api/rides/{id}/complete")
    @Operation(summary = "Finish the ride: summary, NP, TSS, explored roads")
    public RideDetail complete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return rides.complete(CurrentUser.id(jwt), id);
    }

    @GetMapping("/api/rides")
    public Page<RideSummary> list(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size, @RequestParam(required = false) UUID routeId) {
        return rides.list(CurrentUser.id(jwt), page, size, routeId);
    }

    @GetMapping("/api/rides/{id}")
    public RideDetail get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return rides.get(CurrentUser.id(jwt), id);
    }

    @GetMapping("/api/rides/{id}/samples")
    @Operation(summary = "All samples of a ride, one array per field")
    public SamplesColumns samples(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return rides.samples(CurrentUser.id(jwt), id);
    }

    @GetMapping("/api/rides/{id}/export.gpx")
    @Operation(summary = "The ride as GPX 1.1 (track with heart rate, cadence and power)")
    public ResponseEntity<byte[]> gpx(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return download(exports.gpx(CurrentUser.id(jwt), id), "application/gpx+xml");
    }

    @GetMapping("/api/rides/{id}/export.fit")
    @Operation(summary = "The ride as a FIT activity (virtual ride) for Garmin Connect, Strava, …")
    public ResponseEntity<byte[]> fit(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return download(exports.fit(CurrentUser.id(jwt), id), "application/vnd.ant.fit");
    }

    private static ResponseEntity<byte[]> download(ExportService.Export file, String type) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(type))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(file.fileName()).build().toString())
                .body(file.content());
    }

    @DeleteMapping("/api/rides/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        rides.delete(CurrentUser.id(jwt), id);
    }

    @GetMapping("/api/me/explored")
    @Operation(summary = "Share of Ticino roads ridden by the user, with their geometry")
    public Explored explored(@AuthenticationPrincipal Jwt jwt) {
        return explored.explored(CurrentUser.id(jwt));
    }
}
