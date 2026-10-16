import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from "@nestjs/common";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
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
import { StreamerService } from "../streams.service";
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
        await expect(pipe.transform({ display_name }, { type: "body", metatype })).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(pipe.transform({ display_name: " Name " }, { type: "body", metatype }))
        .resolves.toMatchObject({ display_name: "Name" });
    }
    await expect(pipe.transform({}, { type: "body", metatype: CreateCreatorDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({}, { type: "body", metatype: PatchCreatorDto })).resolves.toEqual({});
  });

  it("does not enable independent Creator mutations in JSON mode", async () => {
    await expect(new StreamsRepository().createCreator({ display_name: "Name" }))
      .rejects.toThrow("require relational storage");
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
    await pool.query("truncate recordings, streams, watch_targets, creators");
    directory = await mkdtemp(join(tmpdir(), "streamrecorder-relational-"));
    process.env.CONFIG_DIR = directory;
    for (const key of ["WATCHLIST_PATH", "CHANNELS_STATUS_PATH", "STREAMS_PATH", "SESSIONS_PATH"]) delete process.env[key];
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
    return service.createWatchTarget({ creator_id, channel_name: "channel", platform: "twitch",
      url: "https://example.test/channel", quality, recording_subdir: "captures/channel" });
  }

  it("keeps Creator UUID and target relationships stable through rename and archive", async () => {
    const creator = await repository.createCreator({ display_name: " Creator " });
    expect(creator).toEqual({ id: expect.any(String), display_name: "Creator" });
    expect(await repository.findOneCreator(" CREATOR ")).toEqual(creator);
    const first = await target(creator.id);
    await expect(repository.removeCreator(creator.id)).rejects.toThrow("active watch targets");
    expect(await repository.updateCreator(creator.id, { display_name: "Renamed" })).toEqual({ ...creator, display_name: "Renamed" });
    expect((await repository.findOneWatchTarget(first.id)).creator_id).toBe(creator.id);
    await expect(repository.findOneCreator("Creator")).rejects.toBeInstanceOf(NotFoundException);
    expect(await repository.findWatchTargetsByCreator("renamed")).toHaveLength(1);
    expect(JSON.parse(await readFile(join(directory, "watchlist.json"), "utf8"))[0].display_name).toBe("Renamed");
    await repository.removeWatchTarget(first.id);
    await repository.removeCreator(creator.id);
    await expect(repository.findOneCreator(creator.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await pool.query("select archived_at from creators where id=$1", [creator.id])).rows[0].archived_at).toBeInstanceOf(Date);
    expect((await pool.query("select creator_id from watch_targets where id=$1", [first.id])).rows[0].creator_id).toBe(creator.id);
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
    expect([first, second, third].every(item => item.enabled)).toBe(true);
    const edited = await service.updateWatchTarget(first.id, { quality: "480p", url: "https://example.test/new" });
    expect(edited.recording_subdir).toBe("captures/channel");
    expect(await repository.findOneWatchTarget(second.id)).toEqual(second);
    expect(await repository.findOneWatchTarget(third.id)).toEqual(third);
    await service.updateWatchTarget(second.id, { enabled: false });
    expect(await repository.findOneWatchTarget(first.id)).toEqual(edited);
    expect(await repository.findOneWatchTarget(third.id)).toEqual(third);
    await service.updateWatchTarget(first.id, { recording_subdir: "" });
    expect((await repository.findOneWatchTarget(first.id)).recording_subdir).toBeUndefined();
    expect((await pool.query("select recording_subdir from watch_targets where id=$1", [first.id])).rows[0].recording_subdir).toBeNull();
    await repository.removeWatchTarget(third.id);
    await expect(repository.findOneWatchTarget(third.id)).rejects.toBeInstanceOf(NotFoundException);
    const entries = await WatchTargetJsonAdapter.read(join(directory, "watchlist.json"));
    expect(entries).toHaveLength(2);
    expect(entries.find(item => item.id === first.id)).toEqual({
      id: first.id, display_name: "Siblings", channel_name: "channel", platform: "twitch",
      quality: "480p", url: "https://example.test/new", enabled: true,
    });
    expect(entries.find(item => item.id === second.id)).toMatchObject({ enabled: false, quality: "1080p", recording_subdir: "captures/channel" });
    const workerRead = spawnSync(process.env.PYTHON ?? "python", ["-c",
      "import json,sys; from json_adapters import WatchTargetJsonAdapter; print(json.dumps(WatchTargetJsonAdapter.read(sys.argv[1])))",
      join(directory, "watchlist.json")], { cwd: join(process.cwd(), "../worker"), encoding: "utf8" });
    expect(workerRead.error).toBeUndefined();
    expect(workerRead.status).toBe(0);
    expect(JSON.parse(workerRead.stdout)).toEqual(entries);
    await writeFile(join(directory, "channels_status.json"), JSON.stringify({ [first.id]: { state: "recording" } }));
    expect((await repository.findOneWatchTarget(first.id)).state).toBe("recording");
  });

  it("supports existing name-based creation and legacy Streamer contracts", async () => {
    const first = await target("New Creator");
    const second = await target("new creator", "720p");
    expect(first.creator_id).toBe(second.creator_id);
    const legacy = await repository.createStreamer({ display_name: "New Creator", channel_name: "legacy",
      platform: "twitch", url: "https://example.test/legacy", quality: "best" });
    expect(legacy).toEqual({ id: expect.any(String), display_name: "New Creator", channel_name: "legacy",
      platform: "twitch", url: "https://example.test/legacy", quality: "best", state: "idle" });
    expect(await repository.findOneStreamer(legacy.id)).toEqual(legacy);
    expect(await repository.findAllStreamer()).toHaveLength(3);
    await repository.removeStreamer(legacy.id);
    expect(await repository.findAllWatchTargets()).toHaveLength(2);
  });

  it("reports committed projection failure and reconciles without repeating the mutation", async () => {
    const first = await target("Projection");
    const projection = jest.spyOn(WatchTargetJsonAdapter, "write").mockRejectedValue(new Error("private/path"));
    await expect(service.updateWatchTarget(first.id, { enabled: false })).rejects.toThrow("Database committed but watchlist projection failed");
    expect((await repository.findOneWatchTarget(first.id)).enabled).toBe(false);
    projection.mockRestore();
    await repository.reprojectWatchlist();
    expect((await WatchTargetJsonAdapter.read(join(directory, "watchlist.json")))[0].enabled).toBe(false);
  });

  it("retains configuration after reconnect and leaves Stream/Recording reads on JSON", async () => {
    const first = await target("Restart");
    await writeFile(join(directory, "streams.json"), "[]");
    await writeFile(join(directory, "sessions.json"), "[]");
    const restartedDatabase = new DatabaseService(databaseUrl);
    try {
      const restarted = new RelationalStreamsRepository(restartedDatabase);
      expect(await restarted.findOneWatchTarget(first.id)).toEqual(first);
      expect(await restarted.findOneCreator(first.creator_id)).toMatchObject({ display_name: "Restart" });
      expect(await restarted.findAllStreams()).toEqual([]);
      expect(await restarted.findAllRecordings()).toEqual([]);
    } finally {
      await restartedDatabase.onModuleDestroy();
    }
  });

  it("rejects invalid configuration without changing persisted targets", async () => {
    const first = await target("Validation");
    for (const patch of [{ enabled: "false" }, { quality: "invalid" }, { url: "https://user:secret@example.test" }, { recording_subdir: "../escape" }]) {
      await expect(service.updateWatchTarget(first.id, patch as never)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await repository.findOneWatchTarget(first.id)).toEqual(first);
  });

  it("selects relational mode through Nest and validates Creator and target HTTP mutations", async () => {
    process.env.RELATIONAL_STORAGE = "true";
    const httpDatabase = new DatabaseService(databaseUrl);
    const module = await Test.createTestingModule({ imports: [StreamsModule] })
      .overrideProvider(DatabaseService).useValue(httpDatabase).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    try {
      expect(module.get(StreamsRepository)).toBeInstanceOf(RelationalStreamsRepository);
      const server = app.getHttpServer();
      await request(server).post("/creators").send({ display_name: " " }).expect(400);
      const { body: creator } = await request(server).post("/creators").send({ display_name: " HTTP " }).expect(201);
      const payload = { creator_id: creator.id, channel_name: "channel", platform: "twitch", url: "https://example.test/channel", quality: "best" };
      for (const invalid of [{ quality: "invalid" }, { platform: "invalid" }, { url: "https://user:secret@example.test" }, { recording_subdir: "../escape" }]) {
        await request(server).post("/watch-targets").send({ ...payload, ...invalid }).expect(400);
      }
      const { body: created } = await request(server).post("/watch-targets").send(payload).expect(201);
      await request(server).patch(`/watch-targets/${created.id}`).send({ enabled: "false" }).expect(400);
      await request(server).delete(`/creators/${creator.id}`).expect(400);
      const { body: renamed } = await request(server).patch(`/creators/${creator.id}`).send({ display_name: "Renamed HTTP" }).expect(200);
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
    await pool.query("insert into streams (id, watch_target_id, state, started_at) values ($1,$2,'recording',now())", [streamId, first.id]);
    await pool.query("insert into recordings (id, watch_target_id, stream_id, state, started_at) values ($1,$2,$3,'recording',now())", [recordingId, first.id, streamId]);
    await repository.removeWatchTarget(first.id);
    await repository.removeCreator(first.creator_id);
    expect((await pool.query("select id from streams where id=$1", [streamId])).rowCount).toBe(1);
    expect((await pool.query("select id from recordings where id=$1", [recordingId])).rowCount).toBe(1);
  });

  it("fails database mutations explicitly without writing a JSON fallback", async () => {
    const unavailable = new DatabaseService("postgresql://test:test@127.0.0.1:1/streamrecorder_test");
    const projection = jest.spyOn(WatchTargetJsonAdapter, "write");
    try {
      await expect(new RelationalStreamsRepository(unavailable).createCreator({ display_name: "Unavailable" })).rejects.toThrow();
      expect(projection).not.toHaveBeenCalled();
      expect(await repository.findAllCreators()).toEqual([]);
    } finally {
      await unavailable.onModuleDestroy();
    }
  });
});