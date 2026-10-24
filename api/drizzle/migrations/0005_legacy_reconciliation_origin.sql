ALTER TABLE streams ADD COLUMN origin text NOT NULL DEFAULT 'native';
--> statement-breakpoint
ALTER TABLE recordings ADD COLUMN origin text NOT NULL DEFAULT 'native';
--> statement-breakpoint
ALTER TABLE streams ADD CONSTRAINT streams_origin_check CHECK (origin IN ('legacy_json', 'native'));
--> statement-breakpoint
ALTER TABLE recordings ADD CONSTRAINT recordings_origin_check CHECK (origin IN ('legacy_json', 'native'));
--> statement-breakpoint
UPDATE streams SET origin = 'legacy_json' WHERE legacy_started_at_raw IS NOT NULL AND started_at IS NULL;
--> statement-breakpoint
UPDATE recordings SET origin = 'legacy_json' WHERE legacy_started_at_raw IS NOT NULL AND started_at IS NULL;
--> statement-breakpoint
DROP INDEX uq_streams_active_per_target;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_streams_active_per_target ON streams (watch_target_id) WHERE origin = 'native' AND finished_at IS NULL AND legacy_finished_at_raw IS NULL;