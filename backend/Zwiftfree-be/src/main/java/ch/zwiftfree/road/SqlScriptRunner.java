package ch.zwiftfree.road;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.postgresql.PGConnection;
import org.postgresql.copy.CopyManager;

/**
 * Runs a psql-style script over JDBC: plain SQL statements (terminated by {@code ;} at end of line) plus psql
 * {@code \copy table(cols) FROM 'file' WITH (...)} meta-commands, which are executed with the PostgreSQL COPY API
 * reading the file relative to the script's folder.
 */
final class SqlScriptRunner {

    private static final Pattern COPY = Pattern.compile(
            "^\\\\copy\\s+(\\w+\\s*\\([^)]*\\))\\s+FROM\\s+'([^']+)'\\s*(WITH\\s*\\(.*\\))?\\s*;?\\s*$",
            Pattern.CASE_INSENSITIVE);

    sealed interface Command permits Sql, Copy {
    }

    record Sql(String sql) implements Command {
    }

    record Copy(String target, String file, String options) implements Command {
    }

    private SqlScriptRunner() {
    }

    static List<Command> parse(String script) {
        List<Command> commands = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String rawLine : script.split("\\R")) {
            String line = rawLine.strip();
            if (current.isEmpty() && (line.isEmpty() || line.startsWith("--"))) {
                continue;
            }
            if (current.isEmpty() && line.startsWith("\\")) {
                Matcher m = COPY.matcher(line);
                if (!m.matches()) {
                    throw new IllegalArgumentException("Unsupported psql meta-command: " + line);
                }
                commands.add(new Copy(m.group(1), m.group(2), m.group(3) == null ? "" : m.group(3)));
                continue;
            }
            if (line.startsWith("--")) {
                continue;
            }
            current.append(rawLine).append('\n');
            if (line.endsWith(";")) {
                commands.add(new Sql(current.toString().strip()));
                current.setLength(0);
            }
        }
        if (!current.toString().isBlank()) {
            commands.add(new Sql(current.toString().strip()));
        }
        return commands;
    }

    static void run(Connection conn, Path scriptFile) throws IOException, SQLException {
        String script = Files.readString(scriptFile, StandardCharsets.UTF_8);
        Path baseDir = scriptFile.getParent();
        CopyManager copy = conn.unwrap(PGConnection.class).getCopyAPI();
        for (Command c : parse(script)) {
            switch (c) {
                case Sql s -> {
                    try (Statement st = conn.createStatement()) {
                        st.execute(s.sql());
                    }
                }
                case Copy cp -> {
                    Path file = baseDir.resolve(cp.file()).normalize();
                    if (!file.startsWith(baseDir)) {
                        throw new IllegalArgumentException("COPY file outside the data folder: " + cp.file());
                    }
                    try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                        copy.copyIn("COPY " + cp.target() + " FROM STDIN " + cp.options(), reader);
                    }
                }
            }
        }
    }
}
