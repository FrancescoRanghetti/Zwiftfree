package ch.zwiftfree.road;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

class SqlScriptRunnerTest {

    @Test
    void splitsStatementsAndCopyCommands() {
        List<SqlScriptRunner.Command> cmds = SqlScriptRunner.parse("""
                -- comment
                CREATE TABLE t (
                  id int  -- trailing comment kept inside the statement
                );
                \\copy t(id) FROM 'data.csv' WITH (FORMAT csv, HEADER true)
                UPDATE t SET id = 1;
                """);
        assertThat(cmds).hasSize(3);
        assertThat(cmds.get(0)).isInstanceOf(SqlScriptRunner.Sql.class);
        assertThat(cmds.get(1)).isEqualTo(new SqlScriptRunner.Copy("t(id)", "data.csv",
                "WITH (FORMAT csv, HEADER true)"));
        assertThat(((SqlScriptRunner.Sql) cmds.get(2)).sql()).isEqualTo("UPDATE t SET id = 1;");
    }

    @Test
    void rejectsOtherMetaCommands() {
        assertThatThrownBy(() -> SqlScriptRunner.parse("\\i other.sql")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void tileBoundsCoverTicinoOnly() {
        assertThat(TileService.intersectsTicino(14, 8599, 5819)).isTrue();
        assertThat(TileService.intersectsTicino(14, 0, 0)).isFalse();
        assertThat(TileService.intersectsTicino(0, 0, 0)).isTrue();
    }

    @Test
    void turnAnglesAreSigned() {
        assertThat(Geo.turn(0, 90)).isEqualTo(90);
        assertThat(Geo.turn(0, 270)).isEqualTo(-90);
        assertThat(Geo.turn(350, 10)).isEqualTo(20);
        assertThat(Geo.turn(90, 270)).isEqualTo(180);
    }
}
