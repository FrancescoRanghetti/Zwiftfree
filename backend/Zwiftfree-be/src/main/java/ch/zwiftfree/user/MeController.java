package ch.zwiftfree.user;

import ch.zwiftfree.auth.AuthDtos.TokenResponse;
import ch.zwiftfree.common.security.CurrentUser;
import ch.zwiftfree.user.MeDtos.DeleteAccount;
import ch.zwiftfree.user.MeDtos.MeResponse;
import ch.zwiftfree.user.MeDtos.PasswordChange;
import ch.zwiftfree.user.MeDtos.ProfileUpdate;
import ch.zwiftfree.user.MeDtos.SettingsUpdate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me")
@Tag(name = "me")
@SecurityRequirement(name = "bearer")
public class MeController {

    private final MeService me;

    public MeController(MeService me) {
        this.me = me;
    }

    @GetMapping
    @Operation(summary = "Current user with profile and settings")
    public MeResponse get(@AuthenticationPrincipal Jwt jwt) {
        return me.get(CurrentUser.id(jwt));
    }

    @PutMapping("/profile")
    public MeResponse updateProfile(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ProfileUpdate req) {
        return me.updateProfile(CurrentUser.id(jwt), req);
    }

    @PutMapping("/settings")
    public MeResponse updateSettings(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SettingsUpdate req) {
        return me.updateSettings(CurrentUser.id(jwt), req);
    }

    @PutMapping("/password")
    @Operation(summary = "Change password; revokes every other session and returns a new token pair")
    public TokenResponse changePassword(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PasswordChange req) {
        return me.changePassword(CurrentUser.id(jwt), req);
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete the account and all its data (password confirmation required)")
    public void delete(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody DeleteAccount req) {
        me.delete(CurrentUser.id(jwt), req.password());
    }
}
