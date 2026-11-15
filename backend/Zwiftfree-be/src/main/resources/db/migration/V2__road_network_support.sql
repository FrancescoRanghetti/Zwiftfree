-- Support tables for the road network. road_nodes/road_edges themselves are created by the import job.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Immutable wrapper so unaccent can be used in an index.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE TABLE places (
    id          bigserial PRIMARY KEY,
    osm_id      bigint UNIQUE,
    name        text             NOT NULL,
    kind        text             NOT NULL,   -- city | town | village | hamlet
    rank        smallint         NOT NULL,   -- 1 city ... 4 hamlet
    population  int,
    lon         double precision NOT NULL,
    lat         double precision NOT NULL,
    geom        geometry(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED
);
CREATE INDEX places_name_idx ON places (lower(f_unaccent(name)) text_pattern_ops);
CREATE INDEX places_geom_idx ON places USING gist (geom);

-- One row: hash of data/out/stats.json from the last successful import.
CREATE TABLE road_import_state (
    id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    stats_hash   text        NOT NULL,
    edges        int         NOT NULL,
    nodes        int         NOT NULL,
    imported_at  timestamptz NOT NULL DEFAULT now()
);

-- Segments: where they come from, and a stable key for official-route segments.
ALTER TABLE segments
    ADD COLUMN source     text NOT NULL DEFAULT 'AUTO' CHECK (source IN ('AUTO', 'ROUTE')),
    ADD COLUMN slug       text UNIQUE,
    ADD COLUMN ascent_m   numeric,
    ADD COLUMN start_ele  numeric,
    ADD COLUMN end_ele    numeric;

ALTER TABLE routes
    ADD COLUMN profile text;   -- planner cost profile used to compute it (SHORTEST, AVOID_CLIMBS, ...)
