import { Test, TestingModule } from "@nestjs/testing";
import { StreamController } from "../streams.controller";
import { StreamerService, SessionService } from "../streams.service";
import { StreamsRepository } from "../streams.repository";

describe("StreamController", () => {
  let controller: StreamController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StreamController],
      providers: [StreamsRepository, StreamerService, SessionService],
    }).compile();

    controller = module.get<StreamController>(StreamController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
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
    const streamer = await controller.createStreamer({
      id: "3",
      display_name: "Streamer 3",
      channel_name: "channel_name",
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=3",
      quality: "1080p",
      state: "offline",
    });
    expect(streamer).toEqual({
      id: "3",
      display_name: "Streamer 3",
      channel_name: "channel_name",
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=3",
      quality: "1080p",
      state: "offline",
    });
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
});
