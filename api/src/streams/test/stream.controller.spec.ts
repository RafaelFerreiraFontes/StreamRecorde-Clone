import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { StreamController } from "../streams.controller";
import { StreamerService, SessionService } from "../streams.service";
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
      providers: [StreamsRepository, StreamerService, SessionService],
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
