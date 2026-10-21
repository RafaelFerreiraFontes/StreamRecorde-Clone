import { Pool } from "pg";
import { readFile } from "fs/promises";
import { join } from "path";
import { DatabaseService } from "../database.service";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && (new URL(databaseUrl).pathname !== "/streamrecorder_test" || new URL(databaseUrl).port !== "55432")) {
  throw new Error("Isolated streamrecorder_test database on port 55432 required");
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const creatorId = "00000000-0000-0000-0000-0000000000aa";
const targetOneId = "00000000-0000-0000-0000-0000000000b1";
const targetTwoId = "00000000-0000-0000-0000-0000000000b2";
const streamOneId = "00000000-0000-0000-0000-0000000000c1";
const streamTwoId = "00000000-0000-0000-0000-0000000000c2";

describeDatabase("database foundation", () => {
  const database = new DatabaseService(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  let ownerId: string;

  beforeAll(async () => {
    await database.migrate();
    await database.migrate();
  });

  beforeEach(async () => {
    await pool.query("truncate migration_manifests, worker_events, recordings, streams, watch_targets, creators, sessions, users");
    ownerId = await database.resolveBootstrapLocalUser();
  });

  afterAll(async () => {
    await pool.end();
    await database.onModuleDestroy();
  });

  async function seedTargets(): Promise<void> {
    await pool.query(
      "insert into creators (id, owner_id, display_name, normalized_key) values ($1, $2, 'Creator', 'creator')",
      [creatorId, ownerId],
    );
    await pool.query(
      "insert into watch_targets (id, creator_id, owner_id, channel_name, platform, url, quality) values ($1, $2, $4, 'one', 'twitch', 'https://example.test/one', 'best'), ($3, $2, $4, 'two', 'youtube', 'https://example.test/two', '1080p')",
      [targetOneId, creatorId, targetTwoId, ownerId],
    );
  }

  it("repairs bootstrap concurrently and retains the same passwordless identity across repeated migrations", async () => {
    await pool.query("delete from users where bootstrap_key = 'local'");
    const identities = await Promise.all(Array.from({ length: 12 }, () => database.resolveBootstrapLocalUser()));
    expect(new Set(identities).size).toBe(1);
    await database.migrate();
    expect(await database.resolveBootstrapLocalUser()).toBe(identities[0]);
    expect((await pool.query("select username, password_hash, failed_login_count from users where bootstrap_key='local'")).rows)
      .toEqual([{ username: "local", password_hash: null, failed_login_count: 0 }]);
  });

  it("enforces account uniqueness, username format and session references", async () => {
    await expect(pool.query("insert into users (id,username) values (gen_random_uuid(),'Invalid')"))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("insert into users (id,username) values (gen_random_uuid(),'local')"))
      .rejects.toMatchObject({ code: "23505" });
    await pool.query("insert into users (id,username,email) values (gen_random_uuid(),'other','other@example.test')");
    await expect(pool.query("insert into users (id,username,email) values (gen_random_uuid(),'third','other@example.test')"))
      .rejects.toMatchObject({ code: "23505", constraint: "uq_users_email" });
    await expect(pool.query("insert into users (id,username,email) values (gen_random_uuid(),'mixed','Other@example.test')"))
      .rejects.toMatchObject({ code: "23514", constraint: "users_email_lowercase_check" });
    await pool.query("insert into users (id,username,email) values (gen_random_uuid(),'null-one',NULL), (gen_random_uuid(),'null-two',NULL)");
    expect((await pool.query("select email from users where username in ('null-one','null-two')")).rows)
      .toEqual([{ email: null }, { email: null }]);
    await pool.query("insert into sessions (id,user_id,token_hash,idle_expires_at,absolute_expires_at) values (gen_random_uuid(),$1,'synthetic-hash',now()+interval '1 day',now()+interval '7 days')", [ownerId]);
    await expect(pool.query("insert into sessions (id,user_id,token_hash,idle_expires_at,absolute_expires_at) values (gen_random_uuid(),$1,'synthetic-hash',now(),now())", [ownerId]))
      .rejects.toMatchObject({ code: "23505" });
    await pool.query("delete from users where id=$1", [ownerId]);
    expect((await pool.query("select * from sessions")).rowCount).toBe(0);
  });

  it("rejects cross-owner parent associations and preserves same-owner NULL stream recordings", async () => {
    await seedTargets();
    const other = (await pool.query("insert into users (id,username) values (gen_random_uuid(),'other') returning id")).rows[0].id;
    await expect(pool.query("insert into watch_targets (id,creator_id,owner_id,channel_name,platform,url,quality) values (gen_random_uuid(),$1,$2,'bad','twitch','https://example.test','best')", [creatorId, other]))
      .rejects.toMatchObject({ code: "23503", constraint: "watch_targets_creator_owner_fk" });
    await expect(pool.query("insert into streams (id,watch_target_id,owner_id,state,started_at) values (gen_random_uuid(),$1,$2,'recording',now())", [targetOneId, other]))
      .rejects.toMatchObject({ code: "23503", constraint: "streams_watch_target_owner_fk" });
    await expect(pool.query("insert into recordings (id,watch_target_id,owner_id,state,started_at) values (gen_random_uuid(),$1,$2,'recording',now())", [targetOneId, other]))
      .rejects.toMatchObject({ code: "23503", constraint: "recordings_watch_target_owner_fk" });
    await pool.query("insert into recordings (id,watch_target_id,owner_id,state,started_at) values (gen_random_uuid(),$1,$2,'recording',now())", [targetOneId, ownerId]);
    await expect(pool.query("delete from users where id=$1", [ownerId])).rejects.toMatchObject({ code: "23503" });
    expect((await pool.query("select stream_id, owner_id from recordings")).rows).toEqual([{ stream_id: null, owner_id: ownerId }]);
  });

  it("upgrades populated Wave 05 data without field loss and rolls back a late migration failure", async () => {
    const folder = join(__dirname, "../../../drizzle/migrations");
    const migration = await readFile(join(folder, "0004_user_ownership.sql"), "utf8");
    await database.transaction(async client => {
      await client.query("create schema ownership_upgrade_test");
      await client.query("set local search_path to ownership_upgrade_test");
      for (const name of ["0000_database_foundation", "0001_recording_context", "0002_worker_events", "0003_migration_manifests"]) {
        await client.query(await readFile(join(folder, `${name}.sql`), "utf8"));
      }
      await client.query("insert into creators (id,display_name,normalized_key,archived_at) values ($1,'Archived','archived','2025-01-01T00:00:00Z')", [creatorId]);
      await client.query("insert into watch_targets (id,creator_id,channel_name,platform,url,quality,enabled,recording_subdir,archived_at) values ($1,$2,'old','twitch','https://example.test/old','720p',false,'private/old','2025-01-01T00:00:00Z')", [targetOneId, creatorId]);
      await client.query("insert into streams (id,watch_target_id,state,legacy_started_at_raw,legacy_finished_at_raw) values ($1,$2,'finished','2024-01-01T01:02:03.123456','raw-finish')", [streamOneId, targetOneId]);
      await client.query("insert into recordings (id,watch_target_id,state,legacy_started_at_raw,output_file,channel_name,platform,quality) values (gen_random_uuid(),$1,'finished','raw-start','private/old.mp4','old','twitch','720p')", [targetOneId]);
      await client.query("insert into migration_manifests (id,manifest_fingerprint,source_digests,entity_counts,tool_version) values (gen_random_uuid(),'old-fingerprint','{}','{}','legacy-json-v1')");
      const tables = ["creators", "watch_targets", "streams", "recordings", "migration_manifests"];
      const before: { rows: unknown[] }[] = [];
      for (const table of tables) before.push(await client.query(`select to_jsonb(row) as data from ${table} row order by id`));
      await client.query("savepoint before_upgrade");
      await expect(client.query(`${migration}\nSELECT 1/0;`)).rejects.toMatchObject({ code: "22012" });
      await client.query("rollback to savepoint before_upgrade");
      expect((await client.query("select to_regclass('ownership_upgrade_test.users') as relation")).rows[0].relation).toBeNull();
      for (const [position, table] of tables.entries()) {
        expect((await client.query(`select to_jsonb(row) as data from ${table} row order by id`)).rows).toEqual(before[position].rows);
      }
      await client.query(migration);
      const localId = await database.resolveBootstrapLocalUser(client);
      for (const [position, table] of tables.entries()) {
        expect((await client.query(`select to_jsonb(row) - 'owner_id' as data from ${table} row order by id`)).rows).toEqual(before[position].rows);
        expect((await client.query(`select distinct owner_id from ${table}`)).rows).toEqual([{ owner_id: localId }]);
      }
      expect((await client.query("select count(*) from users")).rows[0].count).toBe("1");
      await client.query("drop schema ownership_upgrade_test cascade");
    });
  });

  it("applies migrations repeatably and enforces creator/watch target restrictions", async () => {
    await seedTargets();
    await expect(pool.query("delete from creators where id = $1", [creatorId])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query("insert into watch_targets (id, creator_id, owner_id, channel_name, platform, url, quality) values ('00000000-0000-0000-0000-0000000000b3', $1, $2, 'bad', 'invalid', 'https://example.test', 'best')", [creatorId, ownerId])).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces stream evidence, chronology, and one active stream per target", async () => {
    await seedTargets();
    await expect(pool.query("insert into streams (id, watch_target_id, owner_id, state) values ($1, $2, $3, 'recording')", [streamOneId, targetOneId, ownerId])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("insert into streams (id, watch_target_id, owner_id, state, started_at, finished_at) values ($1, $2, $3, 'finished', now(), now() - interval '1 second')", [streamOneId, targetOneId, ownerId])).rejects.toMatchObject({ code: "23514" });
    await pool.query("insert into streams (id, watch_target_id, owner_id, state, legacy_started_at_raw) values ($1, $2, $3, 'recording', 'legacy-start')", [streamOneId, targetOneId, ownerId]);
    await expect(pool.query("insert into streams (id, watch_target_id, owner_id, state, legacy_started_at_raw) values ($1, $2, $3, 'recording', 'second')", [streamTwoId, targetOneId, ownerId])).rejects.toMatchObject({ code: "23505" });
    await pool.query("update streams set legacy_finished_at_raw = 'legacy-finish' where id = $1", [streamOneId]);
    await expect(pool.query("insert into streams (id, watch_target_id, owner_id, state, legacy_started_at_raw) values ($1, $2, $3, 'recording', 'second')", [streamTwoId, targetOneId, ownerId])).resolves.toBeDefined();
  });

  it("enforces recording target consistency while preserving unknown legacy stream links", async () => {
    await seedTargets();
    await pool.query("insert into streams (id, watch_target_id, owner_id, state, legacy_started_at_raw, legacy_finished_at_raw) values ($1, $2, $3, 'finished', 'start', 'finish')", [streamOneId, targetOneId, ownerId]);
    await pool.query("insert into streams (id, watch_target_id, owner_id, state, legacy_started_at_raw, legacy_finished_at_raw) values ($1, $2, $3, 'finished', 'start', 'finish')", [streamTwoId, targetTwoId, ownerId]);
    await expect(pool.query("insert into recordings (id, watch_target_id, owner_id, state, legacy_started_at_raw) values ('00000000-0000-0000-0000-0000000000d1', $1, $2, 'finished', 'legacy')", [targetOneId, ownerId])).resolves.toBeDefined();
    await expect(pool.query("insert into recordings (id, watch_target_id, stream_id, owner_id, state, started_at) values ('00000000-0000-0000-0000-0000000000d2', $1, $2, $3, 'finished', now())", [targetOneId, streamOneId, ownerId])).resolves.toBeDefined();
    await expect(pool.query("insert into recordings (id, watch_target_id, stream_id, owner_id, state, started_at) values ('00000000-0000-0000-0000-0000000000d3', $1, $2, $3, 'finished', now())", [targetOneId, streamTwoId, ownerId])).rejects.toMatchObject({ code: "23503" });
  });

  it("rolls back failed transactional work", async () => {
    await expect(database.transaction(async (client) => {
      const localId = await database.resolveBootstrapLocalUser(client);
      await client.query("insert into creators (id, owner_id, display_name, normalized_key) values ('00000000-0000-0000-0000-0000000000e1', $1, 'Rolled back', 'rolled-back')", [localId]);
      throw new Error("force rollback");
    })).rejects.toThrow("force rollback");
    await expect(pool.query("select id from creators where id = '00000000-0000-0000-0000-0000000000e1'")).resolves.toMatchObject({ rowCount: 0 });
  });

  it("sanitizes connection URLs and parameters", () => {
    const diagnostic = database.sanitizeError(new Error("connection failed for postgresql://user:secret@example.test:5432/streamrecorder?sslmode=require password=another-secret host=example.test dbname=streamrecorder"));
    expect(diagnostic).toContain("postgresql://***");
    expect(diagnostic).not.toContain("secret");
    expect(diagnostic).not.toContain("example.test");
    expect(diagnostic).not.toContain("streamrecorder");
  });

  it("sanitizes hostname-only connection failures", () => {
    const diagnostic = database.sanitizeError(
      new Error("getaddrinfo ENOTFOUND private-db.example.com"),
    );

    expect(diagnostic).toContain("ENOTFOUND [redacted-host]");
    expect(diagnostic).not.toContain("private-db.example.com");
  });

  it("reports unavailable connection operations without credentials or targets", async () => {
    const unavailable = new DatabaseService("postgresql://user:secret@127.0.0.1:1/unavailable");
    try {
      await unavailable.ping();
    } catch (error) {
      expect(error).toHaveProperty("message", expect.stringContaining("Database connection failed"));
      expect(error).not.toHaveProperty("message", expect.stringContaining("secret"));
      expect(error).not.toHaveProperty("message", expect.stringContaining("127.0.0.1"));
      expect(error).not.toHaveProperty("message", expect.stringContaining("unavailable"));
      expect(error).not.toHaveProperty("message", expect.stringContaining("postgresql://"));
    }
    try {
      await unavailable.transaction(async () => undefined);
    } catch (error) {
      expect(error).toHaveProperty("message", expect.stringContaining("Database transaction failed"));
      expect(error).not.toHaveProperty("message", expect.stringContaining("secret"));
      expect(error).not.toHaveProperty("message", expect.stringContaining("127.0.0.1"));
      expect(error).not.toHaveProperty("message", expect.stringContaining("unavailable"));
      expect(error).not.toHaveProperty("message", expect.stringContaining("postgresql://"));
    } finally {
      await unavailable.onModuleDestroy();
    }
  });
});