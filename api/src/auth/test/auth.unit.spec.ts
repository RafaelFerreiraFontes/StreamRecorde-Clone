import {
  hashPassword,
  normalizeEmail,
  normalizeUsername,
  validatePasswordInput,
  verifyDummyPassword,
  verifyPassword,
} from "../credentials";
import { parseTrustedOrigins, requireTrustedOrigin } from "../origin-policy";
import { LoginRateLimiter, LOGIN_WINDOW_MS } from "../rate-limiter";
import { readSessionToken, sessionCookie } from "../session-cookie";
import { readPassword, runUsersCLI } from "../users-cli";
import { PassThrough } from "node:stream";
import type { DatabaseService } from "../../database/database.service";
import { AuthService } from "../auth.service";
import type { AuthRepository } from "../auth.repository";
import { AuthController } from "../auth.controller";
import { NotFoundException } from "@nestjs/common";
import type { Request } from "express";

describe("credentials", () => {
  it("normalizes identifiers and rejects invalid values", () => {
    expect(normalizeUsername("  Ａlice.Name ")).toBe("alice.name");
    expect(normalizeEmail(" Alice@Example.Test ")).toBe("alice@example.test");
    expect(normalizeEmail(" ")).toBeNull();
    expect(normalizeEmail()).toBeNull();
    for (const username of ["ab", "a b", "-alice", "a".repeat(33)])
      expect(() => normalizeUsername(username)).toThrow();
    for (const email of ["alice", "a@b\n.test", "a@@b"])
      expect(() => normalizeEmail(email)).toThrow();
  });

  it("enforces password bounds", () => {
    for (const value of [null, 123, "a".repeat(11), "a".repeat(257)])
      expect(() => validatePasswordInput(value)).toThrow();
    expect(validatePasswordInput("a".repeat(12))).toHaveLength(12);
    expect(validatePasswordInput("a".repeat(256))).toHaveLength(256);
  });

  it("uses salted scrypt and safely rejects malformed hashes", async () => {
    const password = "test-password-123";
    const first = await hashPassword(password);
    expect(first).toMatch(/^scrypt\$v1\$32768\$8\$1\$/);
    expect(await hashPassword(password)).not.toBe(first);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("wrong-password", first)).toBe(false);
    for (const hash of [
      null,
      undefined,
      "invalid",
      first.replace("32768", "999999999"),
      first + "!",
      first.replace("$v1$", "$v2$"),
    ]) {
      expect(await verifyPassword(password, hash)).toBe(false);
    }
    expect(await verifyDummyPassword()).toBe(false);
    expect(await verifyPassword("a".repeat(257), first)).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow();
  });
});

describe("auth security boundaries", () => {
  it.each(["", "local"])(
    "resolves local sessions and hides login/logout for IDENTITY_MODE=%j",
    async (mode) => {
      const repository = { localUser: jest.fn(), session: jest.fn() };
      const auth = new AuthService(repository as unknown as AuthRepository, {
        env: { IDENTITY_MODE: mode },
      });
      const controller = new AuthController(auth);
      const getSession = () => controller.session({ headers: {} } as Request);
      await expect(getSession()).resolves.toMatchObject({
        identityMode: "local",
        persistence: "json",
        user: null,
      });
      await expect(auth.resolvePrincipal()).resolves.toMatchObject({ kind: "local-json" });
      await expect(auth.login({}, {}, "ip")).rejects.toBeInstanceOf(NotFoundException);
      await expect(auth.logout({})).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.localUser).not.toHaveBeenCalled();
      expect(repository.session).not.toHaveBeenCalled();
    },
  );

  it("requires exact configured origins, with Referer fallback only when Origin is absent", () => {
    const trusted = parseTrustedOrigins("http://localhost:3000, https://app.example.test");
    expect(requireTrustedOrigin({ origin: "http://localhost:3000" }, trusted)).toBe(
      "http://localhost:3000",
    );
    expect(requireTrustedOrigin({ referer: "https://app.example.test/view" }, trusted)).toBe(
      "https://app.example.test",
    );
    for (const headers of [
      {},
      { origin: "null" },
      { origin: "http://evil.test" },
      { origin: "", referer: "http://localhost:3000" },
      { origin: "http://localhost:3000/" },
    ]) {
      expect(() => requireTrustedOrigin(headers, trusted)).toThrow("Untrusted origin");
    }
    expect(() =>
      requireTrustedOrigin({ origin: "http://localhost:3000" }, parseTrustedOrigins()),
    ).toThrow();
    for (const value of [
      "*",
      "https://*.example.test",
      "https://app.test/",
      "ftp://app.test",
      "https://app.test?q=1",
      "https://user:pass@app.test",
      "https://app.test,",
    ]) {
      expect(() => parseTrustedOrigins(value)).toThrow();
    }
  });

  it("bounds IP attempts and memory, then releases expired entries", () => {
    let time = 0;
    const limiter = new LoginRateLimiter(() => new Date(time), 1);
    for (let count = 0; count < 20; count++) limiter.attempt("address-one");
    expect(() => limiter.attempt("address-one")).toThrow("Too many login attempts");
    expect(() => limiter.attempt("address-two")).toThrow();
    time += LOGIN_WINDOW_MS;
    expect(() => limiter.attempt("address-two")).not.toThrow();
  });

  it("formats host-only cookies and rejects duplicate or malformed cookie tokens", () => {
    const token = "a".repeat(43);
    expect(sessionCookie(token, "http://localhost")).toBe(
      `sr_session=${token}; HttpOnly; Path=/; SameSite=Lax`,
    );
    expect(sessionCookie(token, "https://app.test")).toContain("; Secure");
    expect(sessionCookie("", "https://app.test", true)).toBe(
      "sr_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure",
    );
    expect(readSessionToken(`other=1; sr_session=${token}`)).toBe(token);
    for (const cookie of [
      undefined,
      "sr_session=invalid",
      `sr_session=${token}; sr_session=${token}`,
    ])
      expect(readSessionToken(cookie)).toBeUndefined();
  });

  it("separates local JSON from human relational identity and fails closed", async () => {
    const repository = {
      localUser: jest.fn().mockRejectedValue(new Error("private-db-error")),
      session: jest.fn(),
    };
    const local = new AuthService(repository as unknown as AuthRepository, { env: {} });
    expect(await local.resolvePrincipal()).toEqual({
      kind: "local-json",
      identityMode: "local",
      persistence: "json",
      user: null,
    });
    await expect(local.login({}, {}, "ip")).rejects.toMatchObject({ status: 404 });
    await expect(local.logout({})).rejects.toMatchObject({ status: 404 });
    await expect(
      new AuthService(repository as unknown as AuthRepository, {
        env: { RELATIONAL_STORAGE: "true" },
      }).resolvePrincipal(),
    ).rejects.toMatchObject({ status: 503, message: "Database unavailable" });
    await expect(
      new AuthService(repository as unknown as AuthRepository, {
        env: { IDENTITY_MODE: "authenticated" },
      }).resolvePrincipal(),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      new AuthService(repository as unknown as AuthRepository, {
        env: { IDENTITY_MODE: "authenticated", RELATIONAL_STORAGE: "true" },
      }).resolvePrincipal(),
    ).rejects.toMatchObject({ status: 401 });
    expect(repository.session).not.toHaveBeenCalled();
  });

  it("rejects credential argv before reading passwords or accessing persistence", async () => {
    const reader = jest.fn();
    for (const args of [
      ["create", "alice", "secret"],
      ["set-password", "alice", "--password=secret"],
      ["create", "alice", "-p", "secret"],
      ["list", "secret"],
    ]) {
      await expect(
        runUsersCLI(args, {} as DatabaseService, { readPassword: reader }),
      ).rejects.toThrow();
    }
    expect(reader).not.toHaveBeenCalled();
  });

  it("reads piped passwords without trimming spaces and rejects multiple lines", async () => {
    const input = new PassThrough();
    input.end(" test-password-123 \r\n");
    expect(
      await readPassword({
        input: input as unknown as NodeJS.ReadStream,
        output: { write: jest.fn() },
      }),
    ).toBe(" test-password-123 ");
    const multiple = new PassThrough();
    multiple.end("test-password-123\nextra\n");
    await expect(
      readPassword({
        input: multiple as unknown as NodeJS.ReadStream,
        output: { write: jest.fn() },
      }),
    ).rejects.toThrow("one password line");
  });

  it("uses a no-echo TTY prompt and restores terminal state on success and cancellation", async () => {
    for (const cancel of [false, true]) {
      const input = new PassThrough() as unknown as NodeJS.ReadStream;
      const setRawMode = jest.fn();
      Object.assign(input, { isTTY: true, isRaw: false, setRawMode });
      const write = jest.fn();
      const pending = readPassword({ input, output: { write } });
      input.emit("data", cancel ? "\u0003" : "test-password-123\r");
      if (cancel) await expect(pending).rejects.toThrow("cancelled");
      else expect(await pending).toBe("test-password-123");
      expect(setRawMode).toHaveBeenNthCalledWith(1, true);
      expect(setRawMode).toHaveBeenLastCalledWith(false);
      expect(write.mock.calls.flat().join("")).toBe("Password: \n");
    }
  });
});
