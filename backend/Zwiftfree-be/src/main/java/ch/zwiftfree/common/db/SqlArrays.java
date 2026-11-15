package ch.zwiftfree.common.db;

import java.sql.Array;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/** JDBC array helpers for bigint[] / smallint[] columns. */
public final class SqlArrays {

    private SqlArrays() {
    }

    public static Array bigints(Connection c, List<Long> values) throws SQLException {
        return c.createArrayOf("bigint", values.toArray());
    }

    public static Array smallints(Connection c, List<Integer> values) throws SQLException {
        return c.createArrayOf("smallint", values.stream().map(Integer::shortValue).toArray());
    }

    /** Postgres array literal, e.g. {@code {1,2,NULL}}, for a {@code ?::int[]} parameter. */
    public static String literal(Integer[] values) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < values.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(values[i] == null ? "NULL" : values[i].toString());
        }
        return sb.append('}').toString();
    }

    public static List<Long> longs(ResultSet rs, String column) throws SQLException {
        Array a = rs.getArray(column);
        List<Long> out = new ArrayList<>();
        if (a != null) {
            for (Object o : (Object[]) a.getArray())
                out.add(((Number) o).longValue());
        }
        return out;
    }

    public static List<Integer> ints(ResultSet rs, String column) throws SQLException {
        Array a = rs.getArray(column);
        List<Integer> out = new ArrayList<>();
        if (a != null) {
            for (Object o : (Object[]) a.getArray())
                out.add(((Number) o).intValue());
        }
        return out;
    }
}
