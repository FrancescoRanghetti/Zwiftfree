-- Zwiftfree core schema.
-- road_nodes / road_edges are NOT managed by Flyway: they are (re)created by the road import job
-- from data/out/load_postgis.sql. Columns referring to edges (edge_ids, edge_id) therefore carry no FK.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email          citext      NOT NULL UNIQUE,
    password_hash  text        NOT NULL,
    display_name   text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_login_at  timestamptz
);

CREATE TABLE user_profiles (
    user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    weight_kg      numeric(5, 2) NOT NULL DEFAULT 75 CHECK (weight_kg BETWEEN 30 AND 250),
    height_cm      int CHECK (height_cm BETWEEN 100 AND 250),
    birth_year     int CHECK (birth_year BETWEEN 1900 AND 2100),
    ftp_watts      int          NOT NULL DEFAULT 200 CHECK (ftp_watts BETWEEN 50 AND 600),
    max_hr         int CHECK (max_hr BETWEEN 100 AND 240),
    resting_hr     int CHECK (resting_hr BETWEEN 25 AND 120),
    bike_weight_kg numeric(4, 2) NOT NULL DEFAULT 8.0 CHECK (bike_weight_kg BETWEEN 3 AND 30),
    cda            numeric(4, 3) NOT NULL DEFAULT 0.32,
    crr            numeric(5, 4) NOT NULL DEFAULT 0.004,
    avatar_config  jsonb,
    units          text          NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial'))
);

CREATE TABLE user_settings (
    user_id                  uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    pee_break_enabled        boolean       NOT NULL DEFAULT true,
    pee_break_after_seconds  int           NOT NULL DEFAULT 20 CHECK (pee_break_after_seconds BETWEEN 5 AND 600),
    crash_events_enabled     boolean       NOT NULL DEFAULT true,
    trainer_difficulty       numeric(3, 2) NOT NULL DEFAULT 1.0 CHECK (trainer_difficulty BETWEEN 0 AND 1),
    audio_enabled            boolean       NOT NULL DEFAULT true,
    corner_assist_enabled    boolean       NOT NULL DEFAULT false
);

CREATE TABLE refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  text        NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- ---------------------------------------------------------------- routes & segments
CREATE TABLE routes (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid REFERENCES users (id) ON DELETE CASCADE,   -- NULL = official route
    slug             text UNIQUE,
    name             text      NOT NULL,
    description      text,
    is_public        boolean   NOT NULL DEFAULT false,
    edge_ids         bigint[]  NOT NULL,
    edge_directions  smallint[] NOT NULL,
    geom             geometry(LineStringZ, 4326),
    length_m         numeric,
    ascent_m         numeric,
    descent_m        numeric,
    min_ele          numeric,
    max_ele          numeric,
    max_grade        numeric,
    is_loop          boolean   NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (cardinality(edge_ids) = cardinality(edge_directions))
);
CREATE INDEX routes_owner_idx ON routes (owner_id);
CREATE INDEX routes_geom_idx ON routes USING gist (geom);

CREATE TABLE segments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text       NOT NULL,
    type             text       NOT NULL CHECK (type IN ('CLIMB', 'SPRINT')),
    edge_ids         bigint[]   NOT NULL,
    edge_directions  smallint[] NOT NULL,
    geom             geometry(LineStringZ, 4326),
    length_m         numeric,
    avg_grade        numeric,
    CHECK (cardinality(edge_ids) = cardinality(edge_directions))
);
CREATE INDEX segments_geom_idx ON segments USING gist (geom);

-- ---------------------------------------------------------------- rides
CREATE TABLE rides (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    route_id          uuid REFERENCES routes (id) ON DELETE SET NULL,
    started_at        timestamptz NOT NULL DEFAULT now(),
    ended_at          timestamptz,
    status            text        NOT NULL DEFAULT 'IN_PROGRESS'
                          CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
    mode              text        NOT NULL CHECK (mode IN ('TRAINER', 'SIMULATOR')),
    distance_m        numeric,
    moving_time_s     int,
    elapsed_time_s    int,
    ascent_m          numeric,
    avg_power         int,
    max_power         int,
    normalized_power  int,
    avg_hr            int,
    max_hr            int,
    avg_cadence       int,
    avg_speed_kmh     numeric,
    kj                numeric,
    tss               numeric,
    intensity_factor  numeric,
    pee_breaks        int NOT NULL DEFAULT 0,
    crashes           int NOT NULL DEFAULT 0,
    fit_file          bytea
);
CREATE INDEX rides_user_started_idx ON rides (user_id, started_at DESC);
CREATE INDEX rides_route_idx ON rides (route_id);

CREATE TABLE ride_samples (
    ride_id        uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
    t_s            int  NOT NULL,
    distance_m     numeric,
    lat            double precision,
    lon            double precision,
    ele            numeric,
    grade          numeric,
    power          int,
    cadence        int,
    hr             int,
    speed_kmh      numeric,
    avatar_state   text,
    edge_id        bigint,
    edge_offset_m  numeric,
    PRIMARY KEY (ride_id, t_s)
);

CREATE TABLE ride_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id     uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
    t_s         int  NOT NULL,
    type        text NOT NULL CHECK (type IN ('PEE_BREAK_START', 'PEE_BREAK_END', 'CRASH', 'RECOVERED',
                                              'SEGMENT_DONE', 'PAUSE', 'RESUME')),
    distance_m  numeric,
    payload     jsonb
);
CREATE INDEX ride_events_ride_idx ON ride_events (ride_id);

CREATE TABLE segment_efforts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id     uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
    segment_id  uuid NOT NULL REFERENCES segments (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    elapsed_s   int  NOT NULL,
    avg_power   int,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX segment_efforts_segment_idx ON segment_efforts (segment_id, elapsed_s);
CREATE INDEX segment_efforts_user_idx ON segment_efforts (user_id, segment_id);

CREATE TABLE ride_edges (
    ride_id    uuid     NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
    seq        int      NOT NULL,
    edge_id    bigint   NOT NULL,
    direction  smallint NOT NULL CHECK (direction IN (-1, 1)),
    PRIMARY KEY (ride_id, seq)
);

CREATE TABLE user_explored_edges (
    user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    edge_id          bigint      NOT NULL,
    first_ridden_at  timestamptz NOT NULL DEFAULT now(),
    times            int         NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, edge_id)
);

CREATE TABLE personal_records (
    user_id      uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    metric       text    NOT NULL,   -- BEST_5S | BEST_1MIN | ... | segment:<uuid>
    value        numeric NOT NULL,
    ride_id      uuid REFERENCES rides (id) ON DELETE SET NULL,
    achieved_at  timestamptz NOT NULL,
    PRIMARY KEY (user_id, metric)
);
