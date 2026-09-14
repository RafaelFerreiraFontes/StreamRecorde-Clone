import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { StreamController } from "../streams.controller";
import { StreamerService, SessionService, StreamService } from "../streams.service";
import { StreamsRepository } from "../streams.repository";
import {
  legacyChannelStatus,
  legacySessions,
  legacyWatchlist,
} from "./fixtures/legacy-data";

describe("StreamController", () => {
  let controller: StreamController;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-controller-"));
    process.env.CONFIG_DIR = tempDir;
    process.env.WATCHLIST_PATH = path.join(tempDir, "watchlist.json");
    process.env.CHANNELS_STATUS_PATH = path.join(tempDir, "channels_status.json");
    process.env.SESSIONS_PATH = path.join(tempDir, "sessions.json");

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
      providers: [StreamsRepository, StreamerService, SessionService, StreamService],
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
    process.env.CHANNELS_STATUS_PATH = path.join(tempDir, "channels_status.json");
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

    await fs.writeFile(streamsPath, JSON.stringify(testStreams, null, 2), "utf-8");

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

    await fs.writeFile(streamsPath, JSON.stringify(testStreams, null, 2), "utf-8");

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
    const activeStream = await repo.findActiveStreamByWatchTarget("nonexistent");

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

    await fs.writeFile(streamsPath, JSON.stringify(testStreams, null, 2), "utf-8");

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

    await fs.writeFile(streamsPath, JSON.stringify(testStreams, null, 2), "utf-8");

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
