import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../database/database.service";
import { resolveBootstrapLocalUser } from "../database/database.service";
import {
  creators,
  migrationManifests,
  recordings,
  streams,
  users,
  watchTargets,
} from "../database/schema";
import type { Counts, Snapshot } from "./snapshot";
import {
  canonical,
  creatorId,
  creatorKey,
  creatorName,
  digest,
  FILES,
  inspectSnapshot,
  TOOL_VERSION,
} from "./snapshot";

type Source = { origin: string; size: number; sha256: string };
export type Manifest = {
  toolVersion: string;
  capturedAt: string;
  destinationSchema: "public";
  quiescence: { writersStopped: true; outboxDrained: true };
  sources: Partial<Record<(typeof FILES)[number], Source>>;
  counts: Counts;
  fingerprint: string;
};
const fingerprint = (manifest: Omit<Manifest, "fingerprint">): string =>
  digest(canonical(manifest));
function clean(snapshot: Snapshot): void {
  if (snapshot.errors.length)
    throw new Error(`Snapshot validation failed: ${snapshot.errors.join("; ")}`);
}
export function sourceDigests(manifest: Manifest): Record<string, string> {
  return Object.fromEntries(
    FILES.filter((file) => manifest.sources[file]).map((file) => [
      file,
      manifest.sources[file]!.sha256,
    ]),
  );
}

export async function backup(
  source: string,
  destination: string,
  quiesced: boolean,
): Promise<Manifest> {
  if (!quiesced)
    throw new Error("Confirm stopped API/Worker writers and drained outbox with --quiesced");
  const origin = await realpath(source);
  const target = resolve(destination);
  const relation = relative(origin, target);
  if (!relation || (!relation.startsWith("..") && !isAbsolute(relation)))
    throw new Error("Backup must be outside the source directory");
  const snapshot = await inspectSnapshot(origin);
  clean(snapshot);
  const manifest: Manifest = {
    toolVersion: TOOL_VERSION,
    capturedAt: new Date().toISOString(),
    destinationSchema: "public",
    quiescence: { writersStopped: true, outboxDrained: true },
    sources: {},
    counts: snapshot.counts,
    fingerprint: "",
  };
  for (const file of FILES) {
    const bytes = snapshot.bytes[file];
    if (bytes)
      manifest.sources[file] = {
        origin: join(origin, file),
        size: bytes.length,
        sha256: digest(bytes),
      };
  }
  const second = await inspectSnapshot(origin);
  clean(second);
  if (
    canonical(FILES.map((file) => (second.bytes[file] ? digest(second.bytes[file]) : null))) !==
    canonical(FILES.map((file) => (snapshot.bytes[file] ? digest(snapshot.bytes[file]) : null)))
  ) {
    throw new Error("Source changed during snapshot; stop writers before retrying");
  }
  const { fingerprint: _unused, ...payload } = manifest;
  void _unused;
  manifest.fingerprint = fingerprint(payload);
  await mkdir(target, { mode: 0o700 });
  for (const file of FILES) {
    if (snapshot.bytes[file])
      await writeFile(join(target, file), snapshot.bytes[file], { flag: "wx", mode: 0o600 });
  }
  await writeFile(join(target, "manifest.json"), JSON.stringify(manifest, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  return manifest;
}

export async function loadSnapshot(
  directory: string,
  manifestPath: string,
): Promise<{ manifest: Manifest; snapshot: Snapshot }> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const { fingerprint: supplied, ...payload } = manifest;
  if (
    manifest.toolVersion !== TOOL_VERSION ||
    manifest.destinationSchema !== "public" ||
    !manifest.quiescence?.writersStopped ||
    !manifest.quiescence?.outboxDrained ||
    supplied !== fingerprint(payload) ||
    !manifest.sources ||
    !manifest.counts ||
    Object.keys(manifest.sources).some((file) => !FILES.includes(file as (typeof FILES)[number]))
  ) {
    throw new Error("Invalid or conflicting manifest");
  }
  const snapshot = await inspectSnapshot(directory);
  clean(snapshot);
  for (const file of FILES) {
    const entry = manifest.sources[file];
    const bytes = snapshot.bytes[file];
    if (entry ? bytes?.length !== entry.size || digest(bytes) !== entry.sha256 : !!bytes) {
      throw new Error(`Snapshot drift or manifest conflict: ${file}`);
    }
  }
  if (canonical(manifest.counts) !== canonical(snapshot.counts))
    throw new Error("Manifest count conflict");
  return { manifest, snapshot };
}

function entities(snapshot: Snapshot, ownerId: string) {
  const creatorRows = [
    ...new Map(
      snapshot.rows["watchlist.json"].map((row) => [
        creatorKey(row),
        {
          id: creatorId(creatorKey(row)),
          ownerId,
          displayName: creatorName(row),
          normalizedKey: creatorKey(row),
        },
      ]),
    ).values(),
  ];
  const targetRows = snapshot.rows["watchlist.json"].map((row) => ({
    id: String(row.id).toLowerCase(),
    ownerId,
    creatorId: creatorId(creatorKey(row)),
    channelName: String(row.channel_name),
    platform: String(row.platform),
    url: String(row.url),
    quality: String(row.quality),
    enabled: row.enabled === undefined ? true : (row.enabled as boolean),
    recordingSubdir: row.recording_subdir
      ? String(row.recording_subdir as string).replace(/\\/g, "/")
      : null,
  }));
  const streamRows = snapshot.rows["streams.json"].map((row) => ({
    id: String(row.id).toLowerCase(),
    ownerId,
    watchTargetId: String(row.watch_target_id).toLowerCase(),
    state: String(row.state),
    startedAt: null,
    finishedAt: null,
    legacyStartedAtRaw: String(row.started_at),
    legacyFinishedAtRaw: row.finished_at == null ? null : String(row.finished_at as string),
  }));
  const recordingRows = snapshot.rows["sessions.json"].map((row) => ({
    id: String(row.session_id).toLowerCase(),
    ownerId,
    watchTargetId: String(row.channel_id).toLowerCase(),
    streamId: null,
    state: String(row.state),
    startedAt: null,
    finishedAt: null,
    legacyStartedAtRaw: String(row.started_at),
    legacyFinishedAtRaw: row.finished_at == null ? null : String(row.finished_at as string),
    outputFile: row.output_file == null ? null : String(row.output_file as string),
    channelName: null,
    platform: null,
    quality: null,
  }));
  return { creatorRows, targetRows, streamRows, recordingRows };
}

export async function importSnapshot(
  db: DatabaseConnection,
  directory: string,
  manifestPath: string,
  quiesced: boolean,
) {
  if (!quiesced) throw new Error("Import requires --quiesced confirmation");
  const { manifest, snapshot } = await loadSnapshot(directory, manifestPath);
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`LOCK TABLE migration_manifests, creators, watch_targets, streams, recordings IN EXCLUSIVE MODE`,
    );
    const ownerId = await resolveBootstrapLocalUser(transaction);
    const rows = entities(snapshot, ownerId);
    const [applied] = await transaction
      .select()
      .from(migrationManifests)
      .where(eq(migrationManifests.manifestFingerprint, manifest.fingerprint));
    if (applied) {
      if (
        applied.ownerId !== ownerId ||
        canonical(applied.sourceDigests) !== canonical(sourceDigests(manifest)) ||
        canonical(applied.entityCounts) !== canonical(manifest.counts)
      ) {
        throw new Error("Existing manifest ledger conflict");
      }
      for (const [table, imported] of [
        [creators, rows.creatorRows],
        [watchTargets, rows.targetRows],
        [streams, rows.streamRows],
        [recordings, rows.recordingRows],
      ] as const) {
        if (!imported.length) continue;
        const existing = await transaction
          .select({ ownerId: table.ownerId })
          .from(table)
          .where(
            inArray(
              table.id,
              imported.map((row: { id: string }) => row.id),
            ),
          );
        if (existing.some((row) => row.ownerId !== ownerId))
          throw new Error("Existing import owner conflict");
      }
      return { outcome: "idempotence-verified", fingerprint: manifest.fingerprint };
    }
    for (const table of [creators, watchTargets, streams, recordings, migrationManifests]) {
      const existing = await transaction.select({ id: table.id }).from(table).limit(1);
      if (existing.length)
        throw new Error(
          "Destination conflict: import requires an empty domain database without prior manifests",
        );
    }
    if (rows.creatorRows.length) await transaction.insert(creators).values(rows.creatorRows);
    if (rows.targetRows.length) await transaction.insert(watchTargets).values(rows.targetRows);
    if (rows.streamRows.length) await transaction.insert(streams).values(rows.streamRows);
    if (rows.recordingRows.length) await transaction.insert(recordings).values(rows.recordingRows);
    await transaction.insert(migrationManifests).values({
      id: randomUUID(),
      ownerId,
      manifestFingerprint: manifest.fingerprint,
      sourceDigests: sourceDigests(manifest),
      entityCounts: manifest.counts,
      toolVersion: TOOL_VERSION,
    });
    return { outcome: "imported", fingerprint: manifest.fingerprint };
  });
}

export async function verifySnapshot(
  db: DatabaseConnection,
  directory: string,
  manifestPath: string,
) {
  const { manifest, snapshot } = await loadSnapshot(directory, manifestPath);
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    const [local] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.bootstrapKey, "local"));
    if (!local) throw new Error("Missing bootstrap local user");
    const rows = entities(snapshot, local.id);
    const [applied] = await transaction
      .select()
      .from(migrationManifests)
      .where(eq(migrationManifests.manifestFingerprint, manifest.fingerprint));
    if (
      applied?.ownerId !== local.id ||
      canonical(applied.sourceDigests) !== canonical(sourceDigests(manifest)) ||
      canonical(applied.entityCounts) !== canonical(manifest.counts)
    ) {
      throw new Error("Missing or conflicting import ledger");
    }
    const groups = [
      [rows.creatorRows, await transaction.select().from(creators)],
      [rows.targetRows, await transaction.select().from(watchTargets)],
      [rows.streamRows, await transaction.select().from(streams)],
      [rows.recordingRows, await transaction.select().from(recordings)],
    ] as const;
    for (const [expected, actual] of groups) {
      if (expected.length !== actual.length)
        throw new Error("Database entity count mismatch; verify before activation only");
      for (const row of expected) {
        const stored = actual.find((candidate) => candidate.id === row.id);
        if (
          !stored ||
          Object.entries(row).some(
            ([key, value]) => canonical(stored[key as keyof typeof stored]) !== canonical(value),
          )
        ) {
          throw new Error("Database ID, relationship or imported field mismatch");
        }
      }
    }
    return { outcome: "verified", counts: manifest.counts };
  });
}
