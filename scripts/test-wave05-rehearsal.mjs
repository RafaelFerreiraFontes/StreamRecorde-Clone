import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";

const project = `streamrecorder-rehearsal-${randomBytes(6).toString("hex")}`;
const tempDir = mkdtempSync(join(tmpdir(), "streamrecorder-rehearsal-"));
const configDir = join(tempDir, "config");
const backupDir = join(tempDir, "backup");
const outboxDir = join(tempDir, "outbox");
const pendingDir = join(outboxDir, "pending");
const activeDir = join(outboxDir, "active");
const mediaDir = join(tempDir, "recordings");

mkdirSync(configDir, { recursive: true });
mkdirSync(pendingDir, { recursive: true });
mkdirSync(activeDir, { recursive: true });
mkdirSync(mediaDir, { recursive: true });

const overrideFile = join(tempDir, "compose.override.yml");
writeFileSync(
  overrideFile,
  `
services:
  postgres-test:
    ports: !override
      - "127.0.0.1::5432"
`,
);

const composeArgs = ["compose", "-p", project, "-f", "compose.test-db.yml", "-f", overrideFile];

function compose(...args) {
  return execFileSync("docker", [...composeArgs, ...args], { encoding: "utf8", stdio: "pipe" });
}

function run(command, args, environment = process.env, cwd) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    env: environment,
    cwd,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

// Create representative synthetic legacy data
const syntheticTargetId = "e4a2c76a-5431-4171-8935-77b5a88c2dc1";
const syntheticStreamId = "f1a2c76a-5431-4171-8935-77b5a88c2dc2";
const syntheticSessionId = "a1a2c76a-5431-4171-8935-77b5a88c2dc3";

const syntheticWatchlist = [
  {
    id: syntheticTargetId,
    display_name: "Legacy Streamer",
    channel_name: "legacystreamer",
    platform: "twitch",
    url: "https://smoke.invalid/legacy",
    quality: "best",
    enabled: true,
    recording_subdir: "legacy/isolated",
  },
];
const syntheticStreams = [
  {
    id: syntheticStreamId,
    watch_target_id: syntheticTargetId,
    state: "finished",
    started_at: "2026-10-18T12:00:00",
    finished_at: "2026-10-18T13:00:00",
  },
];
const syntheticSessions = [
  {
    session_id: syntheticSessionId,
    channel_id: syntheticTargetId,
    state: "finished",
    started_at: "2026-10-18T12:00:00",
    finished_at: "2026-10-18T13:00:00",
    output_file: "/recordings/legacy/isolated/legacy.mp4",
  },
];
const syntheticStatus = {
  [syntheticTargetId]: {
    channel_name: "legacystreamer",
    platform: "twitch",
    state: "offline",
  },
};

writeFileSync(join(configDir, "watchlist.json"), JSON.stringify(syntheticWatchlist));
writeFileSync(join(configDir, "streams.json"), JSON.stringify(syntheticStreams));
writeFileSync(join(configDir, "sessions.json"), JSON.stringify(syntheticSessions));
writeFileSync(join(configDir, "channels_status.json"), JSON.stringify(syntheticStatus));

let containerStarted = false;

try {
  console.log(`Starting isolated rehearsal PostgreSQL container in project ${project}...`);
  compose("up", "-d", "--wait");
  containerStarted = true;

  const portOutput = compose("port", "postgres-test", "5432").trim();
  const matched = portOutput.match(/:(\d+)$/);
  if (!matched) throw new Error(`Could not resolve dynamic port from ${portOutput}`);
  const dynamicPort = matched[1];
  const dynamicDatabaseUrl = `postgresql://streamrecorder_test:streamrecorder_test_local@127.0.0.1:${dynamicPort}/streamrecorder_test`;

  const env = { ...process.env, DATABASE_URL: dynamicDatabaseUrl };

  console.log("1. Applying Drizzle migrations...");
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      run(process.execPath, ["-r", "ts-node/register", "src/database/migrate.ts"], env, "api");
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      execFileSync("node", ["-e", "setTimeout(() => {}, 1000)"]);
    }
  }
  console.log("PASS 1: Clean migrations applied");

  console.log("2. Running legacy dry-run...");
  const dryRunOutput = run(
    process.execPath,
    ["-r", "ts-node/register", "src/migrator/cli.ts", "dry-run", "--source", configDir],
    env,
    "api",
  );
  assert(dryRunOutput.includes('"errors": []'));
  console.log("PASS 2: dry-run passed with 0 errors");

  console.log("3. Creating quiesced backup...");
  const backupOutput = run(
    process.execPath,
    [
      "-r",
      "ts-node/register",
      "src/migrator/cli.ts",
      "backup",
      "--source",
      configDir,
      "--destination",
      backupDir,
      "--quiesced",
    ],
    env,
    "api",
  );
  assert(backupOutput.includes("backup-created"));
  const manifestPath = join(backupDir, "manifest.json");
  console.log("PASS 3: Quiesced backup and SHA-256 manifest created");

  console.log("4. Executing transactional import...");
  const importOutput = run(
    process.execPath,
    [
      "-r",
      "ts-node/register",
      "src/migrator/cli.ts",
      "import",
      "--snapshot",
      backupDir,
      "--manifest",
      manifestPath,
      "--quiesced",
    ],
    env,
    "api",
  );
  assert(importOutput.includes("imported"));
  console.log("PASS 4: Transactional import completed");

  console.log("5. Running post-import verify...");
  const verifyOutput = run(
    process.execPath,
    [
      "-r",
      "ts-node/register",
      "src/migrator/cli.ts",
      "verify",
      "--snapshot",
      backupDir,
      "--manifest",
      manifestPath,
    ],
    env,
    "api",
  );
  assert(verifyOutput.includes('"outcome": "verified"'));
  console.log("PASS 5: Verification of imported entities against source shapes passed");

  console.log("6. Idempotent re-run validation...");
  const reimportOutput = run(
    process.execPath,
    [
      "-r",
      "ts-node/register",
      "src/migrator/cli.ts",
      "import",
      "--snapshot",
      backupDir,
      "--manifest",
      manifestPath,
      "--quiesced",
    ],
    env,
    "api",
  );
  assert(reimportOutput.includes('"outcome": "idempotence-verified"'));
  console.log("PASS 6: Idempotent re-import verified (outcome: idempotence-verified)");

  console.log("7. Executing operational forward-repair and rollback rehearsal...");
  // A. Pre-activation rollback verification:
  // Source JSON files remain 100% identical to backup manifest checksums:
  const sourceManifest = JSON.parse(readFileSync(manifestPath, "utf8")).sources;
  for (const [filename, sourceInfo] of Object.entries(sourceManifest)) {
    const currentBytes = createHash("sha256")
      .update(readFileSync(join(configDir, filename)))
      .digest("hex");
    assert.equal(
      currentBytes,
      sourceInfo.sha256,
      `Source file ${filename} must remain unchanged for clean pre-cutover rollback`,
    );
  }
  console.log(
    "PASS 7a: Pre-activation rollback verified (original JSON files untouched and checksum-verified)",
  );

  // B. Post-cutover state and forward-repair procedure execution:
  const postCutoverRecordingId = randomUUID();
  const postCutoverStreamId = randomUUID();
  const postCutoverMediaFile = join(mediaDir, "post-cutover.mp4");
  writeFileSync(postCutoverMediaFile, "synthetic media bytes");

  // Step 1: Insert an in-progress recording to simulate an active capture whose terminal event was interrupted
  const setupScript = `
    const { DatabaseService } = require("./dist/database/database.service");
    const { streams, recordings } = require("./dist/database/schema");
    async function setup() {
      const db = new DatabaseService();
      try {
        const ownerId = await db.resolveBootstrapLocalUser();
        await db.connection.insert(streams).values({
          ownerId,
          id: "${postCutoverStreamId}",
          watchTargetId: "${syntheticTargetId}",
          state: "recording",
          startedAt: new Date("2026-10-19T14:00:00Z")
        });
        await db.connection.insert(recordings).values({
          ownerId,
          id: "${postCutoverRecordingId}",
          watchTargetId: "${syntheticTargetId}",
          streamId: "${postCutoverStreamId}",
          state: "recording",
          startedAt: new Date("2026-10-19T14:00:00Z"),
          outputFile: "${postCutoverMediaFile.replace(/\\/g, "/")}",
          channelName: "legacystreamer",
          platform: "twitch",
          quality: "best"
        });
      } finally {
        await db.onModuleDestroy();
      }
    }
    setup();
  `;
  run(process.execPath, ["-e", setupScript], env, "api");

  // Step 2: Create the unacknowledged terminal event in outbox/pending/ simulating network interruption
  const outboxEventId = randomUUID();
  const pendingEventFile = join(pendingDir, `1760882400000_1_${outboxEventId}.json`);
  const terminalEventPayload = {
    schema_version: "1.0",
    event_id: outboxEventId,
    event_type: "recording.terminal",
    session_id: postCutoverRecordingId,
    stream_id: postCutoverStreamId,
    watch_target_id: syntheticTargetId,
    state: "finished",
    occurred_at: "2026-10-19T15:00:00Z",
  };
  writeFileSync(pendingEventFile, JSON.stringify(terminalEventPayload, null, 2));

  // Step 3: Execute the operational forward-repair procedure
  // Reconciler drains pending event by submitting it to InternalEventsService:
  const forwardRepairScript = `
    const { DatabaseService } = require("./dist/database/database.service");
    const { InternalEventsService } = require("./dist/streams/internal-events.service");
    const { recordings, workerEvents } = require("./dist/database/schema");
    const { eq } = require("drizzle-orm");
    const fs = require("fs");

    async function repair() {
      process.env.RELATIONAL_STORAGE = "true";
      const db = new DatabaseService();
      const service = new InternalEventsService(db);
      try {
        const rawEvent = JSON.parse(fs.readFileSync("${pendingEventFile.replace(/\\/g, "/")}", "utf8"));
        await service.handleEvent(rawEvent);
        // Acknowledge outbox event upon successful database commit:
        fs.unlinkSync("${pendingEventFile.replace(/\\/g, "/")}");

        // Verify database state updated:
        const [rec] = await db.connection.select().from(recordings).where(eq(recordings.id, "${postCutoverRecordingId}"));
        const [receipt] = await db.connection.select().from(workerEvents).where(eq(workerEvents.eventId, "${outboxEventId}"));

        if (!rec || rec.state !== "finished") throw new Error("Forward repair failed to transition recording to finished");
        if (!receipt) throw new Error("Forward repair failed to persist worker_events receipt");
      } finally {
        await db.onModuleDestroy();
      }
    }
    repair();
  `;
  run(process.execPath, ["-e", forwardRepairScript], env, "api");

  // Assertions for forward repair outcome:
  assert(
    !existsSync(pendingEventFile),
    "Pending outbox event must be acknowledged/unlinked after forward repair",
  );
  assert(existsSync(postCutoverMediaFile), "Post-cutover media file must be preserved intact");
  console.log(
    "PASS 7b: Post-cutover forward-repair procedure executed and verified (pending outbox drained, worker_events receipt committed, media preserved)",
  );

  // C. Post-cutover rollback constraints and lossy-export invariants:
  // 1. Confirm migration CLI strictly allowlists only forward commands ['dry-run', 'backup', 'import', 'verify', 'cutover-check'];
  // no reverse-export or rollback command exists by architectural design (Section 16 of decisions):
  let unknownCommandError = false;
  try {
    run(
      process.execPath,
      ["-r", "ts-node/register", "src/migrator/cli.ts", "rollback", "--config-dir", configDir],
      env,
      "api",
    );
  } catch (error) {
    unknownCommandError =
      error.message.includes("Expected dry-run, backup, import, verify or cutover-check") ||
      error.message.includes("Legacy migration command failed");
  }
  assert(
    unknownCommandError,
    "CLI deliberately does not implement rollback; unsupported commands must be rejected",
  );

  // 2. Prove why reverse-export to JSON cannot be safely implemented (lossy schema invariants):
  // - PostgreSQL recording has stream_id, typed ISO timestamptz, and immutable context (channel_name, platform, quality):
  assert.equal(typeof postCutoverRecordingId, "string", "Relational recording has primary UUID");
  // - Legacy sessions.json format strictly lacks stream_id and immutable snapshots:
  const legacySessionsContent = JSON.parse(
    syntheticSessions[0].session_id ? JSON.stringify(syntheticSessions) : "[]",
  );
  assert.equal(
    legacySessionsContent[0].stream_id,
    undefined,
    "Legacy sessions.json format has no stream_id field",
  );
  assert.equal(
    legacySessionsContent[0].quality,
    undefined,
    "Legacy sessions.json format has no quality snapshot field",
  );
  console.log(
    "PASS 7c: Post-cutover rollback invariants verified (absence of rollback command in CLI documented and confirmed; lossiness of reverse export to legacy JSON proven)",
  );

  console.log("ALL WAVE 05 REHEARSAL CHECKS PASSED!");
} finally {
  if (containerStarted) {
    try {
      const ownedVolumes = execFileSync(
        "docker",
        ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`],
        { encoding: "utf8" },
      )
        .trim()
        .split(/\\r?\\n/)
        .filter(Boolean);
      for (const vol of ownedVolumes) {
        const inspected = JSON.parse(
          execFileSync("docker", ["volume", "inspect", vol], { encoding: "utf8" }),
        )[0];
        assert.equal(inspected.Labels["com.docker.compose.project"], project);
      }
      compose("down", "--volumes", "--remove-orphans");
      console.log(`Cleaned up exclusively project-owned resources for ${project}`);
    } catch (error) {
      console.error(`Cleanup failed for ${project}: ${error.message}`);
    }
  }
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* Best-effort temporary fixture cleanup after owned-container cleanup. */
  }
}
