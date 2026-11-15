package ch.zwiftfree.auth;

import ch.zwiftfree.auth.AuthDtos.LoginRequest;
import ch.zwiftfree.auth.AuthDtos.RegisterRequest;
import ch.zwiftfree.auth.AuthDtos.TokenResponse;
import ch.zwiftfree.common.security.SecurityProperties;
import ch.zwiftfree.common.web.ApiException;
import ch.zwiftfree.user.User;
import ch.zwiftfree.user.UserProfile;
import ch.zwiftfree.user.UserProfileRepository;
import ch.zwiftfree.user.UserRepository;
import ch.zwiftfree.user.UserSettings;
import ch.zwiftfree.user.UserSettingsRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final String BAD_CREDENTIALS = "Email o password non corretti";
    private static final String INVALID_REFRESH = "Sessione scaduta, accedi di nuovo";

    private final UserRepository users;
    private final UserProfileRepository profiles;
    private final UserSettingsRepository settings;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokenService;
    private final LoginAttemptLimiter limiter;
    private final SecurityProperties props;
    private final Clock clock;
    /** Compared against when the email is unknown, so timing does not reveal registered emails. */
    private final String dummyHash;

    public AuthService(UserRepository users, UserProfileRepository profiles, UserSettingsRepository settings,
            RefreshTokenRepository refreshTokens, PasswordEncoder passwordEncoder, TokenService tokenService,
            LoginAttemptLimiter limiter, SecurityProperties props, Clock clock) {
        this.users = users;
        this.profiles = profiles;
        this.settings = settings;
        this.refreshTokens = refreshTokens;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.limiter = limiter;
        this.props = props;
        this.clock = clock;
        this.dummyHash = passwordEncoder.encode("dummy-password-for-timing");
    }

    @Transactional
    public TokenResponse register(RegisterRequest req) {
        String email = normalizeEmail(req.email());
        if (users.existsByEmail(email)) {
            throw ApiException.conflict("Esiste già un account con questa email");
        }
        User user = users.save(new User(email, passwordEncoder.encode(req.password()), req.displayName().trim(),
                clock.instant()));
        profiles.save(new UserProfile(user.getId()));
        settings.save(new UserSettings(user.getId()));
        user.setLastLoginAt(clock.instant());
        log.info("New user registered: {}", user.getId());
        return issueTokens(user);
    }

    /** No transaction rollback on bad credentials: failures must be counted. */
    @Transactional(noRollbackFor = ApiException.class)
    public TokenResponse login(LoginRequest req, String clientIp) {
        String email = normalizeEmail(req.email());
        limiter.check(email, clientIp);
        Optional<User> user = users.findByEmail(email);
        boolean ok;
        if (user.isPresent()) {
            ok = passwordEncoder.matches(req.password(), user.get().getPasswordHash());
        } else {
            passwordEncoder.matches(req.password(), dummyHash);
            ok = false;
        }
        if (!ok) {
            limiter.recordFailure(email, clientIp);
            throw ApiException.unauthorized(BAD_CREDENTIALS);
        }
        limiter.recordSuccess(email);
        User u = user.get();
        u.setLastLoginAt(clock.instant());
        return issueTokens(u);
    }

    /**
     * Rotation: the presented token is marked revoked and a new pair is returned. A token is only ever revoked by
     * rotation (logout and password change delete tokens instead), so presenting a revoked token means it was stolen
     * or replayed, and every session of that user is revoked.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public TokenResponse refresh(String rawRefreshToken) {
        Instant now = clock.instant();
        RefreshToken token = refreshTokens.findByTokenHash(TokenService.hash(rawRefreshToken))
                .orElseThrow(() -> ApiException.unauthorized(INVALID_REFRESH));
        if (token.getRevokedAt() != null) {
            log.warn("Refresh token reuse detected for user {}: revoking all sessions", token.getUserId());
            refreshTokens.revokeAllForUser(token.getUserId(), now);
            throw ApiException.unauthorized(INVALID_REFRESH);
        }
        if (!token.isActive(now)) {
            throw ApiException.unauthorized(INVALID_REFRESH);
        }
        token.revoke(now);
        User user = users.findById(token.getUserId()).orElseThrow(() -> ApiException.unauthorized(INVALID_REFRESH));
        return issueTokens(user);
    }

    @Transactional
    public void logout(String rawRefreshToken) {
        refreshTokens.findByTokenHash(TokenService.hash(rawRefreshToken)).ifPresent(refreshTokens::delete);
    }

    /** Ends every session and returns a fresh pair (used after a password change). */
    @Transactional(propagation = Propagation.MANDATORY)
    public TokenResponse endAllSessionsAndIssue(User user) {
        refreshTokens.deleteAllForUser(user.getId());
        return issueTokens(user);
    }

    @Transactional
    @Scheduled(cron = "0 17 3 * * *")
    public void purgeExpiredTokens() {
        int n = refreshTokens.deleteExpired(clock.instant());
        if (n > 0) {
            log.info("Purged {} expired refresh tokens", n);
        }
    }

    private TokenResponse issueTokens(User user) {
        String raw = tokenService.newRefreshToken();
        Instant now = clock.instant();
        refreshTokens.save(new RefreshToken(user.getId(), TokenService.hash(raw), now,
                now.plus(props.refreshTokenTtl())));
        return new TokenResponse(tokenService.accessToken(user), raw, props.accessTokenTtl().toSeconds());
    }

    /** Emails are stored lower-cased: the citext column is a second line of defence, not the only one. */
    public static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }
}
