CREATE TABLE "creators" (
  "id" uuid PRIMARY KEY NOT NULL,
  "display_name" text NOT NULL,
  "normalized_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);

CREATE TABLE "watch_targets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "creator_id" uuid NOT NULL,
  "channel_name" text NOT NULL,
  "platform" text NOT NULL,
  "url" text NOT NULL,
  "quality" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "recording_subdir" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "watch_targets_platform_check" CHECK ("platform" IN ('youtube', 'twitch', 'kick')),
  CONSTRAINT "watch_targets_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT
);

CREATE TABLE "streams" (
  "id" uuid PRIMARY KEY NOT NULL,
  "watch_target_id" uuid NOT NULL,
  "state" text NOT NULL,
  "started_at" timestamp with time zone,
  "legacy_started_at_raw" text,
  "finished_at" timestamp with time zone,
  "legacy_finished_at_raw" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "streams_state_check" CHECK ("state" IN ('idle', 'offline', 'recording', 'finished', 'error')),
  CONSTRAINT "streams_started_evidence_check" CHECK ("started_at" IS NOT NULL OR "legacy_started_at_raw" IS NOT NULL),
  CONSTRAINT "streams_chronological_check" CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at"),
  CONSTRAINT "streams_id_watch_target_id_unique" UNIQUE("id", "watch_target_id"),
  CONSTRAINT "streams_watch_target_id_watch_targets_id_fk" FOREIGN KEY ("watch_target_id") REFERENCES "watch_targets"("id") ON DELETE RESTRICT
);

CREATE TABLE "recordings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "watch_target_id" uuid NOT NULL,
  "stream_id" uuid,
  "state" text NOT NULL,
  "started_at" timestamp with time zone,
  "legacy_started_at_raw" text,
  "finished_at" timestamp with time zone,
  "legacy_finished_at_raw" text,
  "output_file" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recordings_state_check" CHECK ("state" IN ('idle', 'offline', 'recording', 'finished', 'error')),
  CONSTRAINT "recordings_started_evidence_check" CHECK ("started_at" IS NOT NULL OR "legacy_started_at_raw" IS NOT NULL),
  CONSTRAINT "recordings_chronological_check" CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at"),
  CONSTRAINT "recordings_watch_target_id_watch_targets_id_fk" FOREIGN KEY ("watch_target_id") REFERENCES "watch_targets"("id") ON DELETE RESTRICT,
  CONSTRAINT "recordings_stream_watch_target_fk" FOREIGN KEY ("stream_id", "watch_target_id") REFERENCES "streams"("id", "watch_target_id") ON DELETE RESTRICT
);

CREATE INDEX "idx_creators_archived_at" ON "creators" USING btree ("archived_at");
CREATE INDEX "idx_creators_normalized_key" ON "creators" USING btree ("normalized_key");
CREATE INDEX "idx_watch_targets_creator_id" ON "watch_targets" USING btree ("creator_id");
CREATE INDEX "idx_streams_watch_target_started_at" ON "streams" USING btree ("watch_target_id", "started_at" DESC);
CREATE UNIQUE INDEX "uq_streams_active_per_target" ON "streams" USING btree ("watch_target_id") WHERE "finished_at" IS NULL AND "legacy_finished_at_raw" IS NULL;
CREATE INDEX "idx_recordings_watch_target_started_at" ON "recordings" USING btree ("watch_target_id", "started_at" DESC);
CREATE INDEX "idx_recordings_stream_started_at" ON "recordings" USING btree ("stream_id", "started_at" DESC);