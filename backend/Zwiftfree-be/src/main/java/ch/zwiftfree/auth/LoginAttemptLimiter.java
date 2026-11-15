package ch.zwiftfree.auth;

import ch.zwiftfree.common.security.SecurityProperties;
import ch.zwiftfree.common.web.TooManyRequestsException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * In-memory sliding-window limiter for failed logins, per email and per client IP. Good enough for a single backend
 * instance; swap for a shared store if the backend is ever scaled out.
 */
@Component
public class LoginAttemptLimiter {

    private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();
    private final SecurityProperties props;
    private final Clock clock;

    public LoginAttemptLimiter(SecurityProperties props, Clock clock) {
        this.props = props;
        this.clock = clock;
    }

    /** Throws 429 when either key is over its limit. */
    public void check(String email, String ip) {
        Instant now = clock.instant();
        check(emailKey(email), props.maxFailedLoginsPerEmail(), now);
        check(ipKey(ip), props.maxFailedLoginsPerIp(), now);
    }

    public void recordFailure(String email, String ip) {
        Instant now = clock.instant();
        add(emailKey(email), now);
        add(ipKey(ip), now);
    }

    public void recordSuccess(String email) {
        failures.remove(emailKey(email));
    }

    private void check(String key, int max, Instant now) {
        Deque<Instant> q = failures.get(key);
        if (q == null) {
            return;
        }
        synchronized (q) {
            prune(q, now);
            if (q.size() >= max) {
                Duration retry = Duration.between(now, q.peekFirst().plus(props.loginWindow()));
                throw new TooManyRequestsException("Troppi tentativi di accesso. Riprova più tardi.", retry);
            }
        }
    }

    private void add(String key, Instant now) {
        Deque<Instant> q = failures.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (q) {
            prune(q, now);
            q.addLast(now);
        }
    }

    private void prune(Deque<Instant> q, Instant now) {
        Instant cutoff = now.minus(props.loginWindow());
        while (!q.isEmpty() && q.peekFirst().isBefore(cutoff)) {
            q.pollFirst();
        }
    }

    private static String emailKey(String email) {
        return "e:" + (email == null ? "" : email.trim().toLowerCase(Locale.ROOT));
    }

    private static String ipKey(String ip) {
        return "i:" + ip;
    }

    /** Clears all counters (tests). */
    public void reset() {
        failures.clear();
    }
}
