import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { StreamController } from "../streams.controller";
import {
  RecordingService,
  StreamerService,
  SessionService,
  StreamService,
} from "../streams.service";
import { StreamsRepository } from "../streams.repository";
import { WatchTargetJsonAdapter } from "../json-compatibility.adapters";
import {
  legacyChannelStatus,
  legacySessions,
  legacyWatchlist,
} from "./fixtures/legacy-data";

const originalEnv = { ...process.env };

describe("StreamController", () => {
  let controller: StreamController;

  beforeEach(async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "stream-controller-"),
    );
    process.env.CONFIG_DIR = tempDir;
    process.env.WATCHLIST_PATH = path.join(tempDir, "watchlist.json");
    process.env.CHANNELS_STATUS_PATH = path.join(
      tempDir,
      "channels_status.json",
    );
    process.env.SESSIONS_PATH = path.join(tempDir, "sessions.json");
    process.env.STREAMS_PATH = path.join(tempDir, "streams.json");

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
    await fs.writeFile(
      process.env.SESSIONS_PATH,
      JSON.stringify(legacySessions, null, 2),
      "utf-8",
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StreamController],
      providers: [
        StreamsRepository,
        StreamerService,
        SessionService,
        StreamService,
        RecordingService,
      ],
    }).compile();

    controller = module.get<StreamController>(StreamController);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should group multiple watch targets under the same creator", async () => {
    const repo = new StreamsRepository();

    const watchlistPath = process.env.WATCHLIST_PATH;
    if (!watchlistPath) {
      throw new Error("WATCHLIST_PATH is not configured");
    }

    await fs.writeFile(
      watchlistPath,
      JSON.stringify(
        [
          {
            id: "watch-target-1",
            display_name: "ExampleCreator",
            channel_name: "example1",
            platform: "twitch",
            url: "https://www.twitch.tv/example1",
            quality: "best",
          },
          {
            id: "watch-target-2",
            display_name: "ExampleCreator",
            channel_name: "example2",
            platform: "youtube",
            url: "https://www.youtube.com/@example2",
            quality: "1080p",
          },
          {
            id: "watch-target-3",
            display_name: "OtherCreator",
            channel_name: "other",
            platform: "kick",
            url: "https://kick.com/other",
            quality: "720p",
          },
        ],
        null,
        2,
      ),
      "utf-8",
    );

    const creators = await repo.findAllCreators();
    expect(creators).toEqual([
      {
        id: "ExampleCreator",
        display_name: "ExampleCreator",
      },
      {
        id: "OtherCreator",
        display_name: "OtherCreator",
      },
    ]);

    const watchTargets = await repo.findWatchTargetsByCreator("ExampleCreator");
    expect(watchTargets).toEqual([
      {
        id: "watch-target-1",
        creator_id: "ExampleCreator",
        channel_name: "example1",
        platform: "twitch",
        url: "https://www.twitch.tv/example1",
        quality: "best",
        enabled: true,
        state: "idle",
      },
      {
        id: "watch-target-2",
        creator_id: "ExampleCreator",
        channel_name: "example2",
        platform: "youtube",
        url: "https://www.youtube.com/@example2",
        quality: "1080p",
        enabled: true,
        state: "idle",
      },
    ]);
  });

  it("should expose domain creator and watch target routes", async () => {
    await expect(controller.getAllCreators()).resolves.toEqual([
      { id: "Streamer 1", display_name: "Streamer 1" },
      { id: "Streamer 2", display_name: "Streamer 2" },
    ]);
    await expect(controller.getCreator("Streamer 1")).resolves.toEqual({
      id: "Streamer 1",
      display_name: "Streamer 1",
    });
    await expect(
      controller.getCreatorWatchTargets("Streamer 1"),
    ).resolves.toHaveLength(1);
    await expect(controller.getAllWatchTargets()).resolves.toHaveLength(2);
    await expect(controller.getWatchTarget("1")).resolves.toMatchObject({
      id: "1",
      creator_id: "Streamer 1",
      enabled: true,
    });
    await expect(controller.getWatchTarget("missing")).rejects.toThrow(
      "not found",
    );
  });

  it("should persist created watch targets through the Worker-compatible adapter", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "New Creator",
      channel_name: "new-channel",
      platform: "twitch",
      url: "https://twitch.tv/new-channel",
      quality: "720p",
    });
    const watchlistPath = process.env.WATCHLIST_PATH;
    if (!watchlistPath) throw new Error("WATCHLIST_PATH is not configured");

    expect(target).toMatchObject({
      creator_id: "New Creator",
      channel_name: "new-channel",
      enabled: true,
      state: "idle",
    });
    await expect(
      WatchTargetJsonAdapter.read(watchlistPath),
    ).resolves.toContainEqual({
      id: target.id,
      display_name: "New Creator",
      channel_name: "new-channel",
      platform: "twitch",
      url: "https://twitch.tv/new-channel",
      quality: "720p",
    });
  });

  it("should delete only the requested watch target", async () => {
    await controller.deleteWatchTarget("1");
    await expect(controller.getAllWatchTargets()).resolves.toEqual([
      expect.objectContaining({ id: "2" }),
    ]);
    await expect(controller.deleteWatchTarget("missing")).rejects.toThrow(
      "not found",
    );
  });

  it("should resolve streams by stream identity rather than watch target identity", async () => {
    const streamsPath = process.env.STREAMS_PATH;
    if (!streamsPath) throw new Error("STREAMS_PATH is not configured");
    await fs.writeFile(
      streamsPath,
      JSON.stringify([
        {
          id: "stream-1",
          watch_target_id: "1",
          state: "recording",
          started_at: "2026-09-14T00:00:00.000Z",
        },
      ]),
      "utf-8",
    );

    await expect(controller.getAllStreams()).resolves.toHaveLength(1);
    await expect(controller.getStream("stream-1")).resolves.toMatchObject({
      id: "stream-1",
    });
    await expect(controller.getStream("1")).rejects.toThrow("not found");
  });

  it("should expose recordings without legacy channel_id and filter by watch target", async () => {
    const recordings = await controller.getAllRecordings({
      watchTargetId: "1",
    });

    expect(recordings).toHaveLength(3);
    expect(recordings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session_id: "1", watch_target_id: "1" }),
      ]),
    );
    for (const recording of recordings) {
      expect(recording).not.toHaveProperty("channel_id");
      expect(recording).not.toHaveProperty("stream_id");
    }
    await expect(controller.getRecording("1")).resolves.toMatchObject({
      session_id: "1",
      watch_target_id: "1",
    });
    await expect(controller.getRecording("missing")).rejects.toThrow();
  });

  it("should get all streamers", async () => {
    const streamers = await controller.getAllStreamers();
    expect(streamers).toEqual([
      {
        id: "1",
        display_name: "Streamer 1",
        channel_name: "channel_name",
        platform: "youtube",
        url: "https://www.youtube.com/watch?v=1",
        quality: "1080p",
        state: "offline",
      },
      {
        id: "2",
        display_name: "Streamer 2",
        channel_name: "channel_name",
        platform: "youtube",
        url: "https://www.youtube.com/watch?v=2",
        quality: "1080p",
        state: "offline",
      },
    ]);
  });

  it("should get one streamer", async () => {
    const streamer = await controller.getStreamer("1");
    expect(streamer).toEqual({
      id: "1",
      display_name: "Streamer 1",
      channel_name: "channel_name",
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=1",
      quality: "1080p",
      state: "offline",
    });
  });

  it("should create a streamer", async () => {
    const expectedStreamer = {
      id: "3",
      display_name: "Streamer 3",
      channel_name: "channel_name",
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=3",
      quality: "1080p",
      state: "offline",
    };
    const createStreamer = jest
      .spyOn(StreamerService.prototype, "createStreamer")
      .mockResolvedValue(expectedStreamer);

    const streamer = await controller.createStreamer({
      display_name: "Streamer 3",
      channel_name: "channel_name",
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=3",
      quality: "1080p",
    });

    expect(streamer).toEqual(expectedStreamer);
    createStreamer.mockRestore();
  });

  it("should delete a streamer", async () => {
    const streamer = await controller.deleteStreamer("1");
    expect(streamer).toEqual(undefined);
  });

  it("should get all sessions", async () => {
    const sessions = await controller.getAllSessions();
    expect(sessions).toEqual([
      {
        session_id: "1",
        channel_id: "1",
        channel_name: "channel_name",
        platform: "youtube",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
      {
        session_id: "2",
        channel_id: "2",
        channel_name: "channel_name",
        platform: "youtube",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
      {
        session_id: "3",
        channel_id: "1",
        channel_name: "channel_name",
        platform: "youtube",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
      {
        session_id: "5",
        channel_id: "1",
        channel_name: "channel_name",
        platform: "youtube",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
    ]);
  });

  it("should get one session", async () => {
    const session = await controller.getSession("1");
    expect(session).toEqual({
      session_id: "1",
      channel_id: "1",
      channel_name: "channel_name",
      platform: "youtube",
      started_at: "2022-01-01T00:00:00.000Z",
      finished_at: "2022-01-01T00:00:00.000Z",
      output_file: "output.mp4",
      state: "idle",
    });
  });

  it("should map legacy sessions to independent recordings with session_id identity", async () => {
    const repo = new StreamsRepository();
    const recordings = await repo.findAllRecordings();

    expect(recordings).toEqual([
      {
        session_id: "1",
        watch_target_id: "1",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
      {
        session_id: "2",
        watch_target_id: "2",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
      {
        session_id: "3",
        watch_target_id: "1",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
      {
        session_id: "5",
        watch_target_id: "1",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
    ]);

    for (const recording of recordings) {
      expect(recording).not.toHaveProperty("recording_id");
      expect(recording).not.toHaveProperty("channel_id");
      expect(recording).not.toHaveProperty("platform");
      expect(recording).not.toHaveProperty("stream_id");
    }
  });

  it("should preserve recording lifecycle fields and map channel_id explicitly", async () => {
    const repo = new StreamsRepository();
    const sessionsPath = process.env.SESSIONS_PATH;
    if (!sessionsPath) {
      throw new Error("SESSIONS_PATH is not configured");
    }

    await fs.writeFile(
      sessionsPath,
      JSON.stringify(
        [
          {
            session_id: "finished-session",
            channel_id: "watch-target-1",
            started_at: "2026-09-06T00:00:00.000Z",
            finished_at: "2026-09-06T01:00:00.000Z",
            output_file: "finished.mp4",
            state: "finished",
          },
          {
            session_id: "error-session",
            channel_id: "watch-target-1",
            started_at: "2026-09-06T02:00:00.000Z",
            finished_at: null,
            output_file: null,
            state: "error",
          },
        ],
        null,
        2,
      ),
      "utf-8",
    );

    const recordings = await repo.findRecordingsByWatchTarget("watch-target-1");
    expect(recordings).toEqual([
      {
        session_id: "finished-session",
        watch_target_id: "watch-target-1",
        started_at: "2026-09-06T00:00:00.000Z",
        finished_at: "2026-09-06T01:00:00.000Z",
        output_file: "finished.mp4",
        state: "finished",
      },
      {
        session_id: "error-session",
        watch_target_id: "watch-target-1",
        started_at: "2026-09-06T02:00:00.000Z",
        state: "error",
      },
    ]);
  });

  it("should enrich the legacy SessionDto without persisting channel metadata", async () => {
    const repo = new StreamsRepository();
    const session = await repo.findOneSession("1");

    expect(session).toEqual({
      session_id: "1",
      channel_id: "1",
      channel_name: "channel_name",
      platform: "youtube",
      started_at: "2022-01-01T00:00:00.000Z",
      finished_at: "2022-01-01T00:00:00.000Z",
      output_file: "output.mp4",
      state: "idle",
    });
  });

  it("should get a one session by channel", async () => {
    const session = await controller.getSessionByChannel("1");
    expect(session).toEqual([
      {
        session_id: "1",
        channel_id: "1",
        channel_name: "channel_name",
        platform: "youtube",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
      {
        session_id: "3",
        channel_id: "1",
        channel_name: "channel_name",
        platform: "youtube",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
      {
        session_id: "5",
        channel_id: "1",
        channel_name: "channel_name",
        platform: "youtube",
        started_at: "2022-01-01T00:00:00.000Z",
        finished_at: "2022-01-01T00:00:00.000Z",
        output_file: "output.mp4",
        state: "idle",
      },
    ]);
  });

  it("should forward the channel route parameter to the session service", async () => {
    const findSessionsByChannel = jest
      .spyOn(SessionService.prototype, "findSessionsByChannel")
      .mockResolvedValue([]);

    await controller.getSessionByChannel("channel-id");

    expect(findSessionsByChannel).toHaveBeenCalledWith("channel-id");
  });
});

describe("StreamRepository", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-repo-"));
    process.env.CONFIG_DIR = tempDir;
    process.env.WATCHLIST_PATH = path.join(tempDir, "watchlist.json");
    process.env.CHANNELS_STATUS_PATH = path.join(
      tempDir,
      "channels_status.json",
    );
    process.env.SESSIONS_PATH = path.join(tempDir, "sessions.json");
    process.env.STREAMS_PATH = path.join(tempDir, "streams.json");

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
    await fs.writeFile(
      process.env.SESSIONS_PATH,
      JSON.stringify(legacySessions, null, 2),
      "utf-8",
    );
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
  });

  it("should read streams from streams.json", async () => {
    const streamsPath = process.env.STREAMS_PATH;
    if (!streamsPath) {
      throw new Error("STREAMS_PATH is not configured");
    }

    const testStreams = [
      {
        id: "stream-1",
        watch_target_id: "1",
        state: "recording",
        started_at: "2026-09-14T00:00:00.000Z",
        finished_at: null,
      },
      {
        id: "stream-2",
        watch_target_id: "1",
        state: "finished",
        started_at: "2026-09-13T00:00:00.000Z",
        finished_at: "2026-09-13T01:00:00.000Z",
      },
    ];

    await fs.writeFile(
      streamsPath,
      JSON.stringify(testStreams, null, 2),
      "utf-8",
    );

    const repo = new StreamsRepository();
    const streams = await repo.findAllStreams();

    expect(streams).toEqual(testStreams);
  });

  it("should find active stream by watch target id", async () => {
    const streamsPath = process.env.STREAMS_PATH;
    if (!streamsPath) {
      throw new Error("STREAMS_PATH is not configured");
    }

    const testStreams = [
      {
        id: "stream-1",
        watch_target_id: "1",
        state: "recording",
        started_at: "2026-09-14T00:00:00.000Z",
        finished_at: null,
      },
      {
        id: "stream-2",
        watch_target_id: "1",
        state: "finished",
        started_at: "2026-09-13T00:00:00.000Z",
        finished_at: "2026-09-13T01:00:00.000Z",
      },
    ];

    await fs.writeFile(
      streamsPath,
      JSON.stringify(testStreams, null, 2),
      "utf-8",
    );

    const repo = new StreamsRepository();
    const activeStream = await repo.findActiveStreamByWatchTarget("1");

    expect(activeStream).toEqual(testStreams[0]);
  });

  it("should return null when no active stream exists", async () => {
    const streamsPath = process.env.STREAMS_PATH;
    if (!streamsPath) {
      throw new Error("STREAMS_PATH is not configured");
    }

    await fs.writeFile(streamsPath, JSON.stringify([], null, 2), "utf-8");

    const repo = new StreamsRepository();
    const activeStream =
      await repo.findActiveStreamByWatchTarget("nonexistent");

    expect(activeStream).toBeNull();
  });

  it("should filter streams by watch target and time window", async () => {
    const streamsPath = process.env.STREAMS_PATH;
    if (!streamsPath) {
      throw new Error("STREAMS_PATH is not configured");
    }

    const testStreams = [
      {
        id: "stream-1",
        watch_target_id: "1",
        state: "recording",
        started_at: "2026-09-14T00:00:00.000Z",
        finished_at: null,
      },
      {
        id: "stream-2",
        watch_target_id: "1",
        state: "finished",
        started_at: "2026-09-13T00:00:00.000Z",
        finished_at: "2026-09-13T01:00:00.000Z",
      },
      {
        id: "stream-3",
        watch_target_id: "2",
        state: "finished",
        started_at: "2026-09-14T00:00:00.000Z",
        finished_at: "2026-09-14T01:00:00.000Z",
      },
    ];

    await fs.writeFile(
      streamsPath,
      JSON.stringify(testStreams, null, 2),
      "utf-8",
    );

    const repo = new StreamsRepository();

    const allStreams = await repo.findStreamsByWatchTarget("1");
    expect(allStreams).toHaveLength(2);

    const recentStreams = await repo.findStreamsByWatchTarget(
      "1",
      "2026-09-13T12:00:00.000Z",
    );
    expect(recentStreams).toHaveLength(1);
    expect(recentStreams[0].id).toBe("stream-1");
  });

  it("should not have channel_id in stream records", async () => {
    const streamsPath = process.env.STREAMS_PATH;
    if (!streamsPath) {
      throw new Error("STREAMS_PATH is not configured");
    }

    const testStreams = [
      {
        id: "stream-1",
        watch_target_id: "1",
        state: "recording",
        started_at: "2026-09-14T00:00:00.000Z",
        finished_at: null,
      },
    ];

    await fs.writeFile(
      streamsPath,
      JSON.stringify(testStreams, null, 2),
      "utf-8",
    );

    const repo = new StreamsRepository();
    const streams = await repo.findAllStreams();

    for (const stream of streams) {
      expect(stream).not.toHaveProperty("channel_id");
      expect(stream).not.toHaveProperty("channel_name");
      expect(stream).not.toHaveProperty("platform");
      expect(stream).not.toHaveProperty("url");
    }
  });
});

describe("JSON compatibility adapters", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-adapter-"));
  });

  it("uses an empty default only when the watchlist is missing", async () => {
    const watchlistPath = path.join(tempDir, "watchlist.json");
    await expect(WatchTargetJsonAdapter.read(watchlistPath)).resolves.toEqual(
      [],
    );

    await fs.writeFile(watchlistPath, "{", "utf-8");
    await expect(WatchTargetJsonAdapter.read(watchlistPath)).rejects.toThrow(
      SyntaxError,
    );
  });

  it("atomically replaces the watchlist without leaving temporary files", async () => {
    const watchlistPath = path.join(tempDir, "watchlist.json");
    await fs.writeFile(watchlistPath, "[]", "utf-8");
    const watchlist = [
      {
        id: "watch-target-1",
        channel_name: "example",
        platform: "twitch",
        url: "https://twitch.tv/example",
        quality: "best",
      },
    ];

    await WatchTargetJsonAdapter.write(watchlistPath, watchlist);

    await expect(WatchTargetJsonAdapter.read(watchlistPath)).resolves.toEqual(
      watchlist,
    );
    expect(
      (await fs.readdir(tempDir)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
});

describe("recording_subdir path validation", () => {
  let tempDir: string;
  let controller: StreamController;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recording-subdir-"));
    process.env.CONFIG_DIR = tempDir;
    process.env.WATCHLIST_PATH = path.join(tempDir, "watchlist.json");
    process.env.CHANNELS_STATUS_PATH = path.join(tempDir, "channels_status.json");
    process.env.SESSIONS_PATH = path.join(tempDir, "sessions.json");
    process.env.STREAMS_PATH = path.join(tempDir, "streams.json");
    await fs.writeFile(process.env.WATCHLIST_PATH, "[]", "utf-8");
    await fs.writeFile(process.env.CHANNELS_STATUS_PATH, "{}", "utf-8");
    await fs.writeFile(process.env.SESSIONS_PATH, "[]", "utf-8");
    await fs.writeFile(process.env.STREAMS_PATH, "[]", "utf-8");

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StreamController],
      providers: [
        StreamsRepository,
        StreamerService,
        SessionService,
        StreamService,
        RecordingService,
      ],
    }).compile();

    controller = module.get<StreamController>(StreamController);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should create watch target with recording_subdir and persist normalized", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
      recording_subdir: "favorites/twitch",
    });

    expect(target.recording_subdir).toBe("favorites/twitch");

    const watchlistPath = process.env.WATCHLIST_PATH!;
    const persisted = await WatchTargetJsonAdapter.read(watchlistPath);
    expect(persisted[0].recording_subdir).toBe("favorites/twitch");
  });

  it("should create watch target with simple nested path", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
      recording_subdir: "a/b/c",
    });

    expect(target.recording_subdir).toBe("a/b/c");
  });

  it("should persist watch target without recording_subdir field when absent", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
    });

    expect(target.recording_subdir).toBeUndefined();

    const watchlistPath = process.env.WATCHLIST_PATH!;
    const persisted = await WatchTargetJsonAdapter.read(watchlistPath);
    expect(persisted[0]).not.toHaveProperty("recording_subdir");
  });

  it("should reject POSIX absolute path /etc/passwd", async () => {
    await expect(
      controller.createWatchTarget({
        creator_id: "Creator1",
        channel_name: "channel1",
        platform: "twitch",
        url: "https://twitch.tv/channel1",
        quality: "best",
        recording_subdir: "/etc/passwd",
      }),
    ).rejects.toThrow();
  });

  it("should reject traversal ../etc", async () => {
    await expect(
      controller.createWatchTarget({
        creator_id: "Creator1",
        channel_name: "channel1",
        platform: "twitch",
        url: "https://twitch.tv/channel1",
        quality: "best",
        recording_subdir: "../etc",
      }),
    ).rejects.toThrow();
  });

  it("should reject traversal with ./", async () => {
    await expect(
      controller.createWatchTarget({
        creator_id: "Creator1",
        channel_name: "channel1",
        platform: "twitch",
        url: "https://twitch.tv/channel1",
        quality: "best",
        recording_subdir: "a/../etc",
      }),
    ).rejects.toThrow();
  });

  it("should reject Windows drive letter C:\\windows", async () => {
    await expect(
      controller.createWatchTarget({
        creator_id: "Creator1",
        channel_name: "channel1",
        platform: "twitch",
        url: "https://twitch.tv/channel1",
        quality: "best",
        recording_subdir: "C:\\windows\\system32",
      }),
    ).rejects.toThrow();
  });

  it("should reject UNC path", async () => {
    await expect(
      controller.createWatchTarget({
        creator_id: "Creator1",
        channel_name: "channel1",
        platform: "twitch",
        url: "https://twitch.tv/channel1",
        quality: "best",
        recording_subdir: "\\\\server\\share",
      }),
    ).rejects.toThrow();
  });

  it("should reject null byte injection", async () => {
    await expect(
      controller.createWatchTarget({
        creator_id: "Creator1",
        channel_name: "channel1",
        platform: "twitch",
        url: "https://twitch.tv/channel1",
        quality: "best",
        recording_subdir: "valid\x00path",
      }),
    ).rejects.toThrow();
  });

  it("should reject control character", async () => {
    await expect(
      controller.createWatchTarget({
        creator_id: "Creator1",
        channel_name: "channel1",
        platform: "twitch",
        url: "https://twitch.tv/channel1",
        quality: "best",
        recording_subdir: "valid\x01path",
      }),
    ).rejects.toThrow();
  });

  it("should normalize backslashes to forward slashes", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
      recording_subdir: "favorites\\twitch\\pixelcarvel",
    });

    expect(target.recording_subdir).toBe("favorites/twitch/pixelcarvel");
  });

  it("should normalize multiple slashes", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
      recording_subdir: "favorites///twitch///channel",
    });

    expect(target.recording_subdir).toBe("favorites/twitch/channel");
  });

  it("should strip trailing slashes", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
      recording_subdir: "favorites/twitch/",
    });

    expect(target.recording_subdir).toBe("favorites/twitch");
  });

  it("should reject path exceeding 255 characters", async () => {
    const longPath = "a".repeat(256);
    await expect(
      controller.createWatchTarget({
        creator_id: "Creator1",
        channel_name: "channel1",
        platform: "twitch",
        url: "https://twitch.tv/channel1",
        quality: "best",
        recording_subdir: longPath,
      }),
    ).rejects.toThrow();
  });

  it("should PATCH recording_subdir with valid nested path", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
    });
    expect(target.recording_subdir).toBeUndefined();

    const updated = await controller.patchWatchTarget(target.id, {
      recording_subdir: "new/path",
    });
    expect(updated.recording_subdir).toBe("new/path");

    const persisted = await WatchTargetJsonAdapter.read(process.env.WATCHLIST_PATH!);
    expect(persisted[0].recording_subdir).toBe("new/path");
  });

  it("should PATCH with empty string to clear recording_subdir", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
      recording_subdir: "existing/path",
    });

    const updated = await controller.patchWatchTarget(target.id, {
      recording_subdir: "",
    });
    expect(updated.recording_subdir).toBeUndefined();

    const persisted = await WatchTargetJsonAdapter.read(process.env.WATCHLIST_PATH!);
    expect(persisted[0]).not.toHaveProperty("recording_subdir");
  });

  it("should reject PATCH with traversal pattern", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
    });

    await expect(
      controller.patchWatchTarget(target.id, { recording_subdir: "../etc" }),
    ).rejects.toThrow();
  });

  it("should reject PATCH with absolute path", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
    });

    await expect(
      controller.patchWatchTarget(target.id, { recording_subdir: "/absolute" }),
    ).rejects.toThrow();
  });

  it("should PATCH non-existent watch target with 404", async () => {
    await expect(
      controller.patchWatchTarget("nonexistent-id", { recording_subdir: "path" }),
    ).rejects.toThrow("not found");
  });

  it("should preserve existing recording_subdir when PATCH field is omitted", async () => {
    const target = await controller.createWatchTarget({
      creator_id: "Creator1",
      channel_name: "channel1",
      platform: "twitch",
      url: "https://twitch.tv/channel1",
      quality: "best",
      recording_subdir: "original/path",
    });

    const updated = await controller.patchWatchTarget(target.id, {});
    expect(updated.recording_subdir).toBe("original/path");
  });

  it("should read recording_subdir from existing watchlist", async () => {
    const watchlistPath = process.env.WATCHLIST_PATH!;
    await fs.writeFile(
      watchlistPath,
      JSON.stringify([
        {
          id: "existing-1",
          display_name: "Creator1",
          channel_name: "channel1",
          platform: "twitch",
          url: "https://twitch.tv/channel1",
          quality: "best",
          recording_subdir: "read/path",
        },
      ]),
      "utf-8",
    );

    const target = await controller.getWatchTarget("existing-1");
    expect(target.recording_subdir).toBe("read/path");
  });
});
