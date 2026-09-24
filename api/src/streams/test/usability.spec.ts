import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { StreamsModule } from "../streams.module";
import { RecordingsFilesystemService } from "../recordings-filesystem.service";

describe("Wave 04.5 HTTP and persistence", () => {
  let app: INestApplication;
  let directory: string;
  let root: string;
  let browser: RecordingsFilesystemService;
  const originalEnv = { ...process.env };
  const target = {
    id: "target",
    display_name: "Creator",
    channel_name: "channel",
    platform: "twitch",
    url: "https://example.invalid/channel",
    quality: "720p",
    recording_subdir: "twitch/channel",
    custom: "preserved",
  };

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "wave045-"));
    root = path.join(directory, "recordings");
    await fs.mkdir(path.join(root, "twitch", "channel"), { recursive: true });
    await fs.writeFile(
      path.join(root, "twitch", "channel", "video.mp4"),
      "fixture",
    );
    await fs.writeFile(path.join(root, ".env"), "SECRET");
    process.env.CONFIG_DIR = directory;
    process.env.RECORDINGS_ROOT = root;
    for (const key of [
      "WATCHLIST_PATH",
      "CHANNELS_STATUS_PATH",
      "SESSIONS_PATH",
      "STREAMS_PATH",
    ])
      delete process.env[key];
    await fs.writeFile(
      path.join(directory, "watchlist.json"),
      JSON.stringify([target, { ...target, id: "sibling", enabled: false }]),
    );
    await fs.writeFile(path.join(directory, "channels_status.json"), "{}");
    await fs.writeFile(path.join(directory, "streams.json"), "[]");
    await fs.writeFile(
      path.join(directory, "sessions.json"),
      JSON.stringify([
        {
          session_id: "existing",
          channel_id: "target",
          started_at: "2026-01-01",
          state: "finished",
          output_file: path.join(root, "twitch", "channel", "video.mp4"),
        },
        {
          session_id: "missing",
          channel_id: "target",
          started_at: "2026-01-01",
          state: "finished",
          output_file: path.join(root, "twitch", "channel", "missing.mp4"),
        },
        {
          session_id: "outside",
          channel_id: "target",
          started_at: "2026-01-01",
          state: "finished",
          output_file: path.join(directory, "watchlist.json"),
        },
      ]),
    );
    const module = await Test.createTestingModule({
      imports: [StreamsModule],
    }).compile();
    browser = module.get(RecordingsFilesystemService);
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    process.env = { ...originalEnv };
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("defaults legacy enabled; toggles both ways and preserves every unrelated field and sibling", async () => {
    const server = app.getHttpServer();
    expect(
      (await request(server).get("/watch-targets/target").expect(200)).body
        .enabled,
    ).toBe(true);
    expect(
      (await request(server).get("/watch-targets/sibling").expect(200)).body
        .enabled,
    ).toBe(false);
    for (const enabled of [false, true]) {
      expect(
        (
          await request(server)
            .patch("/watch-targets/target")
            .send({ enabled })
            .expect(200)
        ).body.enabled,
      ).toBe(enabled);
      expect(
        (await request(server).get("/watch-targets/target").expect(200)).body,
      ).toMatchObject({
        enabled,
        creator_id: "Creator",
        quality: "720p",
        platform: "twitch",
        channel_name: "channel",
        url: target.url,
        recording_subdir: target.recording_subdir,
      });
      const stored = JSON.parse(
        await fs.readFile(path.join(directory, "watchlist.json"), "utf8"),
      );
      expect(stored).toEqual([
        { ...target, enabled },
        { ...target, id: "sibling", enabled: false },
      ]);
    }
  });

  it("updates both fields together; rejects invalid payloads without partial writes", async () => {
    const server = app.getHttpServer();
    for (const enabled of [null, 0, 1, "false", [], {}]) {
      await request(server)
        .patch("/watch-targets/target")
        .send({ enabled, recording_subdir: "new" })
        .expect(400);
    }
    await request(server)
      .patch("/watch-targets/target")
      .send({ enabled: false, recording_subdir: "../escape" })
      .expect(400);
    await request(server)
      .patch("/watch-targets/target")
      .send({ quality: "worst" })
      .expect(400);
    expect(
      JSON.parse(
        await fs.readFile(path.join(directory, "watchlist.json"), "utf8"),
      )[0],
    ).toEqual(target);
    const updated = await request(server)
      .patch("/watch-targets/target")
      .send({ enabled: false, recording_subdir: "new/folder" })
      .expect(200);
    expect(updated.body).toMatchObject({
      enabled: false,
      recording_subdir: "new/folder",
      quality: "720p",
    });
  });

  it("lists only safe metadata; resolves recording IDs and missing files without leaking host paths", async () => {
    const server = app.getHttpServer();
    const listing = (
      await request(server).get("/recordings/filesystem").expect(200)
    ).body;
    expect(listing).toEqual({
      path: "",
      entries: [{ name: "twitch", path: "twitch", kind: "directory" }],
    });
    const location = (
      await request(server).get("/recordings/existing/location").expect(200)
    ).body;
    expect(location).toMatchObject({
      status: "available",
      file: "video.mp4",
      directory: { path: "twitch/channel" },
    });
    expect(JSON.stringify(location)).not.toContain(root);
    expect(
      (await request(server).get("/recordings/missing/location").expect(200))
        .body.status,
    ).toBe("file_not_found");
    expect(
      (await request(server).get("/recordings/outside/location").expect(200))
        .body,
    ).toEqual({ status: "directory_unavailable" });
    await request(server).get("/recordings/unknown/location").expect(404);
    await fs.rm(path.join(root, "twitch"), { recursive: true });
    expect(
      (await request(server).get("/recordings/existing/location").expect(200))
        .body.status,
    ).toBe("directory_unavailable");
  });

  it.each([
    "../",
    "../../",
    "..\\..\\",
    "/etc",
    "C:\\Windows",
    "C:/Windows",
    "C:relative",
    "a/..\\b",
    "a/../b",
    "%2e%2e/",
    "%252e%252e/",
    "a//b",
    ".env",
    "a/.hidden",
    "\\\\server\\share",
    "a\0b",
    "a/.. /b",
    "a/b.",
    "a:b",
  ])("rejects unsafe path %p", async (value) => {
    const response = await request(app.getHttpServer())
      .get("/recordings/filesystem")
      .query({ path: value })
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain(root);
  });

  it("rejects symlink/junction traversal and omits links from listings", async () => {
    const outside = path.join(directory, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret"), "secret");
    await fs.symlink(
      outside,
      path.join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      (await browser.list()).entries.some((entry) => entry.name === "escape"),
    ).toBe(false);
    await expect(browser.list("escape")).rejects.toThrow(
      "Recording directory unavailable",
    );
    expect(await browser.location(path.join(root, "escape", "secret"))).toEqual(
      { status: "directory_unavailable" },
    );
  });

  it("supports root-relative stored metadata and safe unavailable errors", async () => {
    expect(await browser.location("twitch/channel/video.mp4")).toMatchObject({
      status: "available",
    });
    expect(await browser.location("../watchlist.json")).toEqual({
      status: "directory_unavailable",
    });
    await request(app.getHttpServer())
      .get("/recordings/filesystem")
      .query({ path: "missing" })
      .expect(404);
    await request(app.getHttpServer())
      .get("/recordings/filesystem")
      .query({ path: ["a", "b"] })
      .expect(400);
  });
});
