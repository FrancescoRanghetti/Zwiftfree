package ch.zwiftfree.road;

/** Published after the road network has been (re)imported, or at startup when it was already up to date. */
public record RoadNetworkImportedEvent(boolean changed) {
}
