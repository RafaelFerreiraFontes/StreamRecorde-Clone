import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    bootstrapKey: text("bootstrap_key").unique(),
    username: text("username").notNull().unique(),
    email: text("email"),
    passwordHash: text("password_hash"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("users_username_format_check", sql`${table.username} ~ '^[a-z0-9][a-z0-9._-]{2,31}$'`),
    check(
      "users_email_lowercase_check",
      sql`${table.email} is null or ${table.email} = lower(${table.email})`,
    ),
    uniqueIndex("uq_users_email")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_sessions_user_id").on(table.userId),
    index("idx_sessions_idle_expires_at").on(table.idleExpiresAt),
  ],
);

export const migrationManifests = pgTable(
  "migration_manifests",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    manifestFingerprint: text("manifest_fingerprint").notNull().unique(),
    sourceDigests: jsonb("source_digests").notNull(),
    entityCounts: jsonb("entity_counts").notNull(),
    toolVersion: text("tool_version").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_migration_manifests_owner_fingerprint").on(table.ownerId, table.manifestFingerprint),
  ],
);

export const workerEvents = pgTable("worker_events", {
  eventId: uuid("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  fingerprint: text("fingerprint").notNull(),
  responsePayload: jsonb("response_payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creators = pgTable(
  "creators",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_creators_archived_at").on(table.archivedAt),
    index("idx_creators_normalized_key").on(table.normalizedKey),
    unique("creators_id_owner_id_unique").on(table.id, table.ownerId),
    index("idx_creators_owner_normalized_key").on(table.ownerId, table.normalizedKey),
  ],
);

export const watchTargets = pgTable(
  "watch_targets",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "restrict" }),
    channelName: text("channel_name").notNull(),
    platform: text("platform").notNull(),
    url: text("url").notNull(),
    quality: text("quality").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    recordingSubdir: text("recording_subdir"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    check("watch_targets_platform_check", sql`${table.platform} in ('youtube', 'twitch', 'kick')`),
    index("idx_watch_targets_creator_id").on(table.creatorId),
    unique("watch_targets_id_owner_id_unique").on(table.id, table.ownerId),
    foreignKey({
      columns: [table.creatorId, table.ownerId],
      foreignColumns: [creators.id, creators.ownerId],
      name: "watch_targets_creator_owner_fk",
    }).onDelete("restrict"),
    index("idx_watch_targets_owner_id").on(table.ownerId, table.id),
    index("idx_watch_targets_creator_owner").on(table.creatorId, table.ownerId),
  ],
);

export const streams = pgTable(
  "streams",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    watchTargetId: uuid("watch_target_id")
      .notNull()
      .references(() => watchTargets.id, { onDelete: "restrict" }),
    state: text("state").notNull(),
    origin: text("origin").notNull().default("native"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    legacyStartedAtRaw: text("legacy_started_at_raw"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    legacyFinishedAtRaw: text("legacy_finished_at_raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("streams_origin_check", sql`${table.origin} in ('legacy_json', 'native')`),
    check(
      "streams_state_check",
      sql`${table.state} in ('idle', 'offline', 'recording', 'finished', 'error')`,
    ),
    check(
      "streams_started_evidence_check",
      sql`${table.startedAt} is not null or ${table.legacyStartedAtRaw} is not null`,
    ),
    check(
      "streams_chronological_check",
      sql`${table.finishedAt} is null or ${table.startedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
    unique("streams_id_watch_target_id_unique").on(table.id, table.watchTargetId),
    foreignKey({
      columns: [table.watchTargetId, table.ownerId],
      foreignColumns: [watchTargets.id, watchTargets.ownerId],
      name: "streams_watch_target_owner_fk",
    }).onDelete("restrict"),
    index("idx_streams_owner_watch_target").on(table.ownerId, table.watchTargetId),
    index("idx_streams_watch_target_started_at").on(table.watchTargetId, table.startedAt.desc()),
    uniqueIndex("uq_streams_active_per_target")
      .on(table.watchTargetId)
      .where(
        sql`${table.origin} = 'native' and ${table.finishedAt} is null and ${table.legacyFinishedAtRaw} is null`,
      ),
  ],
);

export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    watchTargetId: uuid("watch_target_id")
      .notNull()
      .references(() => watchTargets.id, { onDelete: "restrict" }),
    streamId: uuid("stream_id"),
    state: text("state").notNull(),
    origin: text("origin").notNull().default("native"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    legacyStartedAtRaw: text("legacy_started_at_raw"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    legacyFinishedAtRaw: text("legacy_finished_at_raw"),
    outputFile: text("output_file"),
    channelName: text("channel_name"),
    platform: text("platform"),
    quality: text("quality"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("recordings_origin_check", sql`${table.origin} in ('legacy_json', 'native')`),
    check(
      "recordings_state_check",
      sql`${table.state} in ('idle', 'offline', 'recording', 'finished', 'error')`,
    ),
    check(
      "recordings_started_evidence_check",
      sql`${table.startedAt} is not null or ${table.legacyStartedAtRaw} is not null`,
    ),
    check(
      "recordings_chronological_check",
      sql`${table.finishedAt} is null or ${table.startedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
    foreignKey({
      columns: [table.streamId, table.watchTargetId],
      foreignColumns: [streams.id, streams.watchTargetId],
      name: "recordings_stream_watch_target_fk",
    }).onDelete("restrict"),
    index("idx_recordings_watch_target_started_at").on(table.watchTargetId, table.startedAt.desc()),
    index("idx_recordings_stream_started_at").on(table.streamId, table.startedAt.desc()),
    foreignKey({
      columns: [table.watchTargetId, table.ownerId],
      foreignColumns: [watchTargets.id, watchTargets.ownerId],
      name: "recordings_watch_target_owner_fk",
    }).onDelete("restrict"),
    index("idx_recordings_owner_watch_target").on(table.ownerId, table.watchTargetId),
  ],
);
