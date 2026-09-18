import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  resolveAllConfigPaths,
  initializeRuntimeFiles,
} from "../json-compatibility.adapters";

describe("resolveAllConfigPaths", () => {
  const localDefaultBase = path.join(process.cwd(), "..", "worker", "config");

  it("config path: CONFIG_DIR produces exact four paths", () => {
    const env = { CONFIG_DIR: "/custom/config" };
    const result = resolveAllConfigPaths(env);

    expect(result.watchlist).toBe("/custom/config/watchlist.json");
    expect(result.channels_status).toBe("/custom/config/channels_status.json");
    expect(result.sessions).toBe("/custom/config/sessions.json");
    expect(result.streams).toBe("/custom/config/streams.json");
  });

  it("config path: four individual overrides win, including different parents", () => {
    const env = {
      WATCHLIST_PATH: "/override1/watchlist.json",
      CHANNELS_STATUS_PATH: "/override2/channels.json",
      SESSIONS_PATH: "/override3/sessions.json",
      STREAMS_PATH: "/override4/streams.json",
    };
    const result = resolveAllConfigPaths(env);

    expect(result.watchlist).toBe("/override1/watchlist.json");
    expect(result.channels_status).toBe("/override2/channels.json");
    expect(result.sessions).toBe("/override3/sessions.json");
    expect(result.streams).toBe("/override4/streams.json");
  });

  it("config path: empty/whitespace individual and CONFIG_DIR fall through to local default", () => {
    const env = {
      WATCHLIST_PATH: "",
      CHANNELS_STATUS_PATH: "   ",
      SESSIONS_PATH: "",
      STREAMS_PATH: "  ",
      CONFIG_DIR: "  ",
    };
    const result = resolveAllConfigPaths(env);

    expect(result.watchlist).toBe(path.join(localDefaultBase, "watchlist.json"));
    expect(result.channels_status).toBe(path.join(localDefaultBase, "channels_status.json"));
    expect(result.sessions).toBe(path.join(localDefaultBase, "sessions.json"));
    expect(result.streams).toBe(path.join(localDefaultBase, "streams.json"));
  });

  it("config path: no env gives existing local defaults", () => {
    const result = resolveAllConfigPaths({});

    expect(result.watchlist).toBe(path.join(localDefaultBase, "watchlist.json"));
    expect(result.channels_status).toBe(path.join(localDefaultBase, "channels_status.json"));
    expect(result.sessions).toBe(path.join(localDefaultBase, "sessions.json"));
    expect(result.streams).toBe(path.join(localDefaultBase, "streams.json"));
  });

  it("config path: individual override takes precedence over CONFIG_DIR", () => {
    const env = {
      WATCHLIST_PATH: "/individual/watch.json",
      CONFIG_DIR: "/config/dir",
    };
    const result = resolveAllConfigPaths(env);

    expect(result.watchlist).toBe("/individual/watch.json");
    expect(result.channels_status).toBe("/config/dir/channels_status.json");
    expect(result.sessions).toBe("/config/dir/sessions.json");
    expect(result.streams).toBe("/config/dir/streams.json");
  });

  it("config path: whitespace in overrides is trimmed", () => {
    const env = {
      WATCHLIST_PATH: "  /spaced/watch.json  ",
      CONFIG_DIR: "  /spaced/config  ",
    };
    const result = resolveAllConfigPaths(env);

    expect(result.watchlist).toBe("/spaced/watch.json");
    expect(result.channels_status).toBe("/spaced/config/channels_status.json");
  });
});

describe("initializeRuntimeFiles", () => {
  it("runtime files: empty dir creates exact shapes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-files-"));
    const paths = {
      watchlist: path.join(tempDir, "watchlist.json"),
      channels_status: path.join(tempDir, "channels_status.json"),
      sessions: path.join(tempDir, "sessions.json"),
      streams: path.join(tempDir, "streams.json"),
    };

    await initializeRuntimeFiles(paths);

    const watchlistContent = await fs.readFile(paths.watchlist, "utf-8");
    const channelsContent = await fs.readFile(paths.channels_status, "utf-8");
    const sessionsContent = await fs.readFile(paths.sessions, "utf-8");
    const streamsContent = await fs.readFile(paths.streams, "utf-8");

    expect(JSON.parse(watchlistContent)).toEqual([]);
    expect(JSON.parse(channelsContent)).toEqual({});
    expect(JSON.parse(sessionsContent)).toEqual([]);
    expect(JSON.parse(streamsContent)).toEqual([]);

    await fs.rm(tempDir, { recursive: true });
  });

  it("runtime files: existing contents byte-for-byte preserved", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-files-preserve-"));
    const watchlistPath = path.join(tempDir, "watchlist.json");
    const existingContent = [{ id: "existing", channel_name: "test" }];
    await fs.writeFile(watchlistPath, JSON.stringify(existingContent, null, 2));

    const paths = {
      watchlist: watchlistPath,
      channels_status: path.join(tempDir, "channels_status.json"),
      sessions: path.join(tempDir, "sessions.json"),
      streams: path.join(tempDir, "streams.json"),
    };

    await initializeRuntimeFiles(paths);

    const watchlistContent = await fs.readFile(watchlistPath, "utf-8");
    expect(JSON.parse(watchlistContent)).toEqual(existingContent);

    await fs.rm(tempDir, { recursive: true });
  });

  it("runtime files: override paths in separate missing parents are created", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-files-nested-"));
    const paths = {
      watchlist: path.join(tempDir, "override1", "watchlist.json"),
      channels_status: path.join(tempDir, "override2", "channels_status.json"),
      sessions: path.join(tempDir, "override3", "sessions.json"),
      streams: path.join(tempDir, "override4", "streams.json"),
    };

    await initializeRuntimeFiles(paths);

    for (const filePath of Object.values(paths)) {
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    }

    await fs.rm(tempDir, { recursive: true });
  });
});
