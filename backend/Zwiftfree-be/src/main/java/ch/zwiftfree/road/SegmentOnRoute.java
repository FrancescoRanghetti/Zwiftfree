package ch.zwiftfree.road;

import java.util.UUID;

/** A timed segment found inside a route, with its position along the route. */
public record SegmentOnRoute(
        UUID id,
        String name,
        String type,
        double startM,
        double endM,
        double lengthM,
        double avgGrade,
        double ascentM) {
}
