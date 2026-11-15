package ch.zwiftfree.road;

/**
 * One road segment between two junctions, with its 3D geometry (one point every ~10 m) stored source→target.
 *
 * @param coords [lon, lat, ele] points from source to target
 */
public record RoadEdge(
        long id,
        long source,
        long target,
        String name,
        String highway,
        String surface,
        int oneway,
        int rank,
        double lengthM,
        double ascentM,
        double descentM,
        double avgGrade,
        double maxGrade,
        double minGrade,
        double cost,
        double reverseCost,
        double[][] coords) {

    /** Direction 1 = source→target, -1 = target→source. */
    public boolean canTravel(int direction) {
        return direction == 1 ? cost >= 0 : reverseCost >= 0;
    }

    public long startNode(int direction) {
        return direction == 1 ? source : target;
    }

    public long endNode(int direction) {
        return direction == 1 ? target : source;
    }

    public double gain(int direction) {
        return direction == 1 ? ascentM : descentM;
    }

    public double loss(int direction) {
        return direction == 1 ? descentM : ascentM;
    }

    /** Steepest uphill grade (%) when travelling in this direction. */
    public double maxGrade(int direction) {
        return direction == 1 ? maxGrade : -minGrade;
    }

    /** Points in travel order. */
    public double[][] coords(int direction) {
        if (direction == 1) {
            return coords;
        }
        double[][] r = new double[coords.length][];
        for (int i = 0; i < coords.length; i++) {
            r[i] = coords[coords.length - 1 - i];
        }
        return r;
    }
}
