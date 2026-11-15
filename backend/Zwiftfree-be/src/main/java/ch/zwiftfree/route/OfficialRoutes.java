package ch.zwiftfree.route;

import ch.zwiftfree.road.PlanProfile;
import ch.zwiftfree.road.PlannedRoute;
import ch.zwiftfree.road.PlannerService;
import ch.zwiftfree.road.PlannerService.Waypoint;
import ch.zwiftfree.road.RoadNetworkImportedEvent;
import ch.zwiftfree.road.SegmentGenerator;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** The app's own routes, computed from the network after every import; missing ones only log a warning. */
@Component
public class OfficialRoutes {

    private static final Logger log = LoggerFactory.getLogger(OfficialRoutes.class);

    record Definition(String slug, String name, String description, PlanProfile profile, boolean loop,
            List<Waypoint> waypoints) {
    }

    static final List<Definition> DEFINITIONS = List.of(
            new Definition("cadenazzo-monte-ceneri", "Cadenazzo – Monte Ceneri",
                    "La salita classica dal Piano di Magadino al passo del Monte Ceneri.", PlanProfile.SHORTEST,
                    false, List.of(new Waypoint(46.1517, 8.9479), new Waypoint(46.1405, 8.9130))),
            new Definition("bellinzona-airolo", "Bellinzona – Airolo (Leventina)",
                    "Tutta la Leventina, da Bellinzona ai piedi del Gottardo passando da Biasca e Faido.",
                    PlanProfile.SHORTEST, false,
                    List.of(new Waypoint(46.1921, 9.0206), new Waypoint(46.3606, 8.9714),
                            new Waypoint(46.4780, 8.8009), new Waypoint(46.5290, 8.6086))),
            new Definition("locarno-valle-maggia-bignasco", "Locarno – Valle Maggia – Bignasco",
                    "Da Locarno lungo la Maggia fino a Bignasco, porta delle valli Bavona e Lavizzara.",
                    PlanProfile.SHORTEST, false,
                    List.of(new Waypoint(46.1696, 8.7955), new Waypoint(46.2470, 8.7067),
                            new Waypoint(46.3397, 8.6086))),
            new Definition("lugano-monte-bre", "Lugano – Monte Brè",
                    "Dal lungolago di Lugano fino al nucleo di Brè sopra Lugano.", PlanProfile.SHORTEST, false,
                    List.of(new Waypoint(46.0038, 8.9512), new Waypoint(46.0115, 8.9968))),
            new Definition("giro-piano-di-magadino", "Giro del Piano di Magadino",
                    "Anello pianeggiante tra Bellinzona, Gudo, Gordola, Magadino e Cadenazzo.",
                    PlanProfile.AVOID_CLIMBS,
                    true,
                    List.of(new Waypoint(46.1921, 9.0206), new Waypoint(46.1757, 8.9444),
                            new Waypoint(46.1814, 8.8634), new Waypoint(46.1474, 8.8559),
                            new Waypoint(46.1510, 8.9459))));

    private final PlannerService planner;
    private final RouteService routes;
    private final SegmentGenerator segments;

    public OfficialRoutes(PlannerService planner, RouteService routes, SegmentGenerator segments) {
        this.planner = planner;
        this.routes = routes;
        this.segments = segments;
    }

    @EventListener
    @Order(1)
    public void onNetwork(RoadNetworkImportedEvent event) {
        int ok = 0;
        for (Definition d : DEFINITIONS) {
            if (!event.changed() && routes.officialExists(d.slug())) {
                ok++;
                continue;
            }
            try {
                PlannedRoute r = planner.plan(d.waypoints(), d.profile(), d.loop());
                routes.upsertOfficial(d.slug(), d.name(), d.description(), r, d.profile().name());
                segments.upsertRouteSegment(d.slug(), d.name(), r.edgeIds(), r.directions(), r.lengthM(),
                        r.ascentM(), r.descentM());
                ok++;
                log.info("Official route '{}': {} km, {} m up", d.name(), Math.round(r.lengthM() / 100) / 10.0,
                        Math.round(r.ascentM()));
            } catch (RuntimeException e) {
                log.warn("Official route '{}' could not be computed: {}", d.name(), e.getMessage());
            }
        }
        log.info("Official routes available: {}/{}", ok, DEFINITIONS.size());
    }

    @EventListener
    @Order(2)
    public void climbs(RoadNetworkImportedEvent event) {
        segments.regenerateClimbs(event.changed());
    }
}
