package ch.zwiftfree.common.security;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param jwtSecret HMAC-SHA256 key, at least 32 bytes. When blank a random key is generated at startup (dev only:
 *            tokens do not survive a restart).
 * @param maxFailedLoginsPerEmail failed logins tolerated per email within {@code loginWindow}
 * @param maxFailedLoginsPerIp failed logins tolerated per client IP within {@code loginWindow}
 */
@ConfigurationProperties(prefix = "zwiftfree.security")
public record SecurityProperties(
        String jwtSecret,
        Duration accessTokenTtl,
        Duration refreshTokenTtl,
        int maxFailedLoginsPerEmail,
        int maxFailedLoginsPerIp,
        Duration loginWindow) {

    public SecurityProperties {
        if (accessTokenTtl == null)
            accessTokenTtl = Duration.ofMinutes(15);
        if (refreshTokenTtl == null)
            refreshTokenTtl = Duration.ofDays(30);
        if (maxFailedLoginsPerEmail <= 0)
            maxFailedLoginsPerEmail = 5;
        if (maxFailedLoginsPerIp <= 0)
            maxFailedLoginsPerIp = 20;
        if (loginWindow == null)
            loginWindow = Duration.ofMinutes(15);
    }
}
