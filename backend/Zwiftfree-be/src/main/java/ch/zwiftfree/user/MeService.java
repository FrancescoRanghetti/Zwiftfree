package ch.zwiftfree.user;

import ch.zwiftfree.auth.AuthDtos.TokenResponse;
import ch.zwiftfree.auth.AuthService;
import ch.zwiftfree.common.web.ApiException;
import ch.zwiftfree.common.web.NotFoundException;
import ch.zwiftfree.user.MeDtos.AvatarConfig;
import ch.zwiftfree.user.MeDtos.MeResponse;
import ch.zwiftfree.user.MeDtos.PasswordChange;
import ch.zwiftfree.user.MeDtos.ProfileDto;
import ch.zwiftfree.user.MeDtos.ProfileUpdate;
import ch.zwiftfree.user.MeDtos.SettingsDto;
import ch.zwiftfree.user.MeDtos.SettingsUpdate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MeService {

    private static final Logger log = LoggerFactory.getLogger(MeService.class);

    private final UserRepository users;
    private final UserProfileRepository profiles;
    private final UserSettingsRepository settings;
    private final PasswordEncoder passwordEncoder;
    private final AuthService authService;

    public MeService(UserRepository users, UserProfileRepository profiles, UserSettingsRepository settings,
            PasswordEncoder passwordEncoder, AuthService authService) {
        this.users = users;
        this.profiles = profiles;
        this.settings = settings;
        this.passwordEncoder = passwordEncoder;
        this.authService = authService;
    }

    @Transactional(readOnly = true)
    public MeResponse get(UUID userId) {
        return toResponse(user(userId), profile(userId), settings(userId));
    }

    @Transactional
    public MeResponse updateProfile(UUID userId, ProfileUpdate req) {
        User u = user(userId);
        UserProfile p = profile(userId);
        u.setDisplayName(req.displayName().trim());
        p.setWeightKg(req.weightKg());
        p.setHeightCm(req.heightCm());
        p.setBirthYear(req.birthYear());
        p.setFtpWatts(req.ftpWatts());
        p.setMaxHr(req.maxHr());
        p.setRestingHr(req.restingHr());
        p.setBikeWeightKg(req.bikeWeightKg());
        if (req.cda() != null)
            p.setCda(req.cda());
        if (req.crr() != null)
            p.setCrr(req.crr());
        if (req.units() != null)
            p.setUnits(req.units());
        if (req.avatar() != null)
            p.setAvatarConfig(toMap(req.avatar()));
        return toResponse(u, p, settings(userId));
    }

    @Transactional
    public MeResponse updateSettings(UUID userId, SettingsUpdate req) {
        UserSettings s = settings(userId);
        s.setPeeBreakEnabled(req.peeBreakEnabled());
        s.setPeeBreakAfterSeconds(req.peeBreakAfterSeconds());
        s.setCrashEventsEnabled(req.crashEventsEnabled());
        s.setTrainerDifficulty(req.trainerDifficulty());
        s.setAudioEnabled(req.audioEnabled());
        s.setCornerAssistEnabled(req.cornerAssistEnabled());
        return toResponse(user(userId), profile(userId), s);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public TokenResponse changePassword(UUID userId, PasswordChange req) {
        User u = user(userId);
        if (!passwordEncoder.matches(req.currentPassword(), u.getPasswordHash())) {
            throw ApiException.badRequest("La password attuale non è corretta");
        }
        u.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        return authService.endAllSessionsAndIssue(u);
    }

    /** Deletes the user; every owned row goes with it through ON DELETE CASCADE. */
    @Transactional
    public void delete(UUID userId, String password) {
        User u = user(userId);
        if (!passwordEncoder.matches(password, u.getPasswordHash())) {
            throw ApiException.badRequest("Password non corretta");
        }
        users.delete(u);
        log.info("User {} deleted their account", userId);
    }

    private User user(UUID id) {
        return users.findById(id).orElseThrow(() -> new NotFoundException("Utente non trovato"));
    }

    private UserProfile profile(UUID id) {
        return profiles.findById(id).orElseGet(() -> profiles.save(new UserProfile(id)));
    }

    private UserSettings settings(UUID id) {
        return settings.findById(id).orElseGet(() -> settings.save(new UserSettings(id)));
    }

    private static MeResponse toResponse(User u, UserProfile p, UserSettings s) {
        return new MeResponse(u.getId(), u.getEmail(), u.getDisplayName(), u.getCreatedAt(),
                new ProfileDto(p.getWeightKg(), p.getHeightCm(), p.getBirthYear(), p.getFtpWatts(), p.getMaxHr(),
                        p.getRestingHr(), p.getBikeWeightKg(), p.getCda(), p.getCrr(), p.getUnits(),
                        fromMap(p.getAvatarConfig())),
                new SettingsDto(s.isPeeBreakEnabled(), s.getPeeBreakAfterSeconds(), s.isCrashEventsEnabled(),
                        s.getTrainerDifficulty(), s.isAudioEnabled(), s.isCornerAssistEnabled()));
    }

    private static Map<String, Object> toMap(AvatarConfig a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jerseyColor", a.jerseyColor());
        m.put("helmetColor", a.helmetColor());
        m.put("bikeColor", a.bikeColor());
        return m;
    }

    private static AvatarConfig fromMap(Map<String, Object> m) {
        if (m == null) {
            return AvatarConfig.DEFAULT;
        }
        AvatarConfig d = AvatarConfig.DEFAULT;
        return new AvatarConfig(str(m, "jerseyColor", d.jerseyColor()), str(m, "helmetColor", d.helmetColor()),
                str(m, "bikeColor", d.bikeColor()));
    }

    private static String str(Map<String, Object> m, String key, String fallback) {
        return m.get(key) instanceof String s ? s : fallback;
    }
}
