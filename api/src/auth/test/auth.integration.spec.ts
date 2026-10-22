import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseService } from "../../database/database.service";
import { AuthModule } from "../auth.module";
import type { AuthOptions } from "../auth.service";
import { AUTH_OPTIONS } from "../auth.service";
import { ABSOLUTE_MS, IDLE_MS, SLIDING_MS, tokenHash } from "../auth.repository";
import { runUsersCLI } from "../users-cli";

const databaseUrl = process.env.RELATIONAL_TEST_DATABASE_URL;
if (
  databaseUrl &&
  (new URL(databaseUrl).pathname !== "/streamrecorder_test" ||
    new URL(databaseUrl).port !== "55432")
) {
  throw new Error("Auth tests require isolated streamrecorder_test on port 55432");
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const password = "synthetic-password-123";
const origin = "http://localhost:3000";
const httpsOrigin = "https://app.example.test";

describeDatabase("authentication and session lifecycle", () => {
  let pool: Pool;
  let database: DatabaseService;
  let app: INestApplication<Server>;
  let time: number;
  let environment: NodeJS.ProcessEnv;

  async function startApi(overrideDatabase = database) {
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(DatabaseService)
      .useValue({
        transaction: overrideDatabase.transaction.bind(
          overrideDatabase,
        ) as DatabaseService["transaction"],
        resolveBootstrapLocalUser: overrideDatabase.resolveBootstrapLocalUser.bind(
          overrideDatabase,
        ) as DatabaseService["resolveBootstrapLocalUser"],
      })
      .overrideProvider(AUTH_OPTIONS)
      .useValue({ env: environment, now: () => new Date(time) } satisfies AuthOptions)
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useLogger(false);
    await app.init();
  }

  const cli = (args: string[], write = jest.fn<void, [string]>()) =>
    runUsersCLI(args, database, { readPassword: () => Promise.resolve(password), write });
  const login = (username = "alice", suppliedPassword = password, trustedOrigin = origin) =>
    request(app.getHttpServer())
      .post("/auth/login")
      .set("Origin", trustedOrigin)
      .send({ username, password: suppliedPassword });
  const cookie = (response: request.Response): string =>
    (response.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  const session = (value: string) =>
    request(app.getHttpServer()).get("/auth/session").set("Cookie", value);

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    pool.on("error", () => undefined);
    database = new DatabaseService(databaseUrl);
    await database.migrate();
  });

  beforeEach(async () => {
    await pool.query<{ [key: string]: unknown }>(
      "TRUNCATE migration_manifests, worker_events, recordings, streams, watch_targets, creators, sessions, users",
    );
    time = Date.parse("2026-01-01T00:00:00Z");
    environment = {
      IDENTITY_MODE: "authenticated",
      RELATIONAL_STORAGE: "true",
      AUTH_TRUSTED_ORIGINS: `${origin},${httpsOrigin}`,
    };
    await cli(["create", "Alice", "--email", "Alice@Example.Test"]);
    await startApi();
  });

  afterEach(async () => {
    await app?.close();
  });
  afterAll(async () => {
    await database.resolveBootstrapLocalUser();
    await pool.end();
    await database.onModuleDestroy();
  });

  it("provisions, lists and enables accounts while preserving bootstrap UUID and domain rows", async () => {
    const localId = await database.resolveBootstrapLocalUser();
    await cli(["set-password", "LOCAL"]);
    const local = (
      await pool.query<{
        id: string;
        username: string;
        email: string | null;
        password_hash: string | null;
        failed_login_count: number;
        locked_until: Date | null;
      }>("SELECT * FROM users WHERE bootstrap_key='local'")
    ).rows[0];
    expect(local.id).toBe(localId);
    expect(local.password_hash).toMatch(/^scrypt\$/);
    await pool.query<{ [key: string]: unknown }>(
      "INSERT INTO creators (id,owner_id,display_name,normalized_key) VALUES (gen_random_uuid(),$1,'Fixture','fixture')",
      [localId],
    );
    await cli(["disable", "local"]);
    await cli(["enable", "local"]);
    expect(
      (
        await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM creators WHERE owner_id=$1",
          [localId],
        )
      ).rows[0].count,
    ).toBe(1);
    const write = jest.fn<void, [string]>();
    await cli(["list"], write);
    const output = write.mock.calls[0][0];
    expect(JSON.parse(output)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: localId,
          username: "local",
          enabled: true,
          has_password: true,
        }),
      ]),
    );
    expect(output).not.toMatch(/password_hash|scrypt\$|bootstrap_key/);
    await expect(cli(["create", "alice"])).rejects.toThrow();
    await expect(cli(["enable", "missing"])).rejects.toThrow("User not found");
  });

  it("returns explicit local JSON/relational summaries and hides login/logout", async () => {
    environment.IDENTITY_MODE = "local";
    environment.RELATIONAL_STORAGE = "false";
    expect(
      (await request(app.getHttpServer()).get("/auth/session").expect(200)).body as unknown,
    ).toEqual({ identityMode: "local", persistence: "json", user: null });
    await login().expect(404);
    await request(app.getHttpServer()).post("/auth/logout").expect(404);
    environment.RELATIONAL_STORAGE = "true";
    const summary = (await request(app.getHttpServer()).get("/auth/session").expect(200))
      .body as unknown;
    expect(summary).toEqual({
      identityMode: "local",
      persistence: "relational",
      user: { id: await database.resolveBootstrapLocalUser(), username: "local", email: null },
    });
  });

  it("hashes tokens, rotates sessions and returns only public identity with no-store", async () => {
    const first = await login().expect(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body as unknown).toEqual({
      identityMode: "authenticated",
      persistence: "relational",
      user: { id: expect.any(String) as unknown, username: "alice", email: "alice@example.test" },
    });
    const firstCookie = cookie(first);
    expect((first.headers["set-cookie"] as unknown as string[])[0]).toMatch(
      /; HttpOnly; Path=\/; SameSite=Lax$/,
    );
    expect((first.headers["set-cookie"] as unknown as string[])[0]).not.toMatch(/Domain|Secure/);
    const row = (
      await pool.query<{
        id: string;
        token_hash: string;
        last_used_at: Date;
        idle_expires_at: Date;
        absolute_expires_at: Date;
      }>("SELECT * FROM sessions")
    ).rows[0];
    expect(row.token_hash).toBe(tokenHash(firstCookie.split("=")[1]));
    expect(row.token_hash).not.toBe(firstCookie.split("=")[1]);
    await session(firstCookie).expect(200);
    const second = await request(app.getHttpServer())
      .post("/auth/login")
      .set("Origin", httpsOrigin)
      .set("Cookie", firstCookie)
      .send({ username: "alice", password })
      .expect(200);
    expect((second.headers["set-cookie"] as unknown as string[])[0]).toContain("; Secure");
    expect(cookie(second)).not.toBe(firstCookie);
    await session(firstCookie).expect(401);
    await session(cookie(second)).expect(200);
  });

  it("enforces sliding throttling, idle expiry and the absolute seven-day cap", async () => {
    const value = cookie(await login().expect(200));
    const initial = (
      await pool.query<{
        id: string;
        token_hash: string;
        last_used_at: Date;
        idle_expires_at: Date;
        absolute_expires_at: Date;
      }>("SELECT * FROM sessions")
    ).rows[0];
    time += SLIDING_MS - 1;
    await session(value).expect(200);
    expect(
      (await pool.query<{ last_used_at: Date | null }>("SELECT last_used_at FROM sessions")).rows[0]
        .last_used_at,
    ).toEqual(initial.last_used_at);
    time++;
    await session(value).expect(200);
    expect(
      (
        await pool.query<{ idle_expires_at: Date }>("SELECT idle_expires_at FROM sessions")
      ).rows[0].idle_expires_at.getTime(),
    ).toBe(time + IDLE_MS);
    time += IDLE_MS;
    await session(value).expect(401);
    const fresh = cookie(await login().expect(200));
    const created = time;
    for (let day = 1; day <= 6; day++) {
      time = created + day * (IDLE_MS - 1000);
      await session(fresh).expect(200);
    }
    const latest = (
      await pool.query<{ idle_expires_at: Date; absolute_expires_at: Date }>(
        "SELECT idle_expires_at, absolute_expires_at FROM sessions",
      )
    ).rows[0];
    expect(latest.idle_expires_at.getTime()).toBe(created + ABSOLUTE_MS - 6000);
    time = created + ABSOLUTE_MS - 7000;
    await session(fresh).expect(200);
    expect(
      (
        await pool.query<{ idle_expires_at: Date }>("SELECT idle_expires_at FROM sessions")
      ).rows[0].idle_expires_at.getTime(),
    ).toBe(created + ABSOLUTE_MS);
    time = created + ABSOLUTE_MS;
    await session(fresh).expect(401);
  });

  it("revokes on logout and disablement, rejects repeated logout, and enables explicitly", async () => {
    const value = cookie(await login().expect(200));
    const logout = () =>
      request(app.getHttpServer()).post("/auth/logout").set("Origin", origin).set("Cookie", value);
    const response = await logout().expect(200);
    expect((response.headers["set-cookie"] as unknown as string[])[0]).toBe(
      "sr_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
    );
    await logout().expect(401);
    await session(value).expect(401);
    const next = cookie(await login().expect(200));
    await cli(["disable", "alice"]);
    await session(next).expect(401);
    expect(
      (
        await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM sessions WHERE revoked_at IS NULL",
        )
      ).rows[0].count,
    ).toBe(0);
    expect((await login().expect(401)).body as unknown).toEqual({ message: "Invalid credentials" });
    await cli(["enable", "alice"]);
    await login().expect(200);
    await pool.query<{ [key: string]: unknown }>(
      "UPDATE users SET disabled_at=NOW() WHERE username='alice'",
    );
    const token = cookie(
      await (async () => {
        await cli(["enable", "alice"]);
        return login().expect(200);
      })(),
    );
    await pool.query<{ [key: string]: unknown }>(
      "UPDATE users SET disabled_at=NOW() WHERE username='alice'",
    );
    await session(token).expect(401);
  });

  it("atomically locks after ten concurrent failures and unlocks only after fifteen minutes", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => login("alice", "wrong-password-123")),
    );
    expect(
      results.every(
        (response) =>
          response.status === 401 &&
          JSON.stringify(response.body as unknown) ===
            JSON.stringify({ message: "Invalid credentials" }),
      ),
    ).toBe(true);
    const locked = (
      await pool.query<{ failed_login_count: number; locked_until: Date }>(
        "SELECT failed_login_count, locked_until FROM users WHERE username='alice'",
      )
    ).rows[0];
    expect(locked.failed_login_count).toBe(10);
    expect(locked.locked_until.getTime()).toBe(time + 15 * 60 * 1000);
    await login().expect(401);
    time += 15 * 60 * 1000 - 1;
    await login().expect(401);
    time++;
    await login().expect(200);
    expect(
      (
        await pool.query<{ failed_login_count: number; locked_until: Date }>(
          "SELECT failed_login_count, locked_until FROM users WHERE username='alice'",
        )
      ).rows[0],
    ).toEqual({ failed_login_count: 0, locked_until: null });
  });

  it("restarts the failure count after an expired lock and resets it on password enrollment", async () => {
    await pool.query<{ [key: string]: unknown }>(
      "UPDATE users SET failed_login_count=10, locked_until=$1 WHERE username='alice'",
      [new Date(time - 1)],
    );
    await login("alice", "wrong-password-123").expect(401);
    expect(
      (
        await pool.query<{ failed_login_count: number }>(
          "SELECT failed_login_count FROM users WHERE username='alice'",
        )
      ).rows[0].failed_login_count,
    ).toBe(1);
    await cli(["set-password", "alice"]);
    expect(
      (
        await pool.query<{ failed_login_count: number; locked_until: Date }>(
          "SELECT failed_login_count, locked_until FROM users WHERE username='alice'",
        )
      ).rows[0],
    ).toEqual({ failed_login_count: 0, locked_until: null });
  });

  it("returns uniform failures and limits source-IP attempts despite forged forwarding headers", async () => {
    for (let count = 0; count < 20; count++) {
      const response = await request(app.getHttpServer())
        .post("/auth/login")
        .set("Origin", origin)
        .set("X-Forwarded-For", `198.51.100.${count}`)
        .send({ username: "missing", password })
        .expect(401);
      expect(response.body as unknown).toEqual({ message: "Invalid credentials" });
    }
    await login().expect(429);
    time += 15 * 60 * 1000;
    await login().expect(200);
  });

  it("requires trusted Origin/Referer on unsafe routes and ignores internal credentials", async () => {
    for (const headers of [{}, { Origin: "http://evil.test" }, { Origin: "null" }]) {
      const response = await request(app.getHttpServer())
        .post("/auth/login")
        .set(headers)
        .send({ username: "alice", password })
        .expect(403);
      expect(response.headers["cache-control"]).toBe("no-store");
      await request(app.getHttpServer()).post("/auth/logout").set(headers).expect(403);
    }
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .set("Referer", `${origin}/login`)
      .send({ username: "alice", password })
      .expect(200);
    await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Referer", `${origin}/page`)
      .set("Cookie", cookie(response))
      .expect(200);
    await request(app.getHttpServer())
      .get("/auth/session")
      .set("x-internal-token", "test-only-worker-token")
      .expect(401);
    for (const body of [
      {},
      { username: 123, password },
      { username: "ab", password },
      { username: "alice", password: "short" },
      { username: "alice", password: "x".repeat(257) },
    ]) {
      expect(
        (
          await request(app.getHttpServer())
            .post("/auth/login")
            .set("Origin", origin)
            .send(body)
            .expect(401)
        ).body as unknown,
      ).toEqual({ message: "Invalid credentials" });
    }
    environment.AUTH_TRUSTED_ORIGINS = "";
    await login().expect(403);
  });

  it("fails closed with bounded 503 errors on a real database connection failure", async () => {
    const value = cookie(await login().expect(200));
    await app.close();
    const unavailable = new DatabaseService(
      "postgresql://synthetic:synthetic@127.0.0.1:1/streamrecorder_test",
    );
    try {
      await startApi(unavailable);
      expect(((await session(value).expect(503)).body as { message: unknown }).message).toBe(
        "Database unavailable",
      );
      await login().expect(503);
      environment.IDENTITY_MODE = "local";
      await request(app.getHttpServer()).get("/auth/session").expect(503);
    } finally {
      await unavailable.onModuleDestroy();
    }
  });

  it("retains a valid session across API recreation and an isolated database restart", async () => {
    const value = cookie(await login().expect(200));
    await app.close();
    if (process.env.BRIDGE_TEST_DB_RESTART === "true") {
      for (const operation of [
        ["stop", "postgres-test"],
        ["up", "-d", "--wait", "postgres-test"],
      ]) {
        const result = spawnSync(
          "docker",
          ["compose", "-f", "compose.test-db.yml", "-p", "streamrecorder-test-db", ...operation],
          { cwd: join(__dirname, "../../../.."), encoding: "utf8" },
        );
        if (result.status !== 0)
          throw new Error(`Isolated database restart failed: ${result.stderr}`);
      }
    }
    await database.onModuleDestroy();
    database = new DatabaseService(databaseUrl);
    await startApi();
    await session(value).expect(200);
    await database.onModuleDestroy();
    database = new DatabaseService(databaseUrl);
  }, 60000);
});
