package ch.zwiftfree.road;

/** Small spherical-earth helpers; precise enough for metres-scale road geometry. */
public final class Geo {

    private static final double R = 6_371_008.8;

    private Geo() {
    }

    /** Great-circle distance in metres between two [lon, lat] points. */
    public static double distance(double lon1, double lat1, double lon2, double lat2) {
        double p1 = Math.toRadians(lat1);
        double p2 = Math.toRadians(lat2);
        double dp = p2 - p1;
        double dl = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2)
                + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    /** Initial bearing in degrees [0, 360) from point 1 to point 2. */
    public static double bearing(double lon1, double lat1, double lon2, double lat2) {
        double p1 = Math.toRadians(lat1);
        double p2 = Math.toRadians(lat2);
        double dl = Math.toRadians(lon2 - lon1);
        double y = Math.sin(dl) * Math.cos(p2);
        double x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
        return (Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
    }

    /** Signed turn in degrees (-180, 180]: negative = left, positive = right, 0 = straight on. */
    public static double turn(double fromBearing, double toBearing) {
        double d = (toBearing - fromBearing + 540) % 360 - 180;
        return d == -180 ? 180 : d;
    }

    /**
     * Bearing of a polyline end, measured over roughly {@code span} metres so that GPS-style jitter in the last
     * point does not dominate. {@code atEnd} = direction of arrival, otherwise direction of departure.
     */
    public static double polylineBearing(double[][] pts, boolean atEnd, double span) {
        if (pts.length < 2) {
            return 0;
        }
        if (atEnd) {
            double[] last = pts[pts.length - 1];
            int i = pts.length - 2;
            double acc = 0;
            while (i > 0 && acc < span) {
                acc += distance(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
                if (acc >= span)
                    break;
                i--;
            }
            return bearing(pts[i][0], pts[i][1], last[0], last[1]);
        }
        double[] first = pts[0];
        int i = 1;
        double acc = 0;
        while (i < pts.length - 1 && acc < span) {
            acc += distance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
            if (acc >= span)
                break;
            i++;
        }
        return bearing(first[0], first[1], pts[i][0], pts[i][1]);
    }
}
