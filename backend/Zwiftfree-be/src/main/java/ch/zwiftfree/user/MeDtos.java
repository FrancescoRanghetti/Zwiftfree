package ch.zwiftfree.user;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public final class MeDtos {

    private MeDtos() {
    }

    private static final String HEX = "^#[0-9a-fA-F]{6}$";
    private static final String HEX_MSG = "Colore non valido (formato #rrggbb)";

    public record AvatarConfig(
            @NotNull @Pattern(regexp = HEX, message = HEX_MSG) String jerseyColor,
            @NotNull @Pattern(regexp = HEX, message = HEX_MSG) String helmetColor,
            @NotNull @Pattern(regexp = HEX, message = HEX_MSG) String bikeColor) {

        public static final AvatarConfig DEFAULT = new AvatarConfig("#ff9800", "#fafafa", "#263238");
    }

    public record ProfileDto(
            BigDecimal weightKg,
            Integer heightCm,
            Integer birthYear,
            Integer ftpWatts,
            Integer maxHr,
            Integer restingHr,
            BigDecimal bikeWeightKg,
            BigDecimal cda,
            BigDecimal crr,
            String units,
            AvatarConfig avatar) {
    }

    public record SettingsDto(
            boolean peeBreakEnabled,
            int peeBreakAfterSeconds,
            boolean crashEventsEnabled,
            BigDecimal trainerDifficulty,
            boolean audioEnabled,
            boolean cornerAssistEnabled) {
    }

    public record MeResponse(
            UUID id,
            String email,
            String displayName,
            Instant createdAt,
            ProfileDto profile,
            SettingsDto settings) {
    }

    public record ProfileUpdate(
            @NotBlank(message = "Il nome è obbligatorio") @Size(max = 60, message = "Il nome può avere al massimo 60 caratteri") String displayName,
            @NotNull(message = "Il peso è obbligatorio") @DecimalMin(value = "30", message = "Peso minimo 30 kg") @DecimalMax(value = "250", message = "Peso massimo 250 kg") BigDecimal weightKg,
            @Min(value = 100, message = "Altezza minima 100 cm") @Max(value = 250, message = "Altezza massima 250 cm") Integer heightCm,
            @Min(value = 1900, message = "Anno non valido") @Max(value = 2100, message = "Anno non valido") Integer birthYear,
            @NotNull(message = "L'FTP è obbligatoria") @Min(value = 50, message = "FTP minima 50 W") @Max(value = 600, message = "FTP massima 600 W") Integer ftpWatts,
            @Min(value = 100, message = "FC max minima 100") @Max(value = 240, message = "FC max massima 240") Integer maxHr,
            @Min(value = 25, message = "FC a riposo minima 25") @Max(value = 120, message = "FC a riposo massima 120") Integer restingHr,
            @NotNull(message = "Il peso della bici è obbligatorio") @DecimalMin(value = "3", message = "Peso bici minimo 3 kg") @DecimalMax(value = "30", message = "Peso bici massimo 30 kg") BigDecimal bikeWeightKg,
            @DecimalMin(value = "0.15", message = "CdA minimo 0.15") @DecimalMax(value = "0.6", message = "CdA massimo 0.6") BigDecimal cda,
            @DecimalMin(value = "0.001", message = "Crr minimo 0.001") @DecimalMax(value = "0.02", message = "Crr massimo 0.02") BigDecimal crr,
            @Pattern(regexp = "metric|imperial", message = "Unità non valide") String units,
            @Valid AvatarConfig avatar) {
    }

    public record SettingsUpdate(
            boolean peeBreakEnabled,
            @Min(value = 5, message = "Minimo 5 secondi") @Max(value = 600, message = "Massimo 600 secondi") int peeBreakAfterSeconds,
            boolean crashEventsEnabled,
            @NotNull @DecimalMin(value = "0", message = "Difficoltà tra 0 e 1") @DecimalMax(value = "1", message = "Difficoltà tra 0 e 1") BigDecimal trainerDifficulty,
            boolean audioEnabled,
            boolean cornerAssistEnabled) {
    }

    public record PasswordChange(
            @NotBlank(message = "Inserisci la password attuale") String currentPassword,
            @NotBlank(message = "Inserisci la nuova password") @Size(min = 10, max = 128, message = "La password deve avere tra 10 e 128 caratteri") String newPassword) {
    }

    public record DeleteAccount(@NotBlank(message = "Inserisci la password per confermare") String password) {
    }
}
