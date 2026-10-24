import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { DatabaseService } from "../database.service";
import { backup, importSnapshot, verifySnapshot } from "../../migrator/migrator";
import { inspectSnapshot } from "../../migrator/snapshot";
import { RelationalStreamsRepository } from "../../streams/relational-streams.repository";

const databaseUrl = process.env.RELATIONAL_TEST_DATABASE_URL;
if (databaseUrl && new URL(databaseUrl).pathname !== "/streamrecorder_test")
  throw new Error("Disposable streamrecorder_test database required");
const describeDatabase = databaseUrl ? describe : describe.skip;
const targetIds = [1, 2, 3].map((number) => `10000000-0000-4000-8000-00000000000${number}`);
const streamId = "20000000-0000-4000-8000-000000000001";
const recordingId = "30000000-0000-4000-8000-000000000001";
const started = "2025-01-02T03:04:05.123456";
const finished = "2025-01-02T04:04:05.123456";

describeDatabase("legacy migration isolated PostgreSQL", () => {
  const database = new DatabaseService(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  let directory: string;
  let snapshot: string;
  let manifest: string;
  beforeAll(async () => {
    await database.migrate();
  });
  beforeEach(async () => {
    await pool.query<{ [key: string]: unknown }>(
      "truncate migration_manifests, worker_events, recordings, streams, watch_targets, creators",
    );
    directory = await mkdtemp(join(tmpdir(), "legacy-db-"));
    snapshot = join(directory, "snapshot");
    manifest = join(snapshot, "manifest.json");
    await writeFile(
      join(directory, "watchlist.json"),
      JSON.stringify(
        targetIds.map((id, index) => ({
          id,
          display_name: "Example Creator",
          channel_name: "example",
          platform: "twitch",
          url: "https://example.test/live",
          quality: ["best", "1080p", "720p"][index],
          ...(index ? { enabled: index === 1 } : {}),
          recording_subdir: `target-${index}`,
        })),
      ),
    );
    await writeFile(
      join(directory, "streams.json"),
      JSON.stringify([
        {
          id: streamId,
          watch_target_id: targetIds[0],
          state: "finished",
          started_at: started,
          finished_at: finished,
        },
      ]),
    );
    await writeFile(
      join(directory, "sessions.json"),
      JSON.stringify([
        {
          session_id: recordingId,
          channel_id: targetIds[0],
          state: "finished",
          started_at: started,
          finished_at: finished,
          output_file: "private/example.mp4",
        },
      ]),
    );
    await writeFile(join(directory, "channels_status.json"), "{}");
  });
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await pool.end();
    await database.onModuleDestroy();
  });
  async function capture(): Promise<void> {
    const external = `${directory}-snapshot`;
    await backup(directory, external, true);
    snapshot = external;
    manifest = join(snapshot, "manifest.json");
  }
  afterEach(async () => {
    if (snapshot === `${directory}-snapshot`) await rm(snapshot, { recursive: true, force: true });
  });

  it("imports dependencies, verifies raw history, and replays without duplicates", async () => {
    await capture();
    expect((await importSnapshot(database.connection, snapshot, manifest, true)).outcome).toBe(
      "imported",
    );
    expect((await verifySnapshot(database.connection, snapshot, manifest)).counts).toEqual({
      creators: 1,
      watchTargets: 3,
      streams: 1,
      recordings: 1,
    });
    const record = (
      await pool.query<{
        id: string;
        owner_id: string;
        watch_target_id: string;
        stream_id: string | null;
        state: string;
        finished_at: Date | null;
        legacy_started_at_raw: string | null;
        legacy_finished_at_raw: string | null;
        output_file: string | null;
      }>("select * from recordings where id = $1", [recordingId])
    ).rows[0];
    expect(record).toMatchObject({
      origin: "legacy_json",
      id: recordingId,
      watch_target_id: targetIds[0],
      stream_id: null,
      started_at: null,
      finished_at: null,
      legacy_started_at_raw: started,
      legacy_finished_at_raw: finished,
      channel_name: null,
      platform: null,
      quality: null,
    });
    const targets = (
      await pool.query<{
        id: string;
        owner_id: string;
        creator_id: string;
        enabled: boolean;
        quality: string;
      }>("select * from watch_targets order by id")
    ).rows;
    const localId = await database.resolveBootstrapLocalUser();
    for (const table of [
      "creators",
      "watch_targets",
      "streams",
      "recordings",
      "migration_manifests",
    ]) {
      expect(
        (await pool.query<{ owner_id: string }>(`select distinct owner_id from ${table}`)).rows,
      ).toEqual([{ owner_id: localId }]);
    }
    expect(targets.map((row) => row.enabled)).toEqual([true, true, false]);
    expect(targets.map((row) => row.quality)).toEqual(["best", "1080p", "720p"]);
    expect(new Set(targets.map((row) => row.creator_id)).size).toBe(1);
    expect((await importSnapshot(database.connection, snapshot, manifest, true)).outcome).toBe(
      "idempotence-verified",
    );
    expect(
      (await pool.query<{ count: string }>("select count(*) from recordings")).rows[0].count,
    ).toBe("1");
  });

  it("rejects malformed, orphan, collision and open-stream conflicts without DB writes", async () => {
    const watchlist = JSON.parse(await readFile(join(directory, "watchlist.json"), "utf8")) as {
      display_name: string;
    }[];
    watchlist[1].display_name = "EXAMPLE CREATOR";
    await writeFile(join(directory, "watchlist.json"), JSON.stringify(watchlist));
    await writeFile(
      join(directory, "streams.json"),
      JSON.stringify(
        [1, 2].map((number) => ({
          id: `20000000-0000-4000-8000-00000000000${number}`,
          watch_target_id: targetIds[0],
          state: "recording",
          started_at: started,
        })),
      ),
    );
    await writeFile(
      join(directory, "sessions.json"),
      JSON.stringify([
        { session_id: recordingId, channel_id: "missing", state: "bad", started_at: started },
      ]),
    );
    const report = await inspectSnapshot(directory);
    expect(report.errors.join(" ")).toMatch(/ambiguous Creator/);
    expect(report.errors.join(" ")).toMatch(/multiple open/);
    expect(report.errors.join(" ")).toMatch(/orphan/);
    await expect(backup(directory, `${directory}-snapshot`, true)).rejects.toThrow(/validation/);
    expect(
      (await pool.query<{ count: string }>("select count(*) from creators")).rows[0].count,
    ).toBe("0");
  });

  it("rejects drift and conflicting ledger data", async () => {
    await capture();
    const original = await readFile(join(snapshot, "sessions.json"));
    await writeFile(join(snapshot, "sessions.json"), "[]");
    await expect(importSnapshot(database.connection, snapshot, manifest, true)).rejects.toThrow(
      /drift|conflict/,
    );
    expect(
      (await pool.query<{ count: string }>("select count(*) from creators")).rows[0].count,
    ).toBe("0");
    await writeFile(join(snapshot, "sessions.json"), original);
    await importSnapshot(database.connection, snapshot, manifest, true);
    await pool.query<{ [key: string]: unknown }>(
      "update migration_manifests set entity_counts = '{}'::jsonb",
    );
    await expect(importSnapshot(database.connection, snapshot, manifest, true)).rejects.toThrow(
      /ledger conflict/,
    );
  });

  it("rejects changed manifest owner on replay and verification without reassigning data", async () => {
    await capture();
    await importSnapshot(database.connection, snapshot, manifest, true);
    const other = (
      await pool.query<{ id: string }>(
        "insert into users (id,username) values (gen_random_uuid(),'manifest-other') on conflict (username) do update set username=excluded.username returning id",
      )
    ).rows[0].id;
    await pool.query<{ [key: string]: unknown }>("update migration_manifests set owner_id=$1", [
      other,
    ]);
    await expect(importSnapshot(database.connection, snapshot, manifest, true)).rejects.toThrow(
      /ledger conflict/,
    );
    await expect(verifySnapshot(database.connection, snapshot, manifest)).rejects.toThrow(
      /conflicting import ledger/,
    );
    expect(
      (await pool.query<{ owner_id: string }>("select owner_id from migration_manifests")).rows[0]
        .owner_id,
    ).toBe(other);
    expect(
      (await pool.query<{ owner_id: string }>("select owner_id from recordings")).rows[0].owner_id,
    ).toBe(await database.resolveBootstrapLocalUser());
  });

  it("rejects replay and verification when the imported owner mapping changes", async () => {
    await capture();
    await importSnapshot(database.connection, snapshot, manifest, true);
    const other = (
      await pool.query<{ id: string }>(
        "insert into users (id,username) values (gen_random_uuid(),'mapping-other') on conflict (username) do update set username=excluded.username returning id",
      )
    ).rows[0].id;
    const client = await pool.connect();
    try {
      await client.query<{ [key: string]: unknown }>("begin");
      await client.query<{ [key: string]: unknown }>("delete from recordings");
      await client.query<{ [key: string]: unknown }>("delete from streams");
      await client.query<{ [key: string]: unknown }>("delete from watch_targets");
      await client.query<{ [key: string]: unknown }>("update creators set owner_id=$1", [other]);
      await client.query<{ [key: string]: unknown }>("commit");
    } catch (error) {
      await client.query<{ [key: string]: unknown }>("rollback");
      throw error;
    } finally {
      client.release();
    }
    await expect(importSnapshot(database.connection, snapshot, manifest, true)).rejects.toThrow(
      /owner conflict/,
    );
    await expect(verifySnapshot(database.connection, snapshot, manifest)).rejects.toThrow(
      /mismatch/,
    );
    expect(
      (await pool.query<{ owner_id: string }>("select owner_id from creators")).rows[0].owner_id,
    ).toBe(other);
  });

  it("does not treat unrelated owners as conflicting imported identities on replay", async () => {
    await capture();
    await importSnapshot(database.connection, snapshot, manifest, true);
    const other = (
      await pool.query<{ id: string }>(
        "insert into users (id,username) values (gen_random_uuid(),'unrelated-other') on conflict (username) do update set username=excluded.username returning id",
      )
    ).rows[0].id;
    await pool.query<{ [key: string]: unknown }>(
      "insert into creators (id,owner_id,display_name,normalized_key) values (gen_random_uuid(),$1,'Unrelated','unrelated')",
      [other],
    );
    expect((await importSnapshot(database.connection, snapshot, manifest, true)).outcome).toBe(
      "idempotence-verified",
    );
    expect(
      (await pool.query<{ count: string }>("select count(*) from creators")).rows[0].count,
    ).toBe("2");
  });

  it("rolls back all inserts on a late failure and rejects existing destination IDs", async () => {
    await capture();
    await pool.query<{ [key: string]: unknown }>("delete from users where bootstrap_key='local'");
    await pool.query<{ [key: string]: unknown }>(
      "alter table recordings add constraint migration_test_failure check (false) not valid",
    );
    try {
      await expect(importSnapshot(database.connection, snapshot, manifest, true)).rejects.toThrow();
      expect(
        (await pool.query<{ count: string }>("select count(*) from creators")).rows[0].count,
      ).toBe("0");
      expect(
        (await pool.query<{ count: string }>("select count(*) from migration_manifests")).rows[0]
          .count,
      ).toBe("0");
      expect(
        (
          await pool.query<{ count: string }>(
            "select count(*) from users where bootstrap_key='local'",
          )
        ).rows[0].count,
      ).toBe("0");
    } finally {
      await pool.query<{ [key: string]: unknown }>(
        "alter table recordings drop constraint migration_test_failure",
      );
    }
    const other = (
      await pool.query<{ id: string }>(
        "insert into users (id,username) values (gen_random_uuid(),'existing-other') on conflict (username) do update set username=excluded.username returning id",
      )
    ).rows[0].id;
    await pool.query<{ [key: string]: unknown }>(
      "insert into creators (id, owner_id, display_name, normalized_key) values ($1, $2, 'Existing', 'existing')",
      [recordingId, other],
    );
    await expect(importSnapshot(database.connection, snapshot, manifest, true)).rejects.toThrow(
      /Destination conflict/,
    );
    expect(
      (
        await pool.query<{ owner_id: string }>("select owner_id from creators where id=$1", [
          recordingId,
        ])
      ).rows[0].owner_id,
    ).toBe(other);
  });

  it("preserves original JSON before activation and forward state after cutover edits", async () => {
    await capture();
    const before = await readFile(join(directory, "watchlist.json"));
    await importSnapshot(database.connection, snapshot, manifest, true);
    expect(await readFile(join(directory, "watchlist.json"))).toEqual(before);
    const previousMode = process.env.PERSISTENCE_MODE;
    const previousPath = process.env.WATCHLIST_PATH;
    process.env.PERSISTENCE_MODE = "bridge";
    process.env.WATCHLIST_PATH = join(directory, "watchlist.json");
    try {
      const repository = new RelationalStreamsRepository(database);
      await repository.updateWatchTarget(targetIds[0], { enabled: false });
      expect(await readFile(join(directory, "watchlist.json"))).toEqual(before);
      const targets = (
        await pool.query<{ enabled: boolean; quality: string }>(
          "select enabled, quality from watch_targets order by id",
        )
      ).rows;
      expect(targets).toEqual([
        { enabled: false, quality: "best" },
        { enabled: true, quality: "1080p" },
        { enabled: false, quality: "720p" },
      ]);
      await expect(verifySnapshot(database.connection, snapshot, manifest)).rejects.toThrow(
        /mismatch/,
      );
      expect((await importSnapshot(database.connection, snapshot, manifest, true)).outcome).toBe(
        "idempotence-verified",
      );
      expect(
        (
          await pool.query<{ enabled: boolean }>(
            "select enabled from watch_targets where id = $1",
            [targetIds[0]],
          )
        ).rows[0].enabled,
      ).toBe(false);
    } finally {
      if (previousMode === undefined) delete process.env.PERSISTENCE_MODE;
      else process.env.PERSISTENCE_MODE = previousMode;
      if (previousPath === undefined) delete process.env.WATCHLIST_PATH;
      else process.env.WATCHLIST_PATH = previousPath;
    }
  });
});
