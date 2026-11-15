package ch.zwiftfree.ride;

import ch.zwiftfree.ride.RideDtos.RideDetail;
import ch.zwiftfree.ride.RideDtos.RideSummary;
import ch.zwiftfree.ride.RideDtos.SamplesColumns;
import com.garmin.fit.Activity;
import com.garmin.fit.ActivityMesg;
import com.garmin.fit.BufferEncoder;
import com.garmin.fit.DateTime;
import com.garmin.fit.DeviceInfoMesg;
import com.garmin.fit.Event;
import com.garmin.fit.EventMesg;
import com.garmin.fit.EventType;
import com.garmin.fit.File;
import com.garmin.fit.FileIdMesg;
import com.garmin.fit.Fit;
import com.garmin.fit.LapMesg;
import com.garmin.fit.LapTrigger;
import com.garmin.fit.Manufacturer;
import com.garmin.fit.RecordMesg;
import com.garmin.fit.SessionMesg;
import com.garmin.fit.SessionTrigger;
import com.garmin.fit.Sport;
import com.garmin.fit.SubSport;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Exports a ride as GPX 1.1 (track with Garmin TrackPointExtension for heart rate and cadence, plus power) and as a
 * FIT activity (Garmin FIT SDK), for Strava, Garmin Connect, intervals.icu and the like. Timestamps are the ride
 * start plus the ride clock, so pauses are left out like on the trainer's head unit.
 */
@Service
public class ExportService {

    static final String CREATOR = "Zwiftfree";
    private static final double SEMICIRCLES_PER_DEGREE = Math.pow(2, 31) / 180.0;
    private static final ZoneId ZONE = ZoneId.of("Europe/Zurich");

    private final RideService rides;

    public ExportService(RideService rides) {
        this.rides = rides;
    }

    public record Export(String fileName, byte[] content) {
    }

    @Transactional(readOnly = true)
    public Export gpx(UUID userId, UUID rideId) {
        RideDetail detail = rides.get(userId, rideId);
        SamplesColumns s = rides.samples(userId, rideId);
        RideSummary r = detail.ride();
        String name = title(r);
        StringBuilder x = new StringBuilder(256 + s.t().length * 260);
        x.append(
                """
                        <?xml version="1.0" encoding="UTF-8"?>
                        <gpx version="1.1" creator="%s" xmlns="http://www.topografix.com/GPX/1/1"
                             xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
                             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                             xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www8.garmin.com/xmlschemas/TrackPointExtensionv1.xsd">
                          <metadata>
                            <name>%s</name>
                            <time>%s</time>
                          </metadata>
                          <trk>
                            <name>%s</name>
                            <type>VirtualRide</type>
                            <trkseg>
                        """
                        .formatted(CREATOR, xml(name), r.startedAt().truncatedTo(ChronoUnit.SECONDS), xml(name)));
        for (int i = 0; i < s.t().length; i++) {
            Double lat = s.lat()[i];
            Double lon = s.lon()[i];
            if (lat == null || lon == null) {
                continue;
            }
            x.append("      <trkpt lat=\"")
                    .append(String.format(Locale.ROOT, "%.6f", lat))
                    .append("\" lon=\"")
                    .append(String.format(Locale.ROOT, "%.6f", lon))
                    .append("\">");
            if (s.ele()[i] != null) {
                x.append("<ele>").append(String.format(Locale.ROOT, "%.1f", s.ele()[i])).append("</ele>");
            }
            x.append("<time>").append(at(r, s.t()[i])).append("</time>");
            Integer hr = positive(s.hr()[i]);
            Integer cad = s.cadence()[i];
            Integer power = s.power()[i];
            if (hr != null || cad != null || power != null) {
                x.append("<extensions>");
                if (power != null) {
                    x.append("<power>").append(power).append("</power>");
                }
                if (hr != null || cad != null) {
                    x.append("<gpxtpx:TrackPointExtension>");
                    if (hr != null) {
                        x.append("<gpxtpx:hr>").append(hr).append("</gpxtpx:hr>");
                    }
                    if (cad != null) {
                        x.append("<gpxtpx:cad>").append(cad).append("</gpxtpx:cad>");
                    }
                    x.append("</gpxtpx:TrackPointExtension>");
                }
                x.append("</extensions>");
            }
            x.append("</trkpt>\n");
        }
        x.append("""
                    </trkseg>
                  </trk>
                </gpx>
                """);
        return new Export(fileName(r, "gpx"), x.toString().getBytes(StandardCharsets.UTF_8));
    }

    @Transactional(readOnly = true)
    public Export fit(UUID userId, UUID rideId) {
        RideSummary r = rides.get(userId, rideId).ride();
        SamplesColumns s = rides.samples(userId, rideId);
        int n = s.t().length;
        DateTime start = new DateTime(r.startedAt().truncatedTo(ChronoUnit.SECONDS));
        int lastT = n == 0 ? 0 : s.t()[n - 1];
        DateTime end = at(start, lastT);
        float elapsed = r.elapsedTimeS() != null ? r.elapsedTimeS() : lastT + 1;
        float moving = r.movingTimeS() != null ? r.movingTimeS() : elapsed;
        float distance = r.distanceM() != null ? r.distanceM().floatValue() : n == 0 ? 0 : (float) s.distanceM()[n - 1];

        BufferEncoder enc = new BufferEncoder(Fit.ProtocolVersion.V2_0);

        FileIdMesg fileId = new FileIdMesg();
        fileId.setType(File.ACTIVITY);
        fileId.setManufacturer(Manufacturer.DEVELOPMENT);
        fileId.setProduct(1);
        fileId.setSerialNumber(serial(rideId));
        fileId.setTimeCreated(start);
        enc.write(fileId);

        DeviceInfoMesg device = new DeviceInfoMesg();
        device.setDeviceIndex((short) 0);
        device.setManufacturer(Manufacturer.DEVELOPMENT);
        device.setProduct(1);
        device.setProductName(CREATOR);
        device.setTimestamp(start);
        enc.write(device);

        EventMesg startEvent = new EventMesg();
        startEvent.setTimestamp(start);
        startEvent.setEvent(Event.TIMER);
        startEvent.setEventType(EventType.START);
        enc.write(startEvent);

        Integer firstLat = null, firstLon = null;
        for (int i = 0; i < n; i++) {
            RecordMesg rec = new RecordMesg();
            rec.setTimestamp(at(start, s.t()[i]));
            if (s.lat()[i] != null && s.lon()[i] != null) {
                int lat = semicircles(s.lat()[i]);
                int lon = semicircles(s.lon()[i]);
                rec.setPositionLat(lat);
                rec.setPositionLong(lon);
                if (firstLat == null) {
                    firstLat = lat;
                    firstLon = lon;
                }
            }
            if (s.ele()[i] != null) {
                rec.setEnhancedAltitude(s.ele()[i].floatValue());
            }
            rec.setDistance((float) s.distanceM()[i]);
            if (s.speedKmh()[i] != null) {
                rec.setEnhancedSpeed((float) (s.speedKmh()[i] / 3.6));
            }
            if (s.grade()[i] != null) {
                rec.setGrade(s.grade()[i].floatValue());
            }
            if (s.power()[i] != null) {
                rec.setPower(s.power()[i]);
            }
            Integer hr = positive(s.hr()[i]);
            if (hr != null) {
                rec.setHeartRate(hr.shortValue());
            }
            if (s.cadence()[i] != null) {
                rec.setCadence((short) Math.min(254, s.cadence()[i]));
            }
            enc.write(rec);
        }

        EventMesg stopEvent = new EventMesg();
        stopEvent.setTimestamp(end);
        stopEvent.setEvent(Event.TIMER);
        stopEvent.setEventType(EventType.STOP_ALL);
        enc.write(stopEvent);

        LapMesg lap = new LapMesg();
        lap.setMessageIndex(0);
        lap.setTimestamp(end);
        lap.setStartTime(start);
        lap.setEvent(Event.LAP);
        lap.setEventType(EventType.STOP);
        lap.setLapTrigger(LapTrigger.SESSION_END);
        lap.setSport(Sport.CYCLING);
        lap.setSubSport(SubSport.VIRTUAL_ACTIVITY);
        lap.setTotalElapsedTime(elapsed);
        lap.setTotalTimerTime(elapsed);
        lap.setTotalDistance(distance);
        if (firstLat != null) {
            lap.setStartPositionLat(firstLat);
            lap.setStartPositionLong(firstLon);
        }
        setTotals(lap, r);
        enc.write(lap);

        SessionMesg session = new SessionMesg();
        session.setMessageIndex(0);
        session.setTimestamp(end);
        session.setStartTime(start);
        session.setEvent(Event.SESSION);
        session.setEventType(EventType.STOP);
        session.setTrigger(SessionTrigger.ACTIVITY_END);
        session.setSport(Sport.CYCLING);
        session.setSubSport(SubSport.VIRTUAL_ACTIVITY);
        session.setFirstLapIndex(0);
        session.setNumLaps(1);
        session.setTotalElapsedTime(elapsed);
        session.setTotalTimerTime(elapsed);
        session.setTotalMovingTime(moving);
        session.setTotalDistance(distance);
        if (firstLat != null) {
            session.setStartPositionLat(firstLat);
            session.setStartPositionLong(firstLon);
        }
        if (r.normalizedPower() != null) {
            session.setNormalizedPower(r.normalizedPower());
        }
        if (r.tss() != null) {
            session.setTrainingStressScore(r.tss().floatValue());
        }
        if (r.intensityFactor() != null) {
            session.setIntensityFactor(r.intensityFactor().floatValue());
            if (r.normalizedPower() != null && r.intensityFactor() > 0) {
                session.setThresholdPower((int) Math.round(r.normalizedPower() / r.intensityFactor()));
            }
        }
        if (r.kj() != null) {
            session.setTotalWork(Math.round(r.kj() * 1000));
        }
        setTotals(session, r);
        enc.write(session);

        ActivityMesg activity = new ActivityMesg();
        activity.setTimestamp(end);
        activity.setTotalTimerTime(elapsed);
        activity.setNumSessions(1);
        activity.setType(Activity.MANUAL);
        activity.setEvent(Event.ACTIVITY);
        activity.setEventType(EventType.STOP);
        long offset = ZONE.getRules().getOffset(r.startedAt()).getTotalSeconds();
        activity.setLocalTimestamp(end.getTimestamp() + offset);
        enc.write(activity);

        return new Export(fileName(r, "fit"), enc.close());
    }

    /** Fields shared by lap and session (same names in both messages). */
    private static void setTotals(LapMesg m, RideSummary r) {
        if (r.avgPower() != null) {
            m.setAvgPower(r.avgPower());
        }
        if (r.maxPower() != null) {
            m.setMaxPower(r.maxPower());
        }
        if (r.avgHr() != null) {
            m.setAvgHeartRate(r.avgHr().shortValue());
        }
        if (r.maxHr() != null) {
            m.setMaxHeartRate(r.maxHr().shortValue());
        }
        if (r.avgCadence() != null) {
            m.setAvgCadence(r.avgCadence().shortValue());
        }
        if (r.ascentM() != null) {
            m.setTotalAscent((int) Math.round(r.ascentM()));
        }
        if (r.kj() != null) {
            // Cycling: about 1 kcal burned per kJ of work (≈ 24 % efficiency).
            m.setTotalCalories((int) Math.round(r.kj()));
        }
        if (r.avgSpeedKmh() != null) {
            m.setEnhancedAvgSpeed((float) (r.avgSpeedKmh() / 3.6));
        }
    }

    private static void setTotals(SessionMesg m, RideSummary r) {
        if (r.avgPower() != null) {
            m.setAvgPower(r.avgPower());
        }
        if (r.maxPower() != null) {
            m.setMaxPower(r.maxPower());
        }
        if (r.avgHr() != null) {
            m.setAvgHeartRate(r.avgHr().shortValue());
        }
        if (r.maxHr() != null) {
            m.setMaxHeartRate(r.maxHr().shortValue());
        }
        if (r.avgCadence() != null) {
            m.setAvgCadence(r.avgCadence().shortValue());
        }
        if (r.ascentM() != null) {
            m.setTotalAscent((int) Math.round(r.ascentM()));
        }
        if (r.kj() != null) {
            m.setTotalCalories((int) Math.round(r.kj()));
        }
        if (r.avgSpeedKmh() != null) {
            m.setEnhancedAvgSpeed((float) (r.avgSpeedKmh() / 3.6));
        }
    }

    static int semicircles(double degrees) {
        return (int) Math.round(degrees * SEMICIRCLES_PER_DEGREE);
    }

    private static DateTime at(DateTime start, int t) {
        DateTime d = new DateTime(start);
        d.add(t);
        return d;
    }

    private static String at(RideSummary r, int t) {
        return r.startedAt().truncatedTo(ChronoUnit.SECONDS).plusSeconds(t).toString();
    }

    private static Integer positive(Integer v) {
        return v == null || v <= 0 ? null : v;
    }

    /** A stable 32-bit serial number per ride (FIT readers use it with the time to tell files apart). */
    private static long serial(UUID rideId) {
        return (rideId.getMostSignificantBits() ^ rideId.getLeastSignificantBits()) & 0xFFFF_FFFFL;
    }

    static String title(RideSummary r) {
        return r.routeName() != null ? "Zwiftfree · " + r.routeName() : "Zwiftfree · Giro libero";
    }

    /** {@code zwiftfree-2026-11-15-cadenazzo-monte-ceneri.fit} */
    static String fileName(RideSummary r, String ext) {
        String day = DateTimeFormatter.ISO_LOCAL_DATE.format(r.startedAt().atZone(ZONE));
        String what = r.routeName() == null ? "giro-libero" : slug(r.routeName());
        return "zwiftfree-" + day + "-" + what + "." + ext;
    }

    static String slug(String s) {
        String ascii = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        String out = ascii.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        return out.isEmpty() ? "uscita" : out;
    }

    private static String xml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
