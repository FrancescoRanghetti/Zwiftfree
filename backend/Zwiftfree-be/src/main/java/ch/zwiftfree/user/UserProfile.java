package ch.zwiftfree.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "user_profiles")
public class UserProfile {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "weight_kg", nullable = false, precision = 5, scale = 2)
    private BigDecimal weightKg = new BigDecimal("75.00");

    @Column(name = "height_cm")
    private Integer heightCm;

    @Column(name = "birth_year")
    private Integer birthYear;

    @Column(name = "ftp_watts", nullable = false)
    private Integer ftpWatts = 200;

    @Column(name = "max_hr")
    private Integer maxHr;

    @Column(name = "resting_hr")
    private Integer restingHr;

    @Column(name = "bike_weight_kg", nullable = false, precision = 4, scale = 2)
    private BigDecimal bikeWeightKg = new BigDecimal("8.00");

    @Column(nullable = false, precision = 4, scale = 3)
    private BigDecimal cda = new BigDecimal("0.320");

    @Column(nullable = false, precision = 5, scale = 4)
    private BigDecimal crr = new BigDecimal("0.0040");

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "avatar_config", columnDefinition = "jsonb")
    private Map<String, Object> avatarConfig;

    @Column(nullable = false)
    private String units = "metric";

    protected UserProfile() {
    }

    public UserProfile(UUID userId) {
        this.userId = userId;
    }

    public UUID getUserId() {
        return userId;
    }

    public BigDecimal getWeightKg() {
        return weightKg;
    }

    public void setWeightKg(BigDecimal weightKg) {
        this.weightKg = weightKg;
    }

    public Integer getHeightCm() {
        return heightCm;
    }

    public void setHeightCm(Integer heightCm) {
        this.heightCm = heightCm;
    }

    public Integer getBirthYear() {
        return birthYear;
    }

    public void setBirthYear(Integer birthYear) {
        this.birthYear = birthYear;
    }

    public Integer getFtpWatts() {
        return ftpWatts;
    }

    public void setFtpWatts(Integer ftpWatts) {
        this.ftpWatts = ftpWatts;
    }

    public Integer getMaxHr() {
        return maxHr;
    }

    public void setMaxHr(Integer maxHr) {
        this.maxHr = maxHr;
    }

    public Integer getRestingHr() {
        return restingHr;
    }

    public void setRestingHr(Integer restingHr) {
        this.restingHr = restingHr;
    }

    public BigDecimal getBikeWeightKg() {
        return bikeWeightKg;
    }

    public void setBikeWeightKg(BigDecimal bikeWeightKg) {
        this.bikeWeightKg = bikeWeightKg;
    }

    public BigDecimal getCda() {
        return cda;
    }

    public void setCda(BigDecimal cda) {
        this.cda = cda;
    }

    public BigDecimal getCrr() {
        return crr;
    }

    public void setCrr(BigDecimal crr) {
        this.crr = crr;
    }

    public Map<String, Object> getAvatarConfig() {
        return avatarConfig;
    }

    public void setAvatarConfig(Map<String, Object> avatarConfig) {
        this.avatarConfig = avatarConfig;
    }

    public String getUnits() {
        return units;
    }

    public void setUnits(String units) {
        this.units = units;
    }
}
