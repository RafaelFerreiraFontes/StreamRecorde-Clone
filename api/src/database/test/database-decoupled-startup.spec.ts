import type { Server } from "node:http";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppModule } from "../../app.module";
import { DatabaseService } from "../database.service";
import { legacyChannelStatus, legacyWatchlist } from "../../streams/test/fixtures/legacy-data";

describe("Decoupled API bootstrap with PostgreSQL unavailable", () => {
  let app: INestApplication<Server>;
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-decoupled-bootstrap-"));

    // Point JSON configuration to isolated temporary files
    process.env.CONFIG_DIR = tempDir;
    process.env.WATCHLIST_PATH = path.join(tempDir, "watchlist.json");
    process.env.CHANNELS_STATUS_PATH = path.join(tempDir, "channels_status.json");
    process.env.SESSIONS_PATH = path.join(tempDir, "sessions.json");
    process.env.STREAMS_PATH = path.join(tempDir, "streams.json");

    // Explicitly point DATABASE_URL to an unreachable/unavailable target
    process.env.DATABASE_URL =
      "postgresql://streamrecorder:streamrecorder_dev_local@127.0.0.1:1/unavailable_db";

    await fs.writeFile(
      process.env.WATCHLIST_PATH,
      JSON.stringify(legacyWatchlist, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      process.env.CHANNELS_STATUS_PATH,
      JSON.stringify(legacyChannelStatus, null, 2),
      "utf-8",
    );
    await fs.writeFile(process.env.SESSIONS_PATH, JSON.stringify([], null, 2), "utf-8");
    await fs.writeFile(process.env.STREAMS_PATH, JSON.stringify([], null, 2), "utf-8");

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<INestApplication<Server>>();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    process.env = originalEnv;
  });

  it("boots the full NestJS application without requiring an active PostgreSQL connection", () => {
    expect(app).toBeDefined();
  });

  it("serves the /health endpoint successfully while PostgreSQL is offline", async () => {
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body as unknown).toEqual({ status: "ok" });
  });

  it("serves live JSON WatchTargets from watchlist.json while PostgreSQL is offline", async () => {
    const response = await request(app.getHttpServer()).get("/watch-targets");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body as unknown)).toBe(true);
    expect(response.body as unknown).toHaveLength(legacyWatchlist.length);
    expect((response.body as unknown[])[0]).toMatchObject({
      id: "1",
      creator_id: "Streamer 1",
      channel_name: "channel_name",
      platform: "youtube",
      state: "offline",
    });
  });

  it("serves live Creators derived from JSON while PostgreSQL is offline", async () => {
    const response = await request(app.getHttpServer()).get("/creators");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body as unknown)).toBe(true);
    expect(
      (response.body as Record<string, string>[]).map(
        (c: { display_name: string }) => c.display_name,
      ),
    ).toEqual(expect.arrayContaining(["Streamer 1", "Streamer 2"]));
  });

  it("proves DatabaseService is instantiated but fails safely when explicit DB operations are requested", async () => {
    const dbService = app.get(DatabaseService);
    expect(dbService).toBeDefined();

    // Explicit ping fails with sanitized diagnostics, proving the DB is indeed unavailable
    await expect(dbService.ping()).rejects.toThrow("Database connection failed");
    await expect(dbService.ping()).rejects.not.toThrow("streamrecorder_dev_local");
  });
});
