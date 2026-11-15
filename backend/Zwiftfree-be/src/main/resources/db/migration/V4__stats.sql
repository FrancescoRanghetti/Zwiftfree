-- Milestone 7: statistics.

-- Where along the ride (metres of ride distance) each edge was entered: needed to time segments.
ALTER TABLE ride_edges ADD COLUMN start_m numeric;

-- Best average power (W) of the ride for each duration in RideMetrics.CURVE_DURATIONS_S (NULL = ride too short).
ALTER TABLE rides ADD COLUMN power_curve int[];

-- Personal records set by this ride when it was completed: [{metric, value, previous}].
ALTER TABLE rides ADD COLUMN records jsonb;

CREATE INDEX rides_user_status_started_idx ON rides (user_id, status, started_at);
CREATE INDEX segment_efforts_ride_idx ON segment_efforts (ride_id);
