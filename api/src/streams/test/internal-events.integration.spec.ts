import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execFile, spawn, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Pool } from "pg";
import { createInterface } from "readline";
import request from "supertest";
import { promisify } from "util";
import { DatabaseService } from "../../database/database.service";
import { InternalEventDto } from "../dto/internal-event.dto";
import { InternalEventsService } from "../internal-events.service";
import { InternalStreamsController } from "../internal-streams.controller";
import { RelationalStreamsRepository } from "../relational-streams.repository";

const databaseUrl = process.env.RELATIONAL_TEST_DATABASE_URL;
if (databaseUrl && new URL(databaseUrl).pathname !== "/streamrecorder_test") {
  throw new Error("Worker bridge tests require the isolated streamrecorder_test database");
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const execute = promisify(execFile);
const token = "test-only-worker-token";

describe("internal Worker boundary", () => {
  it.each([undefined, "", "   "])("rejects internal requests when the token is %p", async (value) => {
    const previous = process.env.INTERNAL_API_TOKEN;
    if (value === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = value;
    const module = await Test.createTestingModule({
      controllers: [InternalStreamsController],
      providers: [{ provide: InternalEventsService, useValue: {} }],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      await request(app.getHttpServer()).get("/internal/v1/watch-targets/execution-configs")
        .set("X-Internal-Token", "streamrecorder_internal_secret").expect(401);
      await request(app.getHttpServer()).post("/internal/v1/events")
        .set("X-Internal-Token", "streamrecorder_internal_secret").send({}).expect(401);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
      else process.env.INTERNAL_API_TOKEN = previous;
    }
  });

  it("keeps bridge unavailable without explicit relational activation", async () => {
    const previous = process.env.RELATIONAL_STORAGE;
    delete process.env.RELATIONAL_STORAGE;
    try {
      const service = new InternalEventsService({} as DatabaseService);
      await expect(service.getExecutionConfigs()).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (previous === undefined) delete process.env.RELATIONAL_STORAGE;
      else process.env.RELATIONAL_STORAGE = previous;
    }
  });
});

describeDatabase("internal Worker events", () => {
  let app: INestApplication;
  let pool: Pool;
  let directory: string;
  let targetId: string;
  let baseUrl: string;
  const environment = { ...process.env };

  async function startApi() {
    const module = await Test.createTestingModule({ controllers: [InternalStreamsController],
      providers: [InternalEventsService, { provide: DatabaseService, useFactory: () => new DatabaseService(databaseUrl) }],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
    pool.on("error", () => { console.warn("Isolated observer connection lost during database restart"); });
    const database = new DatabaseService(databaseUrl);
    await database.migrate();
    await database.onModuleDestroy();
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "streamrecorder-bridge-"));
    process.env.RELATIONAL_STORAGE = "true";
    process.env.INTERNAL_API_TOKEN = token;
    await pool.query("truncate worker_events, recordings, streams, watch_targets, creators");
    const creatorId = randomUUID();
    targetId = randomUUID();
    await pool.query("insert into creators (id, owner_id, display_name, normalized_key) values ($1, (select id from users where bootstrap_key='local'), 'Fixture', 'fixture')", [creatorId]);
    await pool.query("insert into watch_targets (id, creator_id, owner_id, channel_name, platform, url, quality) values ($1,$2,(select owner_id from creators where id=$2),'fake','twitch','https://example.test/fake','1080p')", [targetId, creatorId]);
    await startApi();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
    process.env = { ...environment };
    await rm(directory, { recursive: true, force: true });
  });

  afterAll(async () => { await pool?.end(); });

  function event(event_type: InternalEventDto["event_type"], values: Partial<InternalEventDto> = {}): InternalEventDto {
    return { event_id: randomUUID(), event_type, occurred_at: new Date().toISOString(),
      watch_target_id: targetId, ...values };
  }

  function post(payload: InternalEventDto) {
    return request(app.getHttpServer()).post("/internal/v1/events").set("X-Internal-Token", token).send(payload);
  }

  async function python(code: string, url = baseUrl) {
    return execute(process.env.PYTHON ?? "python", ["-c", code], {
      cwd: join(process.cwd(), "../worker"), timeout: 30000,
      env: { ...process.env, PERSISTENCE_MODE: "bridge", PERSISTENCE_BRIDGE_URL: url,
        INTERNAL_API_TOKEN: token, CONFIG_DIR: directory, OUTPUT_DIR: join(directory, "media"),
        OUTBOX_DIR: join(directory, "outbox"), BRIDGE_TEST_TARGET: targetId },
    });
  }

  it("protects both routes and validates conditional fields and explicit timezone", async () => {
    await request(app.getHttpServer()).get("/internal/v1/watch-targets/execution-configs").expect(401);
    await request(app.getHttpServer()).post("/internal/v1/events").send({}).expect(401);
    for (const payload of [event("recording.start"), event("recording.terminal", { session_id: randomUUID() }),
      event("stream.offline", { occurred_at: "2026-10-19T12:00:00" }), { ...event("stream.offline"), extra: true }]) {
      await post(payload).expect(400);
    }
    const response = await request(app.getHttpServer()).get("/internal/v1/watch-targets/execution-configs")
      .set("X-Internal-Token", token).expect(200);
    expect(response.body).toEqual([{ id: targetId, channel_name: "fake", platform: "twitch",
      url: "https://example.test/fake", quality: "1080p", enabled: true }]);
  });

  it("replays lost acknowledgements across API restart and rejects conflicting reuse", async () => {
    const start = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID(), quality: "720p" });
    const first = await post(start).expect(201);
    const concurrent = await Promise.all([post(start), post(start)]);
    for (const response of concurrent) {
      expect(response.status).toBe(201);
      expect(response.body).toEqual(first.body);
    }
    await app.close();
    await startApi();
    expect((await post(start).expect(201)).body).toEqual(first.body);
    await post({ ...start, quality: "480p" }).expect(409);
    expect((await pool.query("select * from recordings")).rowCount).toBe(1);
    expect((await pool.query("select * from streams")).rowCount).toBe(1);
    expect((await pool.query("select * from worker_events")).rowCount).toBe(1);
  });

  it("keeps terminal outcomes monotonic, retries on the same Stream, and closes only on OFFLINE", async () => {
    const start = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() });
    const acknowledged = (await post(start).expect(201)).body;
    expect((await post(event("stream.offline")).expect(201)).body.finalized).toBe(false);
    const terminal = event("recording.terminal", { session_id: start.session_id, stream_id: acknowledged.stream_id, state: "error" });
    await post(terminal).expect(201);
    await post(terminal).expect(201);
    await post({ ...terminal, event_id: randomUUID(), state: "finished" }).expect(409);
    const retry = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() });
    expect((await post(retry).expect(201)).body.stream_id).toBe(acknowledged.stream_id);
    await post(event("recording.terminal", { session_id: retry.session_id, state: "finished" })).expect(201);
    expect((await post(event("stream.offline")).expect(201)).body.finalized).toBe(true);
    const next = await post(event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() })).expect(201);
    expect(next.body.stream_id).not.toBe(acknowledged.stream_id);
  });

  it("rejects out-of-order terminal and cross-target updates without acknowledging them", async () => {
    const session_id = randomUUID();
    const terminal = event("recording.terminal", { session_id, state: "finished" });
    await post(terminal).expect(409);
    expect((await pool.query("select * from worker_events")).rowCount).toBe(0);
    await post(event("recording.start", { session_id, occurred_at: terminal.occurred_at })).expect(201);
    await post({ ...terminal, watch_target_id: randomUUID() }).expect(409);
    await post(terminal).expect(201);
  });

  it("rolls back Stream creation and event acknowledgement if Recording insertion fails", async () => {
    jest.spyOn(RelationalStreamsRepository.prototype, "insertRecording").mockRejectedValueOnce(new Error("fixture failure"));
    const start = event("recording.start", { session_id: randomUUID() });
    await post(start).expect(503);
    for (const table of ["streams", "recordings", "worker_events"]) {
      expect((await pool.query(`select * from ${table}`)).rowCount).toBe(0);
    }
    await post(start).expect(201);
  });

  it("persists fake-process Worker capture activity and leaves domain JSON untouched", async () => {
    await python(`import io, pathlib, os
from unittest.mock import patch
import worker
class Process:
    pid = os.getpid()
    returncode = 0
    stderr = io.StringIO('')
    def wait(self, timeout=None): return 0
worker.ensure_runtime_dirs()
worker.get_bridge().recover()
entry = worker.load_watchlist()[0]
worker.channels_status[entry['id']] = {'state': 'idle'}
with patch.object(worker.subprocess, 'Popen', return_value=Process()), patch.object(worker.threading, 'Thread'):
    worker.start_recording(entry)
info = worker.active_recordings[entry['id']]
pathlib.Path(info['output_file']).write_bytes(b'fixture-not-playable-media')
worker.monitor_recording(entry['id'])
assert not worker.active_recordings
assert not pathlib.Path(worker.SESSIONS_PATH).exists()
assert not pathlib.Path(worker.STREAMS_PATH).exists()
assert not pathlib.Path(worker.CONFIG_PATH).exists()
`);
    const rows = (await pool.query("select * from recordings")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "finished", watch_target_id: targetId, quality: "1080p", stream_id: expect.any(String) });
    expect((await pool.query("select * from worker_events")).rowCount).toBe(2);
    expect(await readdir(join(directory, "outbox/active"))).toEqual([]);
    expect(await readFile(rows[0].output_file, "utf8")).toBe("fixture-not-playable-media");
  });

  it("recovers a verified-dead Worker checkpoint through real PostgreSQL", async () => {
    await python(`import worker, os
worker.ensure_runtime_dirs()
box = worker.get_bridge()
entry = worker.load_watchlist()[0]
import uuid
checkpoint = box.start(entry['id'], str(uuid.uuid4()), None, 'retained.mp4', 'best')
checkpoint.update(pid=os.getpid(), phase='capturing')
box.checkpoint(checkpoint)
`);
    await python("import worker; worker.get_bridge().recover(); assert not list(worker.get_bridge().active.glob('*.json'))");
    expect((await pool.query("select state from recordings")).rows).toEqual([{ state: "error" }]);
    expect((await pool.query("select * from worker_events")).rowCount).toBe(2);
  });

  const testRestart = process.env.BRIDGE_TEST_DB_RESTART === "true" ? it : it.skip;
  testRestart("retains active capture and terminal outbox through PostgreSQL outage and restart", async () => {
    const compose = ["compose", "-f", "compose.test-db.yml", "-p", "streamrecorder-test-db"];
    const docker = (args: string[]) => {
      const result = spawnSync("docker", [...compose, ...args], { cwd: join(process.cwd(), ".."), encoding: "utf8" });
      if (result.status !== 0) throw new Error(`Isolated database command failed: ${args.join(" ")}`);
    };
    const child = spawn(process.env.PYTHON ?? "python", ["-u", "-c", `import io, json, pathlib, os, sys
  from unittest.mock import patch
  import worker
  class Process:
    pid = os.getpid()
    returncode = 0
    stderr = io.StringIO('')
    def wait(self, timeout=None): return 0
  worker.ensure_runtime_dirs()
  entry = worker.load_watchlist()[0]
  worker.channels_status[entry['id']] = {'state': 'idle'}
  with patch.object(worker.subprocess, 'Popen', return_value=Process()), patch.object(worker.threading, 'Thread'):
    worker.start_recording(entry)
  info = worker.active_recordings[entry['id']]
  pathlib.Path(info['output_file']).write_bytes(b'retained-media')
  print(json.dumps({'session_id': info['session_id'], 'output_file': info['output_file']}), flush=True)
  for command in sys.stdin:
    if command.strip() == 'complete': worker.monitor_recording(entry['id'])
    elif command.strip() == 'retry':
      worker.get_bridge().next_retry = 0
      worker._persist_terminal_recording(entry['id'])
    print(json.dumps({'active': bool(worker.active_recordings), 'pending': len(worker.get_bridge().files()), 'state': worker.channels_status[entry['id']]['state']}), flush=True)
  `.replace(/^ {2}/gm, "")], { cwd: join(process.cwd(), "../worker"), env: { ...process.env,
      PERSISTENCE_MODE: "bridge", PERSISTENCE_BRIDGE_URL: baseUrl, INTERNAL_API_TOKEN: token,
      CONFIG_DIR: directory, OUTPUT_DIR: join(directory, "media"), OUTBOX_DIR: join(directory, "outbox") },
      stdio: ["pipe", "pipe", "pipe"] });
    let diagnostic = "";
    child.stderr.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-4096); });
    const exited = new Promise(resolve => child.once("exit", resolve));
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    async function nextLine() {
      const result = await lines.next();
      if (result.done) throw new Error(`Fake Worker exited before reporting state: ${diagnostic}`);
      return JSON.parse(result.value);
    }
    try {
      const capture = await nextLine();
      docker(["stop", "postgres-test"]);
      await post(event("recording.start", { session_id: randomUUID() })).expect(503);
      await request(app.getHttpServer()).get("/internal/v1/watch-targets/execution-configs").set("X-Internal-Token", token).expect(503);
      child.stdin.write("complete\n");
      expect(await nextLine()).toEqual({ active: true, pending: 1, state: "recording" });
      expect(await readFile(capture.output_file, "utf8")).toBe("retained-media");
      docker(["up", "-d", "--wait", "postgres-test"]);
      child.stdin.write("retry\n");
      expect(await nextLine()).toEqual({ active: false, pending: 0, state: "finished" });
      expect((await pool.query("select state from recordings where id=$1", [capture.session_id])).rows).toEqual([{ state: "finished" }]);
      expect(await readFile(capture.output_file, "utf8")).toBe("retained-media");
    } finally {
      docker(["up", "-d", "--wait", "postgres-test"]);
      child.stdin.end();
      await exited;
    }
  }, 90000);
});