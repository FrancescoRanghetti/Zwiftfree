package ch.zwiftfree.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record RegisterRequest(
            @NotBlank(message = "L'email è obbligatoria") @Email(message = "Email non valida") @Size(max = 254, message = "Email troppo lunga") String email,
            @NotBlank(message = "La password è obbligatoria") @Size(min = 10, max = 128, message = "La password deve avere tra 10 e 128 caratteri") String password,
            @NotBlank(message = "Il nome è obbligatorio") @Size(max = 60, message = "Il nome può avere al massimo 60 caratteri") String displayName) {
    }

    public record LoginRequest(
            @NotBlank(message = "L'email è obbligatoria") String email,
            @NotBlank(message = "La password è obbligatoria") String password) {
    }

    public record RefreshRequest(@NotBlank(message = "Refresh token mancante") String refreshToken) {
    }

    /** @param expiresIn access token lifetime in seconds */
    public record TokenResponse(String accessToken, String refreshToken, long expiresIn) {
    }
}
