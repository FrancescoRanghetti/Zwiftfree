package ch.zwiftfree.road;

/** Minimal parser for PostGIS {@code ST_AsText} line strings (2D or Z). */
final class Wkt {

    private Wkt() {
    }

    /** @return [lon, lat, ele] per point; ele is 0 for 2D input */
    static double[][] lineString(String wkt) {
        if (wkt == null) {
            return new double[0][];
        }
        int open = wkt.indexOf('(');
        int close = wkt.lastIndexOf(')');
        if (open < 0 || close < open) {
            throw new IllegalArgumentException("Not a LINESTRING: " + wkt);
        }
        String[] points = wkt.substring(open + 1, close).split(",");
        double[][] out = new double[points.length][];
        for (int i = 0; i < points.length; i++) {
            String[] parts = points[i].trim().split("\\s+");
            out[i] = new double[]{
                    Double.parseDouble(parts[0]),
                    Double.parseDouble(parts[1]),
                    parts.length > 2 ? Double.parseDouble(parts[2]) : 0};
        }
        return out;
    }

    static String lineStringZ(double[][] coords) {
        StringBuilder sb = new StringBuilder("LINESTRING Z (");
        for (int i = 0; i < coords.length; i++) {
            if (i > 0)
                sb.append(',');
            sb.append(coords[i][0]).append(' ').append(coords[i][1]).append(' ').append(coords[i][2]);
        }
        return sb.append(')').toString();
    }
}
