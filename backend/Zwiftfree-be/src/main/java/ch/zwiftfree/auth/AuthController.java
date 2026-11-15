package ch.zwiftfree.auth;

import ch.zwiftfree.auth.AuthDtos.LoginRequest;
import ch.zwiftfree.auth.AuthDtos.RefreshRequest;
import ch.zwiftfree.auth.AuthDtos.RegisterRequest;
import ch.zwiftfree.auth.AuthDtos.TokenResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@Tag(name = "auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create an account and log in")
    public TokenResponse register(@Valid @RequestBody RegisterRequest req) {
        return auth.register(req);
    }

    @PostMapping("/login")
    @Operation(summary = "Exchange email and password for an access + refresh token pair")
    public TokenResponse login(@Valid @RequestBody LoginRequest req, HttpServletRequest http) {
        // X-Forwarded-For is resolved by server.forward-headers-strategy=framework (nginx sets it).
        return auth.login(req, http.getRemoteAddr());
    }

    @PostMapping("/refresh")
    @Operation(summary = "Rotate the refresh token and get a new access token")
    public TokenResponse refresh(@Valid @RequestBody RefreshRequest req) {
        return auth.refresh(req.refreshToken());
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Revoke a refresh token")
    public void logout(@Valid @RequestBody RefreshRequest req) {
        auth.logout(req.refreshToken());
    }
}
