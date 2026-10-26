import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execFile, spawn, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { validate } from "class-validator";
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
  it.each([
    "worker_restart_before_launch",
    "worker_restart_interruption",
    "launch_failure",
    "checkpoint_failure",
  ])("accepts terminal recovery reason %s", async (reason) => {
    const payload = Object.assign(new InternalEventDto(), {
      event_id: randomUUID(),
      event_type: "recording.terminal",
      occurred_at: "2026-10-26T12:00:00.000Z",
      watch_target_id: randomUUID(),
      session_id: randomUUID(),
      state: "error",
      reason,
    });
    expect(await validate(payload)).toEqual([]);
  });

  it.each(["unknown", "arbitrary_reason", "", "worker_restart_before_launch "])(
    "rejects unknown terminal recovery reason %p",
    async (reason) => {
      const payload = Object.assign(new InternalEventDto(), {
        event_id: randomUUID(),
        event_type: "recording.terminal",
        occurred_at: "2026-10-26T12:00:00.000Z",
        watch_target_id: randomUUID(),
        session_id: randomUUID(),
        state: "error",
        reason,
      });
      const errors = await validate(payload);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe("reason");
      expect(errors[0].constraints?.isIn).toEqual(expect.any(String));
    },
  );

  it.each([undefined, "", "   "])(
    "rejects internal requests when the token is %p",
    async (value) => {
      const previous = process.env.INTERNAL_API_TOKEN;
      if (value === undefined) delete process.env.INTERNAL_API_TOKEN;
      else process.env.INTERNAL_API_TOKEN = value;
      const module = await Test.createTestingModule({
        controllers: [InternalStreamsController],
        providers: [{ provide: InternalEventsService, useValue: {} }],
      }).compile();
      const app = module.createNestApplication<INestApplication<Server>>();
      try {
        await app.init();
        await request(app.getHttpServer())
          .get("/internal/v1/watch-targets/execution-configs")
          .set("X-Internal-Token", "streamrecorder_internal_secret")
          .expect(401);
        await request(app.getHttpServer())
          .post("/internal/v1/events")
          .set("X-Internal-Token", "streamrecorder_internal_secret")
          .send({})
          .expect(401);
      } finally {
        await app.close();
        if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
        else process.env.INTERNAL_API_TOKEN = previous;
      }
    },
  );

  it("keeps bridge unavailable without explicit relational activation", async () => {
    const previous = process.env.RELATIONAL_STORAGE;
    delete process.env.RELATIONAL_STORAGE;
    try {
      const service = new InternalEventsService({} as DatabaseService);
      await expect(service.getExecutionConfigs()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    } finally {
      if (previous === undefined) delete process.env.RELATIONAL_STORAGE;
      else process.env.RELATIONAL_STORAGE = previous;
    }
  });
});

describeDatabase("internal Worker events", () => {
  let app: INestApplication<Server>;
  let pool: Pool;
  let directory: string;
  let targetId: string;
  let baseUrl: string;
  const environment = { ...process.env };

  async function startApi() {
    const module = await Test.createTestingModule({
      controllers: [InternalStreamsController],
      providers: [
        InternalEventsService,
        { provide: DatabaseService, useFactory: () => new DatabaseService(databaseUrl) },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useLogger(false);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
    pool.on("error", () => {
      console.warn("Isolated observer connection lost during database restart");
    });
    const database = new DatabaseService(databaseUrl);
    await database.migrate();
    await database.onModuleDestroy();
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "streamrecorder-bridge-"));
    process.env.RELATIONAL_STORAGE = "true";
    process.env.INTERNAL_API_TOKEN = token;
    await pool.query<{ [key: string]: unknown }>(
      "truncate worker_events, recordings, streams, watch_targets, creators",
    );
    const creatorId = randomUUID();
    targetId = randomUUID();
    await pool.query<{ [key: string]: unknown }>(
      "insert into creators (id, owner_id, display_name, normalized_key) values ($1, (select id from users where bootstrap_key='local'), 'Fixture', 'fixture')",
      [creatorId],
    );
    await pool.query<{ [key: string]: unknown }>(
      "insert into watch_targets (id, creator_id, owner_id, channel_name, platform, url, quality) values ($1,$2,(select owner_id from creators where id=$2),'fake','twitch','https://example.test/fake','1080p')",
      [targetId, creatorId],
    );
    await startApi();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await pool.query<{ [key: string]: unknown }>(
      "update users set disabled_at=null where bootstrap_key='local'",
    );
    process.env = { ...environment };
    await rm(directory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await pool?.end();
  });

  function event(
    event_type: InternalEventDto["event_type"],
    values: Partial<InternalEventDto> = {},
  ): InternalEventDto {
    return {
      event_id: randomUUID(),
      event_type,
      occurred_at: new Date().toISOString(),
      watch_target_id: targetId,
      ...values,
    };
  }

  function post(payload: InternalEventDto) {
    return request(app.getHttpServer())
      .post("/internal/v1/events")
      .set("X-Internal-Token", token)
      .send(payload);
  }

  async function python(code: string, url = baseUrl) {
    return execute(process.env.PYTHON ?? "python", ["-c", code], {
      cwd: join(process.cwd(), "../worker"),
      timeout: 30000,
      env: {
        ...process.env,
        PERSISTENCE_MODE: "bridge",
        PERSISTENCE_BRIDGE_URL: url,
        INTERNAL_API_TOKEN: token,
        CONFIG_DIR: directory,
        OUTPUT_DIR: join(directory, "media"),
        OUTBOX_DIR: join(directory, "outbox"),
        BRIDGE_TEST_TARGET: targetId,
      },
    });
  }

  it("keeps open legacy history independent of native starts, replay and offline", async () => {
    const legacyStream = randomUUID();
    const legacyRecording = randomUUID();
    await pool.query(
      `insert into streams (id, owner_id, watch_target_id, state, origin, legacy_started_at_raw)
       select $1, owner_id, id, 'recording', 'legacy_json', '2025-01-02T03:04:05' from watch_targets where id=$2`,
      [legacyStream, targetId],
    );
    await pool.query(
      `insert into recordings (id, owner_id, watch_target_id, state, origin, legacy_started_at_raw)
       select $1, owner_id, id, 'recording', 'legacy_json', '2025-01-02T03:04:05' from watch_targets where id=$2`,
      [legacyRecording, targetId],
    );
    const start = event("recording.start", {
      session_id: randomUUID(),
      stream_id: randomUUID(),
      quality: "best",
      output_file: "private.mp4",
    });
    const first = await post(start).expect(201);
    expect((await post(start).expect(201)).body).toEqual(first.body);
    await post(
      event("recording.start", { ...start, event_id: randomUUID(), session_id: randomUUID() }),
    ).expect(409);
    await expect(
      pool.query(
        `insert into streams (id, owner_id, watch_target_id, state, started_at)
         select $1, owner_id, id, 'recording', now() from watch_targets where id=$2`,
        [randomUUID(), targetId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await post(
      event("recording.terminal", {
        session_id: legacyRecording,
        state: "error",
      }),
    ).expect(409);
    await post(
      event("recording.terminal", {
        session_id: start.session_id,
        stream_id: start.stream_id,
        state: "error",
      }),
    ).expect(201);
    await post(event("stream.offline")).expect(201);
    const legacy = await pool.query<{ origin: string; finished_at: Date | null }>(
      "select origin, finished_at from streams where id=$1 union all select origin, finished_at from recordings where id=$2",
      [legacyStream, legacyRecording],
    );
    expect(legacy.rows).toEqual([
      { origin: "legacy_json", finished_at: null },
      { origin: "legacy_json", finished_at: null },
    ]);
  });

  it("protects both routes and validates conditional fields and explicit timezone", async () => {
    await request(app.getHttpServer())
      .get("/internal/v1/watch-targets/execution-configs")
      .expect(401);
    await request(app.getHttpServer()).post("/internal/v1/events").send({}).expect(401);
    for (const payload of [
      event("recording.start"),
      event("recording.terminal", { session_id: randomUUID() }),
      event("stream.offline", { occurred_at: "2026-10-19T12:00:00" }),
      { ...event("stream.offline"), extra: true },
    ]) {
      await post(payload).expect(400);
    }
    const response = await request(app.getHttpServer())
      .get("/internal/v1/watch-targets/execution-configs")
      .set("X-Internal-Token", token)
      .expect(200);
    expect(response.body as unknown).toEqual([
      {
        id: targetId,
        channel_name: "fake",
        platform: "twitch",
        url: "https://example.test/fake",
        quality: "1080p",
        enabled: true,
      },
    ]);
  });

  it("replays lost acknowledgements across API restart and rejects conflicting reuse", async () => {
    const start = event("recording.start", {
      session_id: randomUUID(),
      stream_id: randomUUID(),
      quality: "720p",
    });
    const first = await post(start).expect(201);
    const concurrent = await Promise.all([post(start), post(start)]);
    for (const response of concurrent) {
      expect(response.status).toBe(201);
      expect(response.body as unknown).toEqual(first.body as unknown);
    }
    await app.close();
    await startApi();
    expect((await post(start).expect(201)).body as unknown).toEqual(first.body as unknown);
    await post({ ...start, quality: "480p" }).expect(409);
    expect(
      (
        await pool.query<{
          id: string;
          owner_id: string;
          watch_target_id: string;
          stream_id: string | null;
          state: string;
          finished_at: Date | null;
          legacy_started_at_raw: string | null;
          legacy_finished_at_raw: string | null;
          output_file: string | null;
        }>("select * from recordings")
      ).rowCount,
    ).toBe(1);
    expect((await pool.query<{ [key: string]: unknown }>("select * from streams")).rowCount).toBe(
      1,
    );
    expect(
      (await pool.query<{ [key: string]: unknown }>("select * from worker_events")).rowCount,
    ).toBe(1);
  });

  it("durably acknowledges before-launch recovery and replays without mutation", async () => {
    const start = event("recording.start", {
      session_id: randomUUID(),
      stream_id: randomUUID(),
      quality: "1080p",
      occurred_at: "2026-10-26T11:00:00.000Z",
    });
    await post(start).expect(201);
    const before = await pool.query<{
      owner_id: string;
      watch_target_id: string;
      stream_id: string;
    }>("select owner_id, watch_target_id, stream_id from recordings where id=$1", [
      start.session_id,
    ]);
    const terminal = event("recording.terminal", {
      session_id: start.session_id,
      stream_id: start.stream_id,
      state: "error",
      reason: "worker_restart_before_launch",
      occurred_at: "2026-10-26T12:00:00.000Z",
    });
    const acknowledgement = await post(terminal).expect(201);
    expect(acknowledgement.body as unknown).toEqual({
      acknowledged: true,
      session_id: start.session_id,
      state: "error",
    });
    const recovered = await pool.query<{
      owner_id: string;
      watch_target_id: string;
      stream_id: string;
      state: string;
      finished_at: Date;
    }>("select * from recordings where id=$1", [start.session_id]);
    expect(recovered.rows).toEqual([
      expect.objectContaining({
        ...before.rows[0],
        state: "error",
        finished_at: new Date(terminal.occurred_at),
      }),
    ]);
    await app.close();
    await startApi();
    expect((await post(terminal).expect(201)).body as unknown).toEqual(
      acknowledgement.body as unknown,
    );
    expect(
      (await pool.query("select * from recordings where id=$1", [start.session_id])).rows,
    ).toEqual(recovered.rows);
    expect(
      (await pool.query("select * from worker_events where event_id=$1", [terminal.event_id]))
        .rowCount,
    ).toBe(1);
    expect((await pool.query("select * from recordings")).rowCount).toBe(1);
    expect((await pool.query("select * from streams")).rowCount).toBe(1);
  });

  async function concurrentOwner() {
    const ownerId = randomUUID();
    const creatorId = randomUUID();
    await pool.query<{ [key: string]: unknown }>(
      "insert into users (id, username) values ($1,$2)",
      [ownerId, `race-${ownerId.slice(0, 8)}`],
    );
    await pool.query<{ [key: string]: unknown }>(
      "insert into creators (id, owner_id, display_name, normalized_key) values ($1,$2,'Race','race')",
      [creatorId, ownerId],
    );
    await pool.query<{ [key: string]: unknown }>(
      "update watch_targets set owner_id=$1, creator_id=$2 where id=$3",
      [ownerId, creatorId, targetId],
    );
    return ownerId;
  }

  async function waitForBlock(blockerPid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const result = await pool.query<{ pid: string }>(
        "select pid from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))",
        [blockerPid],
      );
      if (result.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Expected a concurrent transaction to wait for the row lock");
  }

  it("blocks a new start behind account disablement and rolls back without acknowledgement", async () => {
    const ownerId = await concurrentOwner();
    const client = await pool.connect();
    const start = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() });
    let pending: Promise<request.Response> | undefined;
    let settled = false;
    try {
      await client.query<{ [key: string]: unknown }>("begin");
      await client.query<{ [key: string]: unknown }>("set local statement_timeout='5s'");
      const {
        rows: [{ pid }],
      } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      await client.query<{ id: string }>("select id from users where id=$1 for update", [ownerId]);
      await client.query<{ [key: string]: unknown }>(
        "update users set disabled_at=now() where id=$1",
        [ownerId],
      );
      pending = post(start).then((response) => {
        settled = true;
        return response;
      });
      await waitForBlock(pid);
      expect(settled).toBe(false);
      await client.query<{ [key: string]: unknown }>("commit");
      const response = await pending;
      expect(response.status).toBe(409);
      expect((response.body as { message: unknown }).message).toBe(
        "Watch target owner is disabled",
      );
      for (const table of ["streams", "recordings", "worker_events"]) {
        expect(
          (await pool.query<{ [key: string]: unknown }>(`select * from ${table}`)).rowCount,
        ).toBe(0);
      }
    } finally {
      await client.query<{ [key: string]: unknown }>("rollback");
      client.release();
      await pending;
    }
  });

  it("commits an accepted start before disablement and preserves replay and terminal recovery", async () => {
    const ownerId = await concurrentOwner();
    const client = await pool.connect();
    const start = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() });
    let releaseStart!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const insertRecording = Object.getOwnPropertyDescriptor(
      RelationalStreamsRepository.prototype,
      "insertRecording",
    )!.value as RelationalStreamsRepository["insertRecording"];
    const insertion = jest
      .spyOn(RelationalStreamsRepository.prototype, "insertRecording")
      .mockImplementationOnce(async function (...args) {
        await args[0].execute("set local statement_timeout='5s'");
        await gate;
        return insertRecording.apply(this, args) as ReturnType<
          RelationalStreamsRepository["insertRecording"]
        >;
      });
    let pendingStart: Promise<request.Response> | undefined;
    let pendingDisable: Promise<unknown> | undefined;
    let disabled = false;
    try {
      await client.query<{ [key: string]: unknown }>("begin");
      await client.query<{ [key: string]: unknown }>("set local statement_timeout='5s'");
      const {
        rows: [{ pid }],
      } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      pendingStart = post(start).then((response) => response);
      const deadline = Date.now() + 3000;
      while (!insertion.mock.calls.length) {
        if (Date.now() >= deadline) throw new Error("Start did not reach Recording insertion");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      pendingDisable = client
        .query<{
          [key: string]: unknown;
        }>("update users set disabled_at=now() where id=$1", [ownerId])
        .then((result) => {
          disabled = true;
          return result;
        });
      const waitDeadline = Date.now() + 3000;
      while (
        !(
          await pool.query<{ [key: string]: unknown }>(
            "select 1 from pg_stat_activity where pid=$1 and cardinality(pg_blocking_pids(pid)) > 0",
            [pid],
          )
        ).rowCount
      ) {
        if (Date.now() >= waitDeadline)
          throw new Error("Disablement did not wait for the accepted start");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(disabled).toBe(false);
      releaseStart();
      const accepted = await pendingStart;
      expect(accepted.status).toBe(201);
      await pendingDisable;
      expect(
        (
          await pool.query<{ id: string }>("select id from recordings where id=$1", [
            start.session_id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool.query<{ event_id: string }>(
            "select event_id from worker_events where event_id=$1",
            [start.event_id],
          )
        ).rowCount,
      ).toBe(1);
      await client.query<{ [key: string]: unknown }>("commit");
      expect((await post(start).expect(201)).body as unknown).toEqual(accepted.body as unknown);
      const rejected = event("recording.start", {
        session_id: randomUUID(),
        stream_id: randomUUID(),
      });
      await post(rejected).expect(409);
      const terminal = event("recording.terminal", {
        session_id: start.session_id,
        stream_id: start.stream_id,
        state: "finished",
      });
      const finished = await post(terminal).expect(201);
      await app.close();
      await startApi();
      expect((await post(start).expect(201)).body as unknown).toEqual(accepted.body as unknown);
      expect((await post(terminal).expect(201)).body as unknown).toEqual(finished.body as unknown);
      expect((await pool.query<{ state: string }>("select state from recordings")).rows).toEqual([
        { state: "finished" },
      ]);
      expect((await pool.query<{ [key: string]: unknown }>("select * from streams")).rowCount).toBe(
        1,
      );
      expect(
        (await pool.query<{ [key: string]: unknown }>("select * from worker_events")).rowCount,
      ).toBe(2);
      expect(
        (
          await pool.query<{ [key: string]: unknown }>(
            "select * from worker_events where event_id=$1",
            [rejected.event_id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      releaseStart();
      await Promise.allSettled([pendingStart, pendingDisable]);
      await client.query<{ [key: string]: unknown }>("rollback");
      client.release();
    }
  });

  it("isolates two owners and rejects mismatched events without partial writes or acknowledgements", async () => {
    const ownerId = randomUUID();
    const creatorId = randomUUID();
    const otherTarget = randomUUID();
    await pool.query<{ [key: string]: unknown }>(
      "insert into users (id, username) values ($1,$2)",
      [ownerId, `owner-${ownerId.slice(0, 8)}`],
    );
    await pool.query<{ [key: string]: unknown }>(
      "insert into creators (id, owner_id, display_name, normalized_key) values ($1,$2,'Other','other')",
      [creatorId, ownerId],
    );
    await pool.query<{ [key: string]: unknown }>(
      "insert into watch_targets (id, creator_id, owner_id, channel_name, platform, url, quality) values ($1,$2,$3,'other','twitch','https://example.test/other','best')",
      [otherTarget, creatorId, ownerId],
    );
    const first = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() });
    const other = event("recording.start", {
      watch_target_id: otherTarget,
      session_id: randomUUID(),
      stream_id: randomUUID(),
    });
    await post(first).expect(201);
    await post(other).expect(201);
    for (const payload of [
      event("recording.terminal", {
        session_id: first.session_id,
        watch_target_id: otherTarget,
        state: "finished",
      }),
      event("recording.terminal", {
        session_id: first.session_id,
        stream_id: other.stream_id,
        state: "finished",
      }),
      event("stream.offline", { stream_id: other.stream_id }),
    ])
      await post(payload).expect(409);
    expect(
      (await pool.query<{ count: number }>("select count(*)::int as count from worker_events"))
        .rows[0].count,
    ).toBe(2);
    expect((await pool.query<{ state: string }>("select state from recordings")).rows).toEqual([
      { state: "recording" },
      { state: "recording" },
    ]);
    expect(
      (
        await pool.query<{ owner_id: string }>("select owner_id from recordings where id=$1", [
          other.session_id,
        ])
      ).rows[0].owner_id,
    ).toBe(ownerId);
    expect(
      (
        await pool.query<{ owner_id: string }>("select owner_id from streams where id=$1", [
          other.stream_id,
        ])
      ).rows[0].owner_id,
    ).toBe(ownerId);
    await pool.query<{ [key: string]: unknown }>("update users set disabled_at=now() where id=$1", [
      ownerId,
    ]);
    const configs = await request(app.getHttpServer())
      .get("/internal/v1/watch-targets/execution-configs")
      .set("X-Internal-Token", token)
      .expect(200);
    expect(
      (configs.body as Record<string, string>[]).map((config: { id: string }) => config.id),
    ).toEqual([targetId]);
    await post(
      event("recording.start", { watch_target_id: otherTarget, session_id: randomUUID() }),
    ).expect(409);
    const terminal = event("recording.terminal", {
      watch_target_id: otherTarget,
      session_id: other.session_id,
      stream_id: other.stream_id,
      state: "finished",
    });
    const accepted = await post(terminal).expect(201);
    const fingerprint = (
      await pool.query<{ fingerprint: string }>(
        "select fingerprint from worker_events where event_id=$1",
        [terminal.event_id],
      )
    ).rows[0].fingerprint;
    await app.close();
    await startApi();
    expect((await post(terminal).expect(201)).body as unknown).toEqual(accepted.body as unknown);
    expect(
      (
        await pool.query<{ fingerprint: string }>(
          "select fingerprint from worker_events where event_id=$1",
          [terminal.event_id],
        )
      ).rows,
    ).toEqual([{ fingerprint }]);
    expect(
      (
        await pool.query<{ count: number }>(
          "select count(*)::int as count from recordings where id=$1 and owner_id=$2 and state='finished'",
          [other.session_id, ownerId],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("completes accepted recordings on archived targets without starting new work or closing the broadcast", async () => {
    const start = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() });
    await post(start).expect(201);
    await pool.query<{ [key: string]: unknown }>(
      "update watch_targets set archived_at=now() where id=$1",
      [targetId],
    );
    await post(event("recording.start", { session_id: randomUUID() })).expect(404);
    const terminal = event("recording.terminal", {
      session_id: start.session_id,
      stream_id: start.stream_id,
      state: "finished",
    });
    await post(terminal).expect(201);
    await post(terminal).expect(201);
    expect(
      (
        (await post(event("stream.offline", { stream_id: start.stream_id })).expect(201)).body as {
          finalized: unknown;
        }
      ).finalized,
    ).toBe(false);
    expect(
      (
        await pool.query<{ finished_at: Date | null }>(
          "select finished_at from streams where id=$1",
          [start.stream_id],
        )
      ).rows[0].finished_at,
    ).toBeNull();
    await request(app.getHttpServer())
      .get("/internal/v1/watch-targets/execution-configs")
      .set("Cookie", "sr_session=human-only")
      .expect(401);
    await request(app.getHttpServer())
      .post("/internal/v1/events")
      .set("Cookie", "sr_session=human-only")
      .send(terminal)
      .expect(401);
  });

  it("keeps terminal outcomes monotonic, retries on the same Stream, and closes only on OFFLINE", async () => {
    const start = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() });
    const acknowledged = (await post(start).expect(201)).body as { stream_id: string };
    expect(
      ((await post(event("stream.offline")).expect(201)).body as { finalized: unknown }).finalized,
    ).toBe(false);
    const terminal = event("recording.terminal", {
      session_id: start.session_id,
      stream_id: acknowledged.stream_id,
      state: "error",
    });
    await post(terminal).expect(201);
    await post(terminal).expect(201);
    await post({ ...terminal, event_id: randomUUID(), state: "finished" }).expect(409);
    const retry = event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() });
    expect(((await post(retry).expect(201)).body as { stream_id: unknown }).stream_id).toBe(
      acknowledged.stream_id,
    );
    await post(
      event("recording.terminal", { session_id: retry.session_id, state: "finished" }),
    ).expect(201);
    expect(
      ((await post(event("stream.offline")).expect(201)).body as { finalized: unknown }).finalized,
    ).toBe(true);
    const next = await post(
      event("recording.start", { session_id: randomUUID(), stream_id: randomUUID() }),
    ).expect(201);
    expect((next.body as { stream_id: unknown }).stream_id).not.toBe(acknowledged.stream_id);
  });

  it("rejects out-of-order terminal and cross-target updates without acknowledging them", async () => {
    const session_id = randomUUID();
    const terminal = event("recording.terminal", { session_id, state: "finished" });
    await post(terminal).expect(409);
    expect(
      (await pool.query<{ [key: string]: unknown }>("select * from worker_events")).rowCount,
    ).toBe(0);
    await post(event("recording.start", { session_id, occurred_at: terminal.occurred_at })).expect(
      201,
    );
    await post({ ...terminal, watch_target_id: randomUUID() }).expect(409);
    await post(terminal).expect(201);
  });

  it("rolls back Stream creation and event acknowledgement if Recording insertion fails", async () => {
    jest
      .spyOn(RelationalStreamsRepository.prototype, "insertRecording")
      .mockRejectedValueOnce(new Error("fixture failure"));
    const start = event("recording.start", { session_id: randomUUID() });
    await post(start).expect(503);
    for (const table of ["streams", "recordings", "worker_events"]) {
      expect(
        (await pool.query<{ [key: string]: unknown }>(`select * from ${table}`)).rowCount,
      ).toBe(0);
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
    const rows = (
      await pool.query<{
        id: string;
        owner_id: string;
        watch_target_id: string;
        stream_id: string | null;
        state: string;
        finished_at: Date | null;
        legacy_started_at_raw: string | null;
        legacy_finished_at_raw: string | null;
        output_file: string | null;
      }>("select * from recordings")
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: "finished",
      watch_target_id: targetId,
      quality: "1080p",
      stream_id: expect.any(String) as unknown,
    });
    expect(
      (await pool.query<{ [key: string]: unknown }>("select * from worker_events")).rowCount,
    ).toBe(2);
    expect(await readdir(join(directory, "outbox/active"))).toEqual([]);
    expect(await readFile(rows[0].output_file!, "utf8")).toBe("fixture-not-playable-media");
  });

  it("recovers an owner-free verified-dead Worker checkpoint after owner disablement", async () => {
    await python(`import worker, os
worker.ensure_runtime_dirs()
box = worker.get_bridge()
entry = worker.load_watchlist()[0]
import uuid
checkpoint = box.start(entry['id'], str(uuid.uuid4()), None, 'retained.mp4', 'best')
checkpoint.update(pid=os.getpid(), phase='capturing')
box.checkpoint(checkpoint)
`);
    await pool.query<{ [key: string]: unknown }>(
      "update users set disabled_at=now() where id=(select owner_id from watch_targets where id=$1)",
      [targetId],
    );
    await python(
      "import worker; worker.get_bridge().recover(); assert not list(worker.get_bridge().active.glob('*.json'))",
    );
    await python(
      "import worker; worker.get_bridge().recover(); assert not list(worker.get_bridge().active.glob('*.json'))",
    );
    expect((await pool.query<{ state: string }>("select state from recordings")).rows).toEqual([
      { state: "error" },
    ]);
    expect(
      (await pool.query<{ [key: string]: unknown }>("select * from worker_events")).rowCount,
    ).toBe(2);
  });

  const testRestart = process.env.BRIDGE_TEST_DB_RESTART === "true" ? it : it.skip;
  testRestart(
    "retains active capture and terminal outbox through PostgreSQL outage and restart",
    async () => {
      const compose = ["compose", "-f", "compose.test-db.yml", "-p", "streamrecorder-test-db"];
      const docker = (args: string[]) => {
        const result = spawnSync("docker", [...compose, ...args], {
          cwd: join(process.cwd(), ".."),
          encoding: "utf8",
        });
        if (result.status !== 0)
          throw new Error(`Isolated database command failed: ${args.join(" ")}`);
      };
      const child = spawn(
        process.env.PYTHON ?? "python",
        [
          "-u",
          "-c",
          `import io, json, pathlib, os, sys
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
  `.replace(/^ {2}/gm, ""),
        ],
        {
          cwd: join(process.cwd(), "../worker"),
          env: {
            ...process.env,
            PERSISTENCE_MODE: "bridge",
            PERSISTENCE_BRIDGE_URL: baseUrl,
            INTERNAL_API_TOKEN: token,
            CONFIG_DIR: directory,
            OUTPUT_DIR: join(directory, "media"),
            OUTBOX_DIR: join(directory, "outbox"),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let diagnostic = "";
      child.stderr.on("data", (chunk) => {
        diagnostic = (diagnostic + String(chunk)).slice(-4096);
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
      async function nextLine() {
        const result = await lines.next();
        if (result.done)
          throw new Error(`Fake Worker exited before reporting state: ${diagnostic}`);
        return JSON.parse(result.value) as {
          output_file: string;
          session_id: string;
          active?: boolean;
          pending?: number;
          state?: string;
        };
      }
      try {
        const capture = await nextLine();
        await pool.query<{ [key: string]: unknown }>(
          "update users set disabled_at=now() where id=(select owner_id from watch_targets where id=$1)",
          [targetId],
        );
        docker(["stop", "postgres-test"]);
        await post(event("recording.start", { session_id: randomUUID() })).expect(503);
        await request(app.getHttpServer())
          .get("/internal/v1/watch-targets/execution-configs")
          .set("X-Internal-Token", token)
          .expect(503);
        child.stdin.write("complete\n");
        expect(await nextLine()).toEqual({ active: true, pending: 1, state: "recording" });
        expect(await readFile(capture.output_file, "utf8")).toBe("retained-media");
        docker(["up", "-d", "--wait", "postgres-test"]);
        child.stdin.write("retry\n");
        expect(await nextLine()).toEqual({ active: false, pending: 0, state: "finished" });
        expect(
          (
            await pool.query<{ state: string }>("select state from recordings where id=$1", [
              capture.session_id,
            ])
          ).rows,
        ).toEqual([{ state: "finished" }]);
        expect(await readFile(capture.output_file, "utf8")).toBe("retained-media");
      } finally {
        docker(["up", "-d", "--wait", "postgres-test"]);
        child.stdin.end();
        await exited;
      }
    },
    90000,
  );
});
