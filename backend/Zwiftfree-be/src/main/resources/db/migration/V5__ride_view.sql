ALTER TABLE user_settings
    ADD COLUMN ride_view text NOT NULL DEFAULT 'MAP_2D'
        CHECK (ride_view IN ('MAP_2D', 'THIRD_PERSON', 'FIRST_PERSON')),
    ADD COLUMN head_bob_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN scene_quality text NOT NULL DEFAULT 'MEDIUM'
        CHECK (scene_quality IN ('LOW', 'MEDIUM', 'HIGH'));
