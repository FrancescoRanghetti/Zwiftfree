package ch.zwiftfree.stats;

import ch.zwiftfree.common.security.CurrentUser;
import ch.zwiftfree.common.web.ApiException;
import ch.zwiftfree.stats.StatsDtos.CurvePoint;
import ch.zwiftfree.stats.StatsDtos.LoadDay;
import ch.zwiftfree.stats.StatsDtos.Period;
import ch.zwiftfree.stats.StatsDtos.RecordDto;
import ch.zwiftfree.stats.StatsDtos.SegmentBoard;
import ch.zwiftfree.stats.StatsDtos.Summary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Tag(name = "stats")
@SecurityRequirement(name = "bearer")
public class StatsController {

    private final StatsService stats;

    public StatsController(StatsService stats) {
        this.stats = stats;
    }

    @GetMapping("/api/stats/summary")
    @Operation(summary = "Totals and fun counters for week|month|year|all")
    public Summary summary(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "week") String period) {
        return stats.summary(CurrentUser.id(jwt), period(period));
    }

    @GetMapping("/api/stats/power-curve")
    @Operation(summary = "Best average power from 5 s to 60 min")
    public List<CurvePoint> powerCurve(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "all") String period) {
        return stats.powerCurve(CurrentUser.id(jwt), period(period));
    }

    @GetMapping("/api/stats/training-load")
    @Operation(summary = "Daily TSS with CTL (42 d), ATL (7 d) and TSB; default the last 90 days")
    public List<LoadDay> trainingLoad(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return stats.trainingLoad(CurrentUser.id(jwt), from, to);
    }

    @GetMapping("/api/stats/records")
    @Operation(summary = "Personal records: best power, longest ride, most climbing, best segment times")
    public List<RecordDto> records(@AuthenticationPrincipal Jwt jwt) {
        return stats.records(CurrentUser.id(jwt));
    }

    @GetMapping("/api/routes/{id}/leaderboard")
    @Operation(summary = "The user's best times on each segment of the route")
    public List<SegmentBoard> leaderboard(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return stats.leaderboard(CurrentUser.id(jwt), id);
    }

    private static Period period(String value) {
        try {
            return Period.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Periodo non valido: usa week, month, year o all");
        }
    }
}
