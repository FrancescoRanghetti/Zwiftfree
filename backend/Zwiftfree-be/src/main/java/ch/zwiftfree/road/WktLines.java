package ch.zwiftfree.road;

/** Public facade over the package-private WKT helpers. */
public final class WktLines {

    private WktLines() {
    }

    public static double[][] parse(String wkt) {
        return Wkt.lineString(wkt);
    }

    public static String toLineStringZ(double[][] coords) {
        return Wkt.lineStringZ(coords);
    }
}
