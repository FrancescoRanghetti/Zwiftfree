package ch.zwiftfree.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "user_settings")
public class UserSettings {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "pee_break_enabled", nullable = false)
    private boolean peeBreakEnabled = true;

    @Column(name = "pee_break_after_seconds", nullable = false)
    private int peeBreakAfterSeconds = 20;

    @Column(name = "crash_events_enabled", nullable = false)
    private boolean crashEventsEnabled = true;

    @Column(name = "trainer_difficulty", nullable = false, precision = 3, scale = 2)
    private BigDecimal trainerDifficulty = new BigDecimal("1.00");

    @Column(name = "audio_enabled", nullable = false)
    private boolean audioEnabled = true;

    @Column(name = "corner_assist_enabled", nullable = false)
    private boolean cornerAssistEnabled = false;

    protected UserSettings() {
    }

    public UserSettings(UUID userId) {
        this.userId = userId;
    }

    public UUID getUserId() {
        return userId;
    }

    public boolean isPeeBreakEnabled() {
        return peeBreakEnabled;
    }

    public void setPeeBreakEnabled(boolean peeBreakEnabled) {
        this.peeBreakEnabled = peeBreakEnabled;
    }

    public int getPeeBreakAfterSeconds() {
        return peeBreakAfterSeconds;
    }

    public void setPeeBreakAfterSeconds(int peeBreakAfterSeconds) {
        this.peeBreakAfterSeconds = peeBreakAfterSeconds;
    }

    public boolean isCrashEventsEnabled() {
        return crashEventsEnabled;
    }

    public void setCrashEventsEnabled(boolean crashEventsEnabled) {
        this.crashEventsEnabled = crashEventsEnabled;
    }

    public BigDecimal getTrainerDifficulty() {
        return trainerDifficulty;
    }

    public void setTrainerDifficulty(BigDecimal trainerDifficulty) {
        this.trainerDifficulty = trainerDifficulty;
    }

    public boolean isAudioEnabled() {
        return audioEnabled;
    }

    public void setAudioEnabled(boolean audioEnabled) {
        this.audioEnabled = audioEnabled;
    }

    public boolean isCornerAssistEnabled() {
        return cornerAssistEnabled;
    }

    public void setCornerAssistEnabled(boolean cornerAssistEnabled) {
        this.cornerAssistEnabled = cornerAssistEnabled;
    }
}
