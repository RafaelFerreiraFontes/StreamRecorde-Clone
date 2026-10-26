import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTH_OPTIONS, AuthService } from "../../auth/auth.service";
import { tokenHash } from "../../auth/auth.repository";
import { runUsersCLI } from "../../auth/users-cli";
import { DatabaseService } from "../../database/database.service";
import { StreamsModule } from "../streams.module";
import { StreamsRepository } from "../streams.repository";
import { RelationalStreamsRepository } from "../relational-streams.repository";
import { StreamerService } from "../streams.service";
import { RecordingsFilesystemService } from "../recordings-filesystem.service";

describe("forged ownership service boundary", () => {
  it.each(["owner_id", "ownerId"])("rejects %s before any repository mutation", async (field) => {
    const repository = new StreamsRepository();
    const service = new StreamerService(repository);
    for (const method of [
      "createCreator",
      "updateCreator",
      "createWatchTarget",
      "updateWatchTarget",
      "createStreamer",
    ] as const) {
      const mutation = jest.spyOn(repository, method);
      const payload = { display_name: "Alpha", [field]: randomUUID() };
      await expect(
        Promise.resolve().then(() =>
          method.startsWith("update")
            ? (service[method] as (id: string, dto: object) => unknown)(randomUUID(), payload)
            : (service[method] as (dto: object) => unknown)(payload),
        ),
      ).rejects.toEqual(new BadRequestException("Owner cannot be specified by client"));
      expect(mutation).not.toHaveBeenCalled();
      mutation.mockRestore();
    }
  });
});

const databaseUrl = process.env.RELATIONAL_TEST_DATABASE_URL;
if (
  databaseUrl &&
  (new URL(databaseUrl).pathname !== "/streamrecorder_test" ||
    new URL(databaseUrl).port !== "55432")
) {
  throw new Error("Authorization tests require isolated streamrecorder_test on port 55432");
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const origin = "http://localhost:3000";
const password = "synthetic-password-123";
const originalEnvironment = { ...process.env };

describeDatabase("domain ownership HTTP authorization", () => {
  jest.setTimeout(30000);
  let app: INestApplication<Server>;
  let database: DatabaseService;
  let pool: Pool;
  let repository: RelationalStreamsRepository;
  let environment: NodeJS.ProcessEnv;
  let directory: string;
  let alice: { id: string; cookie: string };
  let bob: { id: string; cookie: string };

  const http = () => request(app.getHttpServer());
  const get = (path: string, cookie = alice.cookie) => http().get(path).set("Cookie", cookie);
  const post = (path: string, payload: object, cookie = alice.cookie) =>
    http().post(path).set("Cookie", cookie).set("Origin", origin).send(payload);
  const patch = (path: string, payload: object, cookie = alice.cookie) =>
    http().patch(path).set("Cookie", cookie).set("Origin", origin).send(payload);
  const remove = (path: string, cookie = alice.cookie) =>
    http().delete(path).set("Cookie", cookie).set("Origin", origin);
  const targetPayload = (creator_id = "Alpha", quality = "best") => ({
    creator_id,
    channel_name: "channel",
    platform: "twitch",
    url: "https://example.test/channel",
    quality,
  });
  const target = async (cookie = alice.cookie, creator = "Alpha", quality = "best") =>
    (await post("/watch-targets", targetPayload(creator, quality), cookie).expect(201)).body as {
      id: string;
      creator_id: string;
      quality: string;
    };
  const snapshot = async () =>
    (
      await pool.query<{ [key: string]: unknown }>(`SELECT
    (SELECT jsonb_agg(row_to_json(item) ORDER BY id) FROM creators item) AS creators,
    (SELECT jsonb_agg(row_to_json(item) ORDER BY id) FROM watch_targets item) AS targets,
    (SELECT jsonb_agg(row_to_json(item) ORDER BY id) FROM streams item) AS streams,
    (SELECT jsonb_agg(row_to_json(item) ORDER BY id) FROM recordings item) AS recordings`)
    ).rows[0];

  async function startApi(connection = database) {
    const module = await Test.createTestingModule({ imports: [StreamsModule] })
      .overrideProvider(DatabaseService)
      .useValue({
        get connection() {
          return connection.connection;
        },
        transaction: connection.transaction.bind(connection) as DatabaseService["transaction"],
        resolveBootstrapLocalUser: connection.resolveBootstrapLocalUser.bind(
          connection,
        ) as DatabaseService["resolveBootstrapLocalUser"],
      })
      .overrideProvider(AUTH_OPTIONS)
      .useValue({ env: environment })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    repository = module.get(StreamsRepository);
    return module.get(AuthService);
  }

  async function history(watchTargetId: string) {
    const stream = await repository.createStream({
      watchTargetId,
      startedAt: "2026-01-01T00:00:00Z",
    });
    const recording = await repository.createRecording({
      watchTargetId,
      streamId: stream.id,
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T01:00:00Z",
      outputFile: "fixture.mp4",
    });
    return { stream, recording };
  }

  beforeAll(async () => {
    database = new DatabaseService(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
    pool.on("error", () => undefined);
    await database.migrate();
  });

  beforeEach(async () => {
    await pool.query<{ [key: string]: unknown }>(
      "TRUNCATE migration_manifests, worker_events, recordings, streams, watch_targets, creators, sessions, users",
    );
    directory = await mkdtemp(join(tmpdir(), "streamrecorder-authorization-"));
    process.env.CONFIG_DIR = directory;
    process.env.RECORDINGS_ROOT = directory;
    process.env.RELATIONAL_STORAGE = "true";
    process.env.PERSISTENCE_MODE = "bridge";
    for (const key of ["WATCHLIST_PATH", "CHANNELS_STATUS_PATH", "STREAMS_PATH", "SESSIONS_PATH"])
      delete process.env[key];
    environment = {
      IDENTITY_MODE: "authenticated",
      RELATIONAL_STORAGE: "true",
      AUTH_TRUSTED_ORIGINS: origin,
    };
    for (const username of ["alice", "bobby"]) {
      await runUsersCLI(["create", username], database, {
        readPassword: () => Promise.resolve(password),
        write: () => undefined,
      });
    }
    const auth = await startApi();
    const login = async (username: string) => {
      const result = await auth.login({ username, password }, { origin }, "127.0.0.1");
      return { id: result.user.id, cookie: `sr_session=${result.token}` };
    };
    alice = await login("alice");
    bob = await login("bobby");
  });

  afterEach(async () => {
    await app?.close();
    process.env = { ...originalEnvironment };
    await rm(directory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await database.resolveBootstrapLocalUser();
    await pool.end();
    await database.onModuleDestroy();
  });

  it("isolates all modern and legacy lists, UUID details, and parent filters in both directions", async () => {
    const first = await target();
    const second = await target(bob.cookie);
    const firstHistory = await history(first.id);
    const secondHistory = await history(second.id);
    expect(first.creator_id).not.toBe(second.creator_id);
    for (const [own, foreign, ownHistory, foreignHistory, cookie] of [
      [first, second, firstHistory, secondHistory, alice.cookie],
      [second, first, secondHistory, firstHistory, bob.cookie],
    ] as const) {
      for (const [path, id, key] of [
        ["creators", own.creator_id, "id"],
        ["watch-targets", own.id, "id"],
        ["streams", ownHistory.stream.id, "id"],
        ["recordings", ownHistory.recording.session_id, "session_id"],
        ["streamer", own.id, "id"],
        ["session", ownHistory.recording.session_id, "session_id"],
      ]) {
        const response = await get(`/${path}`, cookie).expect(200);
        expect(
          (response.body as Record<string, string>[]).map(
            (row: Record<string, string>) => row[key],
          ),
        ).toEqual([id]);
        await get(`/${path}/${id}`, cookie).expect(200);
      }
      for (const path of [
        `/creators/${foreign.creator_id}`,
        `/watch-targets/${foreign.id}`,
        `/streams/${foreignHistory.stream.id}`,
        `/recordings/${foreignHistory.recording.session_id}`,
        `/streamer/${foreign.id}`,
        `/session/${foreignHistory.recording.session_id}`,
        `/creators/${foreign.creator_id}/watch-targets`,
        `/recordings?watchTargetId=${foreign.id}`,
        `/session/channel/${foreign.id}`,
      ])
        await get(path, cookie).expect(404);
      await get("/creators/Alpha", cookie).expect(200);
      await get(`/creators/${own.creator_id}/watch-targets`, cookie).expect(200);
    }
    for (const id of [randomUUID(), "invalid"]) {
      await get(`/recordings?watchTargetId=${id}`).expect(404);
      await get(`/session/channel/${id}`).expect(404);
      await get(`/streamer/${id}`).expect(404);
      await get(`/session/${id}`).expect(404);
    }
  });

  it("rejects foreign mutations, forged ownership and foreign parent attachment without DB changes", async () => {
    const first = await target();
    const second = await target(bob.cookie);
    const before = await snapshot();
    for (const [foreign, cookie] of [
      [second, alice.cookie],
      [first, bob.cookie],
    ] as const) {
      await patch(`/creators/${foreign.creator_id}`, { display_name: "Stolen" }, cookie).expect(
        404,
      );
      await remove(`/creators/${foreign.creator_id}`, cookie).expect(404);
      await patch(`/watch-targets/${foreign.id}`, { quality: "720p" }, cookie).expect(404);
      await remove(`/watch-targets/${foreign.id}`, cookie).expect(404);
      await remove(`/streamer/${foreign.id}`, cookie).expect(404);
      await post("/watch-targets", targetPayload(foreign.creator_id), cookie).expect(404);
    }
    for (const field of ["owner_id", "ownerId"]) {
      const forged = { [field]: bob.id };
      await post("/creators", { display_name: "Forged", ...forged }).expect(400);
      await patch(`/creators/${first.creator_id}`, { display_name: "Forged", ...forged }).expect(
        400,
      );
      await post("/watch-targets", { ...targetPayload(), ...forged }).expect(400);
      await patch(`/watch-targets/${first.id}`, { quality: "720p", ...forged }).expect(400);
      await post("/streamer", {
        display_name: "Forged",
        channel_name: "channel",
        platform: "twitch",
        url: "https://example.test/channel",
        quality: "best",
        ...forged,
      }).expect(400);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("groups names per owner, preserves three independent siblings, and reports only same-owner ambiguity", async () => {
    const first = await target();
    const second = await target(alice.cookie, " alpha ", "1080p");
    const third = await target(alice.cookie, first.creator_id, "720p");
    const foreign = await target(bob.cookie);
    expect(second.creator_id).toBe(first.creator_id);
    expect(third.creator_id).toBe(first.creator_id);
    await patch(`/watch-targets/${first.id}`, { quality: "480p" }).expect(200);
    await patch(`/watch-targets/${second.id}`, { enabled: false }).expect(200);
    await remove(`/watch-targets/${third.id}`).expect(200);
    expect(
      ((await get(`/watch-targets/${first.id}`).expect(200)).body as { quality: unknown }).quality,
    ).toBe("480p");
    expect((await get(`/watch-targets/${second.id}`).expect(200)).body as unknown).toMatchObject({
      quality: "1080p",
      enabled: false,
    });
    expect(
      (await get(`/watch-targets/${foreign.id}`, bob.cookie).expect(200)).body as unknown,
    ).toEqual(foreign);
    await post("/creators", { display_name: "ALPHA" }).expect(201);
    await get("/creators/alpha").expect(409);
    await get("/creators/alpha/watch-targets").expect(409);
    await post("/watch-targets", targetPayload()).expect(409);
    await get("/creators/alpha", bob.cookie).expect(200);
    await get(`/creators/${first.creator_id}`).expect(200);
    const legacy = (
      await post("/streamer", {
        display_name: "Legacy",
        channel_name: "channel",
        platform: "twitch",
        url: "https://example.test/channel",
        quality: "best",
      }).expect(201)
    ).body as { id: string };
    await get(`/streamer/${legacy.id}`).expect(200);
    await get(`/streamer/${legacy.id}`, bob.cookie).expect(404);
    await remove(`/streamer/${legacy.id}`).expect(200);
  });

  it("retains owner access to archived and NULL-stream history without exposing it to another user", async () => {
    const first = await target();
    const existing = await history(first.id);
    const legacy = await repository.createRecording({
      watchTargetId: first.id,
      streamId: null,
      startedAt: "2025-01-01T00:00:00Z",
    });
    await remove(`/watch-targets/${first.id}`).expect(200);
    await remove(`/creators/${first.creator_id}`).expect(200);
    await get(`/creators/${first.creator_id}`).expect(404);
    await get(`/watch-targets/${first.id}`).expect(404);
    for (const id of [existing.recording.session_id, legacy.session_id]) {
      await get(`/recordings/${id}`).expect(200);
      await get(`/session/${id}`).expect(200);
      await get(`/recordings/${id}`, bob.cookie).expect(404);
      await get(`/session/${id}`, bob.cookie).expect(404);
    }
    await get(`/streams/${existing.stream.id}`).expect(200);
    await get(`/streams/${existing.stream.id}`, bob.cookie).expect(404);
    for (const path of [`/recordings?watchTargetId=${first.id}`, `/session/channel/${first.id}`]) {
      expect((await get(path).expect(200)).body as unknown).toHaveLength(2);
      await get(path, bob.cookie).expect(404);
    }
    expect(
      ((await get(`/recordings/${legacy.session_id}`).expect(200)).body as { stream_id: unknown })
        .stream_id,
    ).toBeUndefined();
  });

  it("keeps interleaved concurrent requests isolated and ignores forged query/header identities", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => target(index % 2 ? alice.cookie : bob.cookie)),
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const user = index % 2 ? alice : bob;
        const response = await get(
          `/watch-targets?owner_id=${user === alice ? bob.id : alice.id}`,
          user.cookie,
        )
          .set("x-owner-id", user === alice ? bob.id : alice.id)
          .expect(200);
        expect(response.body as unknown).toHaveLength(4);
        const ids = (response.body as Record<string, string>[]).map(
          (row: { id: string }) => row.id,
        );
        const persisted = await pool.query<{ owner_id: string }>(
          "SELECT owner_id FROM watch_targets WHERE id=ANY($1::uuid[])",
          [ids],
        );
        expect(persisted.rows.every((row) => row.owner_id === user.id)).toBe(true);
      }),
    );
    expect(results).toHaveLength(20);
  });

  it("requires live human sessions and trusted Origin/Referer before unsafe domain operations", async () => {
    const first = await target();
    for (const path of [
      "/creators",
      "/watch-targets",
      "/streams",
      "/recordings",
      "/streamer",
      "/session",
      "/recordings/filesystem",
      `/recordings/${randomUUID()}/location`,
    ]) {
      await http().get(path).expect(401);
      await http().get(path).set("x-internal-token", "test-only-worker-token").expect(401);
      await http().get(path).set("Cookie", "sr_session=invalid").expect(401);
    }
    const before = await snapshot();
    for (const headers of [
      {},
      { Origin: "http://evil.test" },
      { Referer: "http://evil.test/page" },
    ]) {
      await http()
        .post("/creators")
        .set("Cookie", alice.cookie)
        .set(headers)
        .send({ display_name: "Blocked" })
        .expect(403);
      await http()
        .patch(`/watch-targets/${first.id}`)
        .set("Cookie", alice.cookie)
        .set(headers)
        .send({ enabled: false })
        .expect(403);
      await http()
        .delete(`/watch-targets/${first.id}`)
        .set("Cookie", alice.cookie)
        .set(headers)
        .expect(403);
    }
    expect(await snapshot()).toEqual(before);
    await http()
      .patch(`/watch-targets/${first.id}`)
      .set("Cookie", alice.cookie)
      .set("Referer", `${origin}/targets`)
      .send({ enabled: false })
      .expect(200);
    await pool.query<{ [key: string]: unknown }>(
      "UPDATE sessions SET idle_expires_at=NOW()-interval '1 second' WHERE token_hash=$1",
      [tokenHash(alice.cookie.split("=")[1])],
    );
    await get("/creators").expect(401);
    await pool.query<{ [key: string]: unknown }>(
      "UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1",
      [bob.id],
    );
    await get("/creators", bob.cookie).expect(401);
    const auth = app.get(AuthService);
    const session = await auth.login({ username: "alice", password }, { origin }, "127.0.0.1");
    await pool.query<{ [key: string]: unknown }>("UPDATE users SET disabled_at=NOW() WHERE id=$1", [
      alice.id,
    ]);
    await get("/creators", `sr_session=${session.token}`).expect(401);
  });

  it("hides tree browsing and foreign locations and preserves local-bootstrap-only domain visibility", async () => {
    const foreign = await target();
    const foreignHistory = await history(foreign.id);
    const filesystem = app.get(RecordingsFilesystemService);
    const list = jest.spyOn(filesystem, "list");
    const location = jest.spyOn(filesystem, "location");
    for (const path of [
      "/recordings/filesystem",
      `/recordings/${foreignHistory.recording.session_id}/location`,
    ]) {
      await http().get(path).expect(401);
      if (path === "/recordings/filesystem") await get(path).expect(404);
      await get(path, bob.cookie).expect(404);
    }
    expect(list).not.toHaveBeenCalled();
    expect(location).not.toHaveBeenCalled();
    list.mockRestore();
    location.mockRestore();
    environment.IDENTITY_MODE = "local";
    const local = await target();
    const localOwner = await database.resolveBootstrapLocalUser();
    expect(
      (
        await pool.query<{ owner_id: string }>("SELECT owner_id FROM watch_targets WHERE id=$1", [
          local.id,
        ])
      ).rows[0].owner_id,
    ).toBe(localOwner);
    const localHistory = await history(local.id);
    await writeFile(join(directory, "fixture.mp4"), "synthetic fixture");
    for (const [path, key, id] of [
      ["creators", "id", local.creator_id],
      ["watch-targets", "id", local.id],
      ["streams", "id", localHistory.stream.id],
      ["recordings", "session_id", localHistory.recording.session_id],
      ["streamer", "id", local.id],
      ["session", "session_id", localHistory.recording.session_id],
    ])
      expect(
        ((await http().get(`/${path}`).expect(200)).body as Record<string, string>[]).map(
          (row: Record<string, string>) => row[key],
        ),
      ).toEqual([id]);
    await http().get(`/recordings/${foreignHistory.recording.session_id}`).expect(404);
    await http().get("/recordings/filesystem").expect(200);
    await http().get(`/recordings/${localHistory.recording.session_id}/location`).expect(200);
    await http().get(`/recordings/${foreignHistory.recording.session_id}/location`).expect(404);
    expect(
      (
        await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM watch_targets WHERE owner_id=$1",
          [alice.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("preserves other-owner history and Worker visibility during explicit relational/local rollback", async () => {
    process.env.INTERNAL_API_TOKEN = "test-only-rollback-worker";
    const first = await target();
    const second = await target(bob.cookie);
    await history(first.id);
    await history(second.id);
    const before = await snapshot();
    await post("/auth/logout", {}).expect(200);
    await get("/recordings").expect(401);

    await app.close();
    environment.IDENTITY_MODE = "local";
    await startApi();
    const localOwner = await database.resolveBootstrapLocalUser();
    expect(await database.resolveBootstrapLocalUser()).toBe(localOwner);
    for (const path of [
      "creators",
      "watch-targets",
      "streams",
      "recordings",
      "streamer",
      "session",
    ])
      expect((await http().get(`/${path}`).expect(200)).body as unknown).toEqual([]);
    await http().get(`/watch-targets/${first.id}`).expect(404);
    await http().get(`/watch-targets/${second.id}`).expect(404);
    const configs = async () =>
      (
        await http()
          .get("/internal/v1/watch-targets/execution-configs")
          .set("X-Internal-Token", process.env.INTERNAL_API_TOKEN!)
          .expect(200)
      ).body as { id: string }[];
    expect((await configs()).map((entry) => entry.id).sort()).toEqual([first.id, second.id].sort());
    await runUsersCLI(["disable", "bobby"], database, { write: () => undefined });
    expect((await configs()).map((entry) => entry.id)).toEqual([first.id]);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await pool.query<{ revoked: boolean }>(
          "SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE user_id = ANY($1::uuid[])",
          [[alice.id, bob.id]],
        )
      ).rows.every((row) => row.revoked),
    ).toBe(true);

    await app.close();
    environment.IDENTITY_MODE = "authenticated";
    await startApi();
    await get("/watch-targets").expect(401);
    await get("/watch-targets", bob.cookie).expect(401);
  });

  it("returns only owned file metadata even when two owners share a directory", async () => {
    const first = await target();
    const second = await target(bob.cookie);
    await patch(`/watch-targets/${first.id}`, { recording_subdir: "shared" }).expect(200);
    await patch(`/watch-targets/${second.id}`, { recording_subdir: "shared" }, bob.cookie).expect(
      200,
    );
    const own = await history(first.id);
    const other = await history(second.id);
    await mkdir(join(directory, "shared"));
    await writeFile(join(directory, "shared", "alice.mp4"), "alice");
    await writeFile(join(directory, "shared", "bob-private.mp4"), "bob");
    await pool.query<{ [key: string]: unknown }>(
      "UPDATE recordings SET output_file=$1 WHERE id=$2",
      ["shared/alice.mp4", own.recording.session_id],
    );
    await pool.query<{ [key: string]: unknown }>(
      "UPDATE recordings SET output_file=$1 WHERE id=$2",
      ["shared/bob-private.mp4", other.recording.session_id],
    );
    const list = jest.spyOn(app.get(RecordingsFilesystemService), "list");
    const location = `/recordings/${own.recording.session_id}/location`;
    expect((await get(location).expect(200)).body as unknown).toEqual({
      status: "available",
      file: "alice.mp4",
      subdir: "shared",
      size: 5,
    });
    expect(
      (await get(`/recordings/${other.recording.session_id}/location`, bob.cookie).expect(200))
        .body as unknown,
    ).toEqual({ status: "available", file: "bob-private.mp4", subdir: "shared", size: 3 });
    await get(location, bob.cookie).expect(404);
    await get(`/recordings/${other.recording.session_id}/location`).expect(404);
    await get(`/recordings/${randomUUID()}/location`).expect(404);
    await rm(join(directory, "shared", "alice.mp4"));
    expect((await get(location).expect(200)).body as unknown).toEqual({
      status: "file_not_found",
      file: "alice.mp4",
      subdir: "shared",
    });
    for (const output of [
      "absent/alice.mp4",
      "../private.mp4",
      "shared/../private.mp4",
      "C:\\private.mp4",
    ]) {
      await pool.query<{ [key: string]: unknown }>(
        "UPDATE recordings SET output_file=$1 WHERE id=$2",
        [output, own.recording.session_id],
      );
      expect((await get(location).expect(200)).body as unknown).toEqual({
        status: "directory_unavailable",
      });
    }
    await symlink(join(directory, "shared"), join(directory, "link"), "junction");
    await pool.query<{ [key: string]: unknown }>(
      "UPDATE recordings SET output_file=$1 WHERE id=$2",
      ["link/bob-private.mp4", own.recording.session_id],
    );
    expect((await get(location).expect(200)).body as unknown).toEqual({
      status: "directory_unavailable",
    });
    expect(list).not.toHaveBeenCalled();
    list.mockRestore();
  });

  it.each(["logout", "expiry", "disablement"])(
    "persists accepted service work after human session %s",
    async (change) => {
      process.env.INTERNAL_API_TOKEN = "test-only-ownership-worker";
      const own = await target();
      const start = {
        event_id: randomUUID(),
        event_type: "recording.start",
        watch_target_id: own.id,
        session_id: randomUUID(),
        stream_id: randomUUID(),
        occurred_at: new Date().toISOString(),
      };
      const servicePost = (payload: object) =>
        http()
          .post("/internal/v1/events")
          .set("X-Internal-Token", process.env.INTERNAL_API_TOKEN!)
          .send(payload);
      await http().post("/internal/v1/events").set("Cookie", alice.cookie).send(start).expect(401);
      await servicePost(start).expect(201);
      if (change === "logout") await post("/auth/logout", {}).expect(200);
      else if (change === "expiry")
        await pool.query<{ [key: string]: unknown }>(
          "UPDATE sessions SET idle_expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
          [alice.id],
        );
      else
        await pool.query<{ [key: string]: unknown }>(
          "UPDATE users SET disabled_at=NOW() WHERE id=$1",
          [alice.id],
        );
      await get("/recordings").expect(401);
      const terminal = {
        ...start,
        event_id: randomUUID(),
        event_type: "recording.terminal",
        state: "finished",
        occurred_at: new Date().toISOString(),
      };
      const accepted = (await servicePost(terminal).expect(201)).body as unknown;
      expect((await servicePost(terminal).expect(201)).body as unknown).toEqual(accepted);
      expect(
        (
          await pool.query<{ owner_id: string; state: string }>(
            "SELECT owner_id, state FROM recordings WHERE id=$1",
            [start.session_id],
          )
        ).rows,
      ).toEqual([{ owner_id: alice.id, state: "finished" }]);
      expect(
        (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM worker_events"))
          .rows[0].count,
      ).toBe(2);
    },
  );

  it("returns safe 503 errors for auth and scoped repository database outages without JSON fallback", async () => {
    await target();
    const unavailable = new DatabaseService(
      "postgresql://synthetic:synthetic@127.0.0.1:1/streamrecorder_test",
    );
    const failedRepository = new RelationalStreamsRepository(unavailable);
    try {
      for (const operation of [
        () => failedRepository.findAllCreators(alice.id),
        () => failedRepository.findAllWatchTargets(alice.id),
        () => failedRepository.findAllStreams(alice.id),
        () => failedRepository.findAllRecordings(alice.id),
        () => failedRepository.findAllSessions(alice.id),
        () => failedRepository.findAllStreamer(alice.id),
        () => failedRepository.createCreator({ display_name: "Unavailable" }, alice.id),
      ])
        await expect(operation()).rejects.toMatchObject({
          status: 503,
          message: "Database unavailable",
        });
      await expect(repository.findAllCreators("")).rejects.toMatchObject({ status: 400 });
      await expect(repository.findAllCreators("not-a-uuid")).rejects.toMatchObject({ status: 400 });
      await app.close();
      await startApi(unavailable);
      expect(((await get("/creators").expect(503)).body as { message: unknown }).message).toBe(
        "Database unavailable",
      );
      environment.IDENTITY_MODE = "local";
      expect(
        ((await http().get("/watch-targets").expect(503)).body as { message: unknown }).message,
      ).toBe("Database unavailable");
    } finally {
      await unavailable.onModuleDestroy();
    }
  });
});
