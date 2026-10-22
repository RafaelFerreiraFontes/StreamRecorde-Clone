import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Pool } from "pg";
import { DatabaseService } from "../../database/database.service";
import { RelationalStreamsRepository } from "../relational-streams.repository";
import { StreamsRepository } from "../streams.repository";
import { RecordingService, StreamerService } from "../streams.service";
import { RecordingsFilesystemController } from "../recordings-filesystem.controller";
import { RecordingsFilesystemService } from "../recordings-filesystem.service";
import { CreateCreatorDto, PatchCreatorDto } from "../dto/creator.dto";
import { WatchTargetJsonAdapter } from "../json-compatibility.adapters";
import { StreamsModule } from "../streams.module";

const databaseUrl = process.env.RELATIONAL_TEST_DATABASE_URL;
if (databaseUrl && new URL(databaseUrl).pathname !== "/streamrecorder_test") {
  throw new Error("Relational tests require the isolated streamrecorder_test database");
}
const describeDatabase = databaseUrl ? describe : describe.skip;

describe("Creator DTO validation", () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

  it("trims names and rejects blank, null and non-string values", async () => {
    for (const metatype of [CreateCreatorDto, PatchCreatorDto]) {
      for (const display_name of [" ", null, 42]) {
        await expect(
          pipe.transform({ display_name }, { type: "body", metatype }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(
        pipe.transform({ display_name: " Name " }, { type: "body", metatype }),
      ).resolves.toMatchObject({ display_name: "Name" });
    }
    await expect(
      pipe.transform({}, { type: "body", metatype: CreateCreatorDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({}, { type: "body", metatype: PatchCreatorDto })).resolves.toEqual(
      {},
    );
  });

  it("does not enable independent Creator mutations in JSON mode", async () => {
    await expect(new StreamsRepository().createCreator({ display_name: "Name" })).rejects.toThrow(
      "require relational storage",
    );
  });
});

describeDatabase("relational configuration persistence", () => {
  let database: DatabaseService;
  let pool: Pool;
  let repository: RelationalStreamsRepository;
  let service: StreamerService;
  let directory: string;
  const environment = { ...process.env };

  beforeAll(async () => {
    database = new DatabaseService(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
    await database.migrate();
  });

  beforeEach(async () => {
    await pool.query<{ [key: string]: unknown }>(
      "truncate recordings, streams, watch_targets, creators",
    );
    directory = await mkdtemp(join(tmpdir(), "streamrecorder-relational-"));
    process.env.CONFIG_DIR = directory;
    for (const key of ["WATCHLIST_PATH", "CHANNELS_STATUS_PATH", "STREAMS_PATH", "SESSIONS_PATH"])
      delete process.env[key];
    repository = new RelationalStreamsRepository(database);
    service = new StreamerService(repository);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    process.env = { ...environment };
    await rm(directory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await pool?.end();
    await database?.onModuleDestroy();
  });

  async function target(creator_id: string, quality = "best") {
    return service.createWatchTarget({
      creator_id,
      channel_name: "channel",
      platform: "twitch",
      url: "https://example.test/channel",
      quality,
      recording_subdir: "captures/channel",
    });
  }

  it("keeps Creator UUID and target relationships stable through rename and archive", async () => {
    const creator = await repository.createCreator({ display_name: " Creator " });
    expect(creator).toEqual({ id: expect.any(String) as unknown, display_name: "Creator" });
    expect(await repository.findOneCreator(" CREATOR ")).toEqual(creator);
    const first = await target(creator.id);
    await expect(repository.removeCreator(creator.id)).rejects.toThrow("active watch targets");
    expect(await repository.updateCreator(creator.id, { display_name: "Renamed" })).toEqual({
      ...creator,
      display_name: "Renamed",
    });
    expect((await repository.findOneWatchTarget(first.id)).creator_id).toBe(creator.id);
    await expect(repository.findOneCreator("Creator")).rejects.toBeInstanceOf(NotFoundException);
    expect(await repository.findWatchTargetsByCreator("renamed")).toHaveLength(1);
    expect(
      (
        JSON.parse(await readFile(join(directory, "watchlist.json"), "utf8")) as {
          display_name: string;
        }[]
      )[0].display_name,
    ).toBe("Renamed");
    await repository.removeWatchTarget(first.id);
    await repository.removeCreator(creator.id);
    await expect(repository.findOneCreator(creator.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(
      (
        await pool.query<{ archived_at: Date | null }>(
          "select archived_at from creators where id=$1",
          [creator.id],
        )
      ).rows[0].archived_at,
    ).toBeInstanceOf(Date);
    expect(
      (
        await pool.query<{ creator_id: string }>(
          "select creator_id from watch_targets where id=$1",
          [first.id],
        )
      ).rows[0].creator_id,
    ).toBe(creator.id);
  });

  it("reports ambiguous names without merging identities and supports UUID disambiguation", async () => {
    const first = await repository.createCreator({ display_name: "Same" });
    const second = await repository.createCreator({ display_name: " same " });
    expect(first.id).not.toBe(second.id);
    await expect(repository.findOneCreator("same")).rejects.toBeInstanceOf(ConflictException);
    await expect(target("same")).rejects.toBeInstanceOf(ConflictException);
    expect((await target(first.id)).creator_id).toBe(first.id);
    await expect(target(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("preserves three siblings, PATCH omission/clear, statuses and lossless Worker projection", async () => {
    const creator = await repository.createCreator({ display_name: "Siblings" });
    const first = await target(creator.id, "best");
    const second = await target(creator.id, "1080p");
    const third = await target(creator.id, "720p");
    expect([first, second, third].every((item) => item.enabled)).toBe(true);
    const edited = await service.updateWatchTarget(first.id, {
      quality: "480p",
      url: "https://example.test/new",
    });
    expect(edited.recording_subdir).toBe("captures/channel");
    expect(await repository.findOneWatchTarget(second.id)).toEqual(second);
    expect(await repository.findOneWatchTarget(third.id)).toEqual(third);
    await service.updateWatchTarget(second.id, { enabled: false });
    expect(await repository.findOneWatchTarget(first.id)).toEqual(edited);
    expect(await repository.findOneWatchTarget(third.id)).toEqual(third);
    await service.updateWatchTarget(first.id, { recording_subdir: "" });
    expect((await repository.findOneWatchTarget(first.id)).recording_subdir).toBeUndefined();
    expect(
      (
        await pool.query<{ recording_subdir: string }>(
          "select recording_subdir from watch_targets where id=$1",
          [first.id],
        )
      ).rows[0].recording_subdir,
    ).toBeNull();
    await repository.removeWatchTarget(third.id);
    await expect(repository.findOneWatchTarget(third.id)).rejects.toBeInstanceOf(NotFoundException);
    const entries = await WatchTargetJsonAdapter.read(join(directory, "watchlist.json"));
    expect(entries).toHaveLength(2);
    expect(entries.find((item) => item.id === first.id)).toEqual({
      id: first.id,
      display_name: "Siblings",
      channel_name: "channel",
      platform: "twitch",
      quality: "480p",
      url: "https://example.test/new",
      enabled: true,
    });
    expect(entries.find((item) => item.id === second.id)).toMatchObject({
      enabled: false,
      quality: "1080p",
      recording_subdir: "captures/channel",
    });
    const workerRead = spawnSync(
      process.env.PYTHON ?? "python",
      [
        "-c",
        "import json,sys; from json_adapters import WatchTargetJsonAdapter; print(json.dumps(WatchTargetJsonAdapter.read(sys.argv[1])))",
        join(directory, "watchlist.json"),
      ],
      { cwd: join(process.cwd(), "../worker"), encoding: "utf8" },
    );
    expect(workerRead.error).toBeUndefined();
    expect(workerRead.status).toBe(0);
    expect(JSON.parse(workerRead.stdout) as unknown[]).toEqual(entries);
    await writeFile(
      join(directory, "channels_status.json"),
      JSON.stringify({ [first.id]: { state: "recording" } }),
    );
    expect((await repository.findOneWatchTarget(first.id)).state).toBe("recording");
  });

  it("supports existing name-based creation and legacy Streamer contracts", async () => {
    const first = await target("New Creator");
    const second = await target("new creator", "720p");
    expect(first.creator_id).toBe(second.creator_id);
    const legacy = await repository.createStreamer({
      display_name: "New Creator",
      channel_name: "legacy",
      platform: "twitch",
      url: "https://example.test/legacy",
      quality: "best",
    });
    expect(legacy).toEqual({
      id: expect.any(String) as unknown,
      display_name: "New Creator",
      channel_name: "legacy",
      platform: "twitch",
      url: "https://example.test/legacy",
      quality: "best",
      state: "idle",
    });
    expect(await repository.findOneStreamer(legacy.id)).toEqual(legacy);
    expect(await repository.findAllStreamer()).toHaveLength(3);
    await repository.removeStreamer(legacy.id);
    expect(await repository.findAllWatchTargets()).toHaveLength(2);
  });

  it("reports committed projection failure and reconciles without repeating the mutation", async () => {
    const first = await target("Projection");
    const projection = jest
      .spyOn(WatchTargetJsonAdapter, "write")
      .mockRejectedValue(new Error("private/path"));
    await expect(service.updateWatchTarget(first.id, { enabled: false })).rejects.toThrow(
      "Database committed but watchlist projection failed",
    );
    expect((await repository.findOneWatchTarget(first.id)).enabled).toBe(false);
    projection.mockRestore();
    await repository.reprojectWatchlist();
    expect((await WatchTargetJsonAdapter.read(join(directory, "watchlist.json")))[0].enabled).toBe(
      false,
    );
  });

  it("retains configuration and relational history after reconnect without reading JSON", async () => {
    const first = await target("Restart");
    const history = await repository.createStreamAndRecording({
      watchTargetId: first.id,
      stream: { startedAt: "2026-01-01T00:00:00Z" },
      recording: { startedAt: "2026-01-01T00:00:00Z" },
    });
    await writeFile(join(directory, "streams.json"), "invalid JSON");
    await writeFile(join(directory, "sessions.json"), "invalid JSON");
    const restartedDatabase = new DatabaseService(databaseUrl);
    try {
      const restarted = new RelationalStreamsRepository(restartedDatabase);
      expect(await restarted.findOneWatchTarget(first.id)).toEqual(first);
      expect(await restarted.findOneCreator(first.creator_id)).toMatchObject({
        display_name: "Restart",
      });
      expect(await restarted.findAllStreams()).toEqual([history.stream]);
      expect(await restarted.findAllRecordings()).toEqual([history.recording]);
    } finally {
      await restartedDatabase.onModuleDestroy();
    }
  });

  it("reuses one active Stream concurrently and preserves distinct attempts and later broadcasts", async () => {
    const first = await target("Lifecycle");
    const input = { watchTargetId: first.id, startedAt: "2026-01-01T12:00:00+02:00" };
    const otherRepository = new RelationalStreamsRepository(database);
    const observations = await Promise.all([
      repository.createStream(input),
      otherRepository.createStream(input),
      repository.createStream(input),
    ]);
    const stream = observations[0];
    expect(observations.every((item) => item.id === stream.id)).toBe(true);
    expect(stream.started_at).toBe("2026-01-01T10:00:00.000Z");
    expect(await repository.findOneStream(stream.id)).toEqual(stream);
    expect(await repository.findActiveStreamByWatchTarget(first.id)).toEqual(stream);
    const attempt = await repository.createRecording({
      ...input,
      sessionId: randomUUID(),
      streamId: stream.id,
    });
    await repository.finalizeRecording(attempt.session_id, {
      state: "error",
      finishedAt: "2026-01-01T11:00:00Z",
    });
    const retry = await repository.createRecording({ ...input, streamId: stream.id });
    expect(retry.session_id).not.toBe(attempt.session_id);
    expect(await repository.findRecordingsByWatchTarget(first.id)).toHaveLength(2);
    const terminal = await repository.finalizeRecordingAndStream({
      recordingId: retry.session_id,
      streamId: stream.id,
      recordingFinishedAt: "2026-01-01T12:00:00Z",
      streamFinishedAt: "2026-01-01T12:01:00Z",
    });
    expect(terminal.recording.state).toBe("finished");
    expect(terminal.stream?.finished_at).toBe("2026-01-01T12:01:00.000Z");
    expect(await repository.findActiveStreamByWatchTarget(first.id)).toBeNull();
    const later = await repository.createStream({
      ...input,
      startedAt: new Date("2026-01-02T00:00:00Z"),
    });
    expect(later.id).not.toBe(stream.id);
    expect(await repository.findStreamsByWatchTarget(first.id)).toHaveLength(2);
    expect(await repository.findStreamsByWatchTarget(first.id, "2026-01-02T00:00:00Z")).toEqual([
      later,
    ]);
    expect(await repository.findAllStreams()).toHaveLength(2);
  });

  it("rejects cross-target links at the repository and composite FK boundaries", async () => {
    const first = await target("Links");
    const sibling = await target(first.creator_id, "720p");
    const startedAt = "2026-01-01T00:00:00Z";
    const stream = await repository.createStream({ watchTargetId: sibling.id, startedAt });
    await expect(
      repository.createRecording({ watchTargetId: first.id, streamId: stream.id, startedAt }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pool.query<{ [key: string]: unknown }>(
        "insert into recordings (id,watch_target_id,stream_id,state,started_at,owner_id) values ($1,$2,$3,'recording',$4,(select owner_id from watch_targets where id=$2))",
        [randomUUID(), first.id, stream.id, startedAt],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      repository.createRecording({ watchTargetId: first.id, streamId: randomUUID(), startedAt }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const unknown = await repository.createRecording({
      watchTargetId: first.id,
      streamId: null,
      startedAt,
    });
    expect(unknown.stream_id).toBeUndefined();
    expect(
      (
        await pool.query<{ stream_id: string }>("select stream_id from recordings where id=$1", [
          unknown.session_id,
        ])
      ).rows[0].stream_id,
    ).toBeNull();
  });

  it("rejects foreign-owner Creator attachment and derives capture ownership from the locked target", async () => {
    const other = (
      await pool.query<{ id: string }>(
        "insert into users (id,username) values (gen_random_uuid(),$1) returning id",
        [`other-${randomUUID().slice(0, 8)}`],
      )
    ).rows[0].id;
    const creatorId = randomUUID();
    const targetId = randomUUID();
    await pool.query<{ [key: string]: unknown }>(
      "insert into creators (id,owner_id,display_name,normalized_key) values ($1,$2,'Foreign','foreign')",
      [creatorId, other],
    );
    await expect(target(creatorId)).rejects.toBeInstanceOf(NotFoundException);
    await pool.query<{ [key: string]: unknown }>(
      "insert into watch_targets (id,owner_id,creator_id,channel_name,platform,url,quality) values ($1,$2,$3,'foreign','twitch','https://example.test/foreign','720p')",
      [targetId, other, creatorId],
    );
    const capture = await repository.createStreamAndRecording({
      watchTargetId: targetId,
      stream: { startedAt: "2026-01-01T00:00:00Z" },
      recording: { startedAt: "2026-01-01T00:00:00Z" },
    });
    expect(
      (
        await pool.query<{ owner_id: string }>("select owner_id from streams where id=$1", [
          capture.stream.id,
        ])
      ).rows[0].owner_id,
    ).toBe(other);
    expect(
      (
        await pool.query<{ owner_id: string }>("select owner_id from recordings where id=$1", [
          capture.recording.session_id,
        ])
      ).rows[0].owner_id,
    ).toBe(other);
    const local = await target("Local");
    await expect(
      repository.createRecording({
        watchTargetId: local.id,
        streamId: capture.stream.id,
        startedAt: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await repository.findAllRecordings()).toEqual([]);
    expect(await repository.findAllRecordings(other)).toEqual([capture.recording]);
  });

  it("rolls back combined creation and terminal changes when the second operation fails", async () => {
    const first = await target("Atomic");
    const startedAt = "2026-01-01T00:00:00Z";
    await expect(
      repository.createStreamAndRecording({
        watchTargetId: first.id,
        stream: { startedAt },
        recording: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await repository.findAllStreams()).toEqual([]);
    expect(await repository.findAllRecordings()).toEqual([]);
    const created = await repository.createStreamAndRecording({
      watchTargetId: first.id,
      stream: { startedAt },
      recording: { startedAt, outputFile: "captures/output.mp4" },
    });
    await expect(
      repository.finalizeRecordingAndStream({
        recordingId: created.recording.session_id,
        streamId: created.stream.id,
        recordingFinishedAt: "2026-01-01T01:00:00Z",
        streamFinishedAt: "2025-01-01T00:00:00Z",
      }),
    ).rejects.toThrow();
    expect(await repository.findOneRecording(created.recording.session_id)).toEqual(
      created.recording,
    );
    expect(await repository.findOneStream(created.stream.id)).toEqual(created.stream);
    await expect(
      repository.finalizeRecordingAndStream({
        recordingId: created.recording.session_id,
        streamId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await repository.findOneRecording(created.recording.session_id)).toEqual(
      created.recording,
    );
    await expect(
      repository.createStreamAndRecording({
        watchTargetId: first.id,
        stream: { startedAt },
        recording: { id: created.recording.session_id, startedAt },
      }),
    ).rejects.toThrow();
    expect(await repository.findAllRecordings()).toHaveLength(1);
    expect(await repository.findActiveStreamByWatchTarget(first.id)).toEqual(created.stream);
  });

  it("preserves snapshots, IDs, session mappings and files through target edits and archive", async () => {
    const first = await target("Snapshots");
    const startedAt = "2026-01-01T00:00:00Z";
    const created = await repository.createStreamAndRecording({
      watchTargetId: first.id,
      stream: { startedAt },
      recording: { startedAt, outputFile: "captures/output.mp4" },
    });
    const sibling = await target(first.creator_id, "720p");
    await repository.createRecording({ watchTargetId: sibling.id, startedAt });
    await repository.updateWatchTarget(first.id, { quality: "480p" });
    await pool.query<{ [key: string]: unknown }>(
      "update watch_targets set channel_name='renamed', platform='youtube' where id=$1",
      [first.id],
    );
    expect(await repository.findOneRecording(created.recording.session_id)).toMatchObject({
      channel_name: "channel",
      platform: "twitch",
      quality: "best",
    });
    process.env.RECORDINGS_ROOT = join(directory, "media");
    await mkdir(join(directory, "media", "captures"), { recursive: true });
    await writeFile(join(directory, "media", "captures", "output.mp4"), "owned test fixture");
    const controller = new RecordingsFilesystemController(
      new RecordingsFilesystemService(),
      new RecordingService(repository),
    );
    await repository.removeWatchTarget(first.id);
    await repository.removeWatchTarget(sibling.id);
    await repository.removeCreator(first.creator_id);
    expect(await repository.findOneRecording(created.recording.session_id)).toEqual(
      created.recording,
    );
    const session = await repository.findOneSession(created.recording.session_id);
    expect(session).toMatchObject({
      session_id: created.recording.session_id,
      channel_id: first.id,
      channel_name: "channel",
      platform: "twitch",
      started_at: "2026-01-01T00:00:00.000Z",
    });
    expect(await repository.findSessionsByChannel(first.id)).toEqual([session]);
    expect(await repository.findAllSessions()).toHaveLength(2);
    expect(await controller.location(created.recording.session_id)).toEqual({
      status: "available",
      file: "output.mp4",
      directory: {
        path: "captures",
        entries: [{ name: "output.mp4", path: "captures/output.mp4", kind: "file" }],
      },
    });
    expect(await readFile(join(directory, "media", "captures", "output.mp4"), "utf8")).toBe(
      "owned test fixture",
    );
    await expect(
      repository.createStream({ watchTargetId: first.id, startedAt }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      repository.createRecording({ watchTargetId: first.id, startedAt }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("keeps legacy timestamp evidence unchanged and requires timezone-aware new Stream and Recording starts", async () => {
    const first = await target("Timestamps");
    const raw = "2026-01-01T10:00:00";
    await expect(
      repository.createStream({ watchTargetId: first.id, legacyStartedAtRaw: raw }),
    ).rejects.toEqual(new BadRequestException("startedAt is required"));
    const streamId = randomUUID();
    await pool.query<{ [key: string]: unknown }>(
      "insert into streams (id,watch_target_id,state,legacy_started_at_raw,legacy_finished_at_raw,owner_id) values ($1,$2,'finished',$3,$4,(select owner_id from watch_targets where id=$2))",
      [streamId, first.id, raw, "2026-01-01T11:00:00"],
    );
    const stream = await repository.findOneStream(streamId);
    expect(stream.started_at).toBe(raw);
    expect(stream.finished_at).toBe("2026-01-01T11:00:00");
    expect(await repository.findActiveStreamByWatchTarget(first.id)).toBeNull();
    const later = await repository.createStream({
      watchTargetId: first.id,
      startedAt: "2026-01-02T00:00:00Z",
    });
    expect(later.id).not.toBe(stream.id);
    const legacyId = randomUUID();
    await pool.query<{ [key: string]: unknown }>(
      "insert into recordings (id,watch_target_id,state,legacy_started_at_raw,legacy_finished_at_raw,owner_id) values ($1,$2,'finished',$3,$4,(select owner_id from watch_targets where id=$2))",
      [legacyId, first.id, raw, "2026-01-01T11:00:00"],
    );
    expect(await repository.findOneRecording(legacyId)).toMatchObject({
      session_id: legacyId,
      started_at: raw,
      finished_at: "2026-01-01T11:00:00",
      stream_id: undefined,
    });
    expect(await repository.findOneSession(legacyId)).toMatchObject({
      started_at: raw,
      platform: "twitch",
      channel_name: "channel",
    });
    for (const startedAt of [raw, "not-a-dateZ", new Date(NaN)]) {
      await expect(
        repository.createRecording({ watchTargetId: first.id, startedAt }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        repository.createStream({ watchTargetId: first.id, startedAt }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      repository.createRecording({ watchTargetId: first.id, legacyStartedAtRaw: raw }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(repository.createStream({ watchTargetId: first.id })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    for (const id of [randomUUID(), "invalid"]) {
      await expect(repository.findOneStream(id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(repository.findOneRecording(id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(repository.findOneSession(id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(repository.finalizeStream(id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(repository.finalizeRecording(id)).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it("serves modern and legacy relational history and watchTargetId filters over HTTP", async () => {
    const first = await target("HTTP History");
    const sibling = await target(first.creator_id, "720p");
    const startedAt = "2026-01-01T00:00:00Z";
    const created = await repository.createStreamAndRecording({
      watchTargetId: first.id,
      stream: { startedAt },
      recording: { startedAt },
    });
    await repository.createRecording({ watchTargetId: sibling.id, startedAt });
    process.env.RELATIONAL_STORAGE = "true";
    const httpDatabase = new DatabaseService(databaseUrl);
    const module = await Test.createTestingModule({ imports: [StreamsModule] })
      .overrideProvider(DatabaseService)
      .useValue(httpDatabase)
      .compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    await app.init();
    try {
      const server = app.getHttpServer();
      expect((await request(server).get("/streams").expect(200)).body as unknown).toHaveLength(1);
      expect(
        (
          (await request(server).get(`/streams/${created.stream.id}`).expect(200)).body as {
            id: unknown;
          }
        ).id,
      ).toBe(created.stream.id);
      expect((await request(server).get("/recordings").expect(200)).body as unknown).toHaveLength(
        2,
      );
      expect(
        (await request(server).get(`/recordings?watchTargetId=${first.id}`).expect(200))
          .body as unknown,
      ).toHaveLength(1);
      expect(
        (
          (await request(server).get(`/recordings/${created.recording.session_id}`).expect(200))
            .body as { stream_id: unknown }
        ).stream_id,
      ).toBe(created.stream.id);
      expect((await request(server).get("/session").expect(200)).body as unknown).toHaveLength(2);
      expect(
        (
          (await request(server).get(`/session/${created.recording.session_id}`).expect(200))
            .body as { channel_id: unknown }
        ).channel_id,
      ).toBe(first.id);
      expect(
        (await request(server).get(`/session/channel/${first.id}`).expect(200)).body as unknown,
      ).toHaveLength(1);
      await request(server).get(`/recordings/${randomUUID()}`).expect(404);
      await request(server).get(`/streams/${randomUUID()}`).expect(404);
    } finally {
      await app.close();
    }
  });

  it("fails relational history reads and writes explicitly without JSON fallback on DB outage", async () => {
    const unavailable = new DatabaseService(
      "postgresql://test:test@127.0.0.1:1/streamrecorder_test",
    );
    const offline = new RelationalStreamsRepository(unavailable);
    await writeFile(join(directory, "streams.json"), "[]");
    await writeFile(join(directory, "sessions.json"), "[]");
    try {
      for (const operation of [
        () => offline.findAllStreams(),
        () => offline.findAllRecordings(),
        () => offline.findAllSessions(),
        () => offline.createStream({ watchTargetId: randomUUID(), startedAt: new Date() }),
        () => offline.createRecording({ watchTargetId: randomUUID(), startedAt: new Date() }),
        () => offline.finalizeRecording(randomUUID()),
        () => offline.finalizeStream(randomUUID()),
      ]) {
        await expect(operation()).rejects.toThrow();
      }
      expect(await readFile(join(directory, "streams.json"), "utf8")).toBe("[]");
      expect(await readFile(join(directory, "sessions.json"), "utf8")).toBe("[]");
    } finally {
      await unavailable.onModuleDestroy();
    }
  });

  it("rejects invalid configuration without changing persisted targets", async () => {
    const first = await target("Validation");
    for (const patch of [
      { enabled: "false" },
      { quality: "invalid" },
      { url: "https://user:secret@example.test" },
      { recording_subdir: "../escape" },
    ]) {
      await expect(service.updateWatchTarget(first.id, patch as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(await repository.findOneWatchTarget(first.id)).toEqual(first);
  });

  it("selects relational mode through Nest and validates Creator and target HTTP mutations", async () => {
    process.env.RELATIONAL_STORAGE = "true";
    const httpDatabase = new DatabaseService(databaseUrl);
    const module = await Test.createTestingModule({ imports: [StreamsModule] })
      .overrideProvider(DatabaseService)
      .useValue(httpDatabase)
      .compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    try {
      expect(module.get(StreamsRepository)).toBeInstanceOf(RelationalStreamsRepository);
      const server = app.getHttpServer();
      await request(server).post("/creators").send({ display_name: " " }).expect(400);
      const { body: creator } = (await request(server)
        .post("/creators")
        .send({ display_name: " HTTP " })
        .expect(201)) as { body: { id: string } };
      const payload = {
        creator_id: creator.id,
        channel_name: "channel",
        platform: "twitch",
        url: "https://example.test/channel",
        quality: "best",
      };
      for (const invalid of [
        { quality: "invalid" },
        { platform: "invalid" },
        { url: "https://user:secret@example.test" },
        { recording_subdir: "../escape" },
      ]) {
        await request(server)
          .post("/watch-targets")
          .send({ ...payload, ...invalid })
          .expect(400);
      }
      const { body: created } = (await request(server)
        .post("/watch-targets")
        .send(payload)
        .expect(201)) as { body: { id: string } };
      await request(server)
        .patch(`/watch-targets/${created.id}`)
        .send({ enabled: "false" })
        .expect(400);
      await request(server).delete(`/creators/${creator.id}`).expect(400);
      const { body: renamed } = (await request(server)
        .patch(`/creators/${creator.id}`)
        .send({ display_name: "Renamed HTTP" })
        .expect(200)) as { body: { id: string } };
      expect(renamed.id).toBe(creator.id);
      await request(server).get(`/creators/${creator.id}/watch-targets`).expect(200);
      await request(server).delete(`/watch-targets/${created.id}`).expect(200);
      await request(server).delete(`/creators/${creator.id}`).expect(200);
      await request(server).get(`/creators/${creator.id}`).expect(404);
    } finally {
      await app.close();
    }
  });

  it("retains historical rows when configuration is archived", async () => {
    const first = await target("History");
    const streamId = randomUUID();
    const recordingId = randomUUID();
    await pool.query<{ [key: string]: unknown }>(
      "insert into streams (id, watch_target_id, owner_id, state, started_at) values ($1,$2,(select owner_id from watch_targets where id=$2),'recording',now())",
      [streamId, first.id],
    );
    await pool.query<{ [key: string]: unknown }>(
      "insert into recordings (id, watch_target_id, stream_id, owner_id, state, started_at) values ($1,$2,$3,(select owner_id from watch_targets where id=$2),'recording',now())",
      [recordingId, first.id, streamId],
    );
    await repository.removeWatchTarget(first.id);
    await repository.removeCreator(first.creator_id);
    expect(
      (await pool.query<{ id: string }>("select id from streams where id=$1", [streamId])).rowCount,
    ).toBe(1);
    expect(
      (await pool.query<{ id: string }>("select id from recordings where id=$1", [recordingId]))
        .rowCount,
    ).toBe(1);
  });

  it("fails database mutations explicitly without writing a JSON fallback", async () => {
    const unavailable = new DatabaseService(
      "postgresql://test:test@127.0.0.1:1/streamrecorder_test",
    );
    const projection = jest.spyOn(WatchTargetJsonAdapter, "write");
    try {
      await expect(
        new RelationalStreamsRepository(unavailable).createCreator({ display_name: "Unavailable" }),
      ).rejects.toThrow();
      expect(projection).not.toHaveBeenCalled();
      expect(await repository.findAllCreators()).toEqual([]);
    } finally {
      await unavailable.onModuleDestroy();
    }
  });
});
