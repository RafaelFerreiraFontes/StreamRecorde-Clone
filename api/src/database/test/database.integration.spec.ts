import { Pool } from "pg";
import { DatabaseService } from "../database.service";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const creatorId = "00000000-0000-0000-0000-0000000000aa";
const targetOneId = "00000000-0000-0000-0000-0000000000b1";
const targetTwoId = "00000000-0000-0000-0000-0000000000b2";
const streamOneId = "00000000-0000-0000-0000-0000000000c1";
const streamTwoId = "00000000-0000-0000-0000-0000000000c2";

describeDatabase("database foundation", () => {
  const database = new DatabaseService(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await database.migrate();
    await database.migrate();
  });

  beforeEach(async () => {
    await pool.query("truncate recordings, streams, watch_targets, creators");
  });

  afterAll(async () => {
    await pool.end();
    await database.onModuleDestroy();
  });

  async function seedTargets(): Promise<void> {
    await pool.query(
      "insert into creators (id, display_name, normalized_key) values ($1, 'Creator', 'creator')",
      [creatorId],
    );
    await pool.query(
      "insert into watch_targets (id, creator_id, channel_name, platform, url, quality) values ($1, $2, 'one', 'twitch', 'https://example.test/one', 'best'), ($3, $2, 'two', 'youtube', 'https://example.test/two', '1080p')",
      [targetOneId, creatorId, targetTwoId],
    );
  }

  it("applies migrations repeatably and enforces creator/watch target restrictions", async () => {
    await seedTargets();
    await expect(pool.query("delete from creators where id = $1", [creatorId])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query("insert into watch_targets (id, creator_id, channel_name, platform, url, quality) values ('00000000-0000-0000-0000-0000000000b3', $1, 'bad', 'invalid', 'https://example.test', 'best')", [creatorId])).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces stream evidence, chronology, and one active stream per target", async () => {
    await seedTargets();
    await expect(pool.query("insert into streams (id, watch_target_id, state) values ($1, $2, 'recording')", [streamOneId, targetOneId])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("insert into streams (id, watch_target_id, state, started_at, finished_at) values ($1, $2, 'finished', now(), now() - interval '1 second')", [streamOneId, targetOneId])).rejects.toMatchObject({ code: "23514" });
    await pool.query("insert into streams (id, watch_target_id, state, legacy_started_at_raw) values ($1, $2, 'recording', 'legacy-start')", [streamOneId, targetOneId]);
    await expect(pool.query("insert into streams (id, watch_target_id, state, legacy_started_at_raw) values ($1, $2, 'recording', 'second')", [streamTwoId, targetOneId])).rejects.toMatchObject({ code: "23505" });
    await pool.query("update streams set legacy_finished_at_raw = 'legacy-finish' where id = $1", [streamOneId]);
    await expect(pool.query("insert into streams (id, watch_target_id, state, legacy_started_at_raw) values ($1, $2, 'recording', 'second')", [streamTwoId, targetOneId])).resolves.toBeDefined();
  });

  it("enforces recording target consistency while preserving unknown legacy stream links", async () => {
    await seedTargets();
    await pool.query("insert into streams (id, watch_target_id, state, legacy_started_at_raw, legacy_finished_at_raw) values ($1, $2, 'finished', 'start', 'finish')", [streamOneId, targetOneId]);
    await pool.query("insert into streams (id, watch_target_id, state, legacy_started_at_raw, legacy_finished_at_raw) values ($1, $2, 'finished', 'start', 'finish')", [streamTwoId, targetTwoId]);
    await expect(pool.query("insert into recordings (id, watch_target_id, state, legacy_started_at_raw) values ('00000000-0000-0000-0000-0000000000d1', $1, 'finished', 'legacy')", [targetOneId])).resolves.toBeDefined();
    await expect(pool.query("insert into recordings (id, watch_target_id, stream_id, state, started_at) values ('00000000-0000-0000-0000-0000000000d2', $1, $2, 'finished', now())", [targetOneId, streamOneId])).resolves.toBeDefined();
    await expect(pool.query("insert into recordings (id, watch_target_id, stream_id, state, started_at) values ('00000000-0000-0000-0000-0000000000d3', $1, $2, 'finished', now())", [targetOneId, streamTwoId])).rejects.toMatchObject({ code: "23503" });
  });

  it("rolls back failed transactional work", async () => {
    await expect(database.transaction(async (client) => {
      await client.query("insert into creators (id, display_name, normalized_key) values ('00000000-0000-0000-0000-0000000000e1', 'Rolled back', 'rolled-back')");
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