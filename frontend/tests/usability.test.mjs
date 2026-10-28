import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual route with a type-only NextRequest import removed by TypeScript.
const source = readFileSync("app/api/backend/[...path]/route.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { GET, POST, PATCH, DELETE } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
function request(method, pathname, body) {
  return {
    method,
    headers: new Headers({ Host: "localhost", Referer: "http://localhost/" }),
    nextUrl: new URL("http://localhost" + pathname),
    text: async () => JSON.stringify(body),
  };
}

test("proxy validates mutation origin evidence and Host before fetching upstream", async () => {
  const originalFetch = globalThis.fetch;
  const originalOrigins = process.env.FRONTEND_TRUSTED_ORIGINS;
  const trusted = "http://127.0.0.1:3001,http://localhost:3001,https://console.example";
  const cases = [
    [trusted, "http://127.0.0.1:3001", "127.0.0.1:3001", null, true],
    [trusted, "http://localhost:3001", "localhost:3001", null, true],
    [trusted, "https://console.example", "console.example", null, true],
    [undefined, "http://localhost:3001", "localhost:3001", null, true],
    [undefined, "https://127.0.0.1:3001", "127.0.0.1:3001", null, true],
    ["", "http://localhost", "localhost", null, true],
    [undefined, "http://console.example", "console.example", null, false],
    [undefined, "http://localhost.evil.example", "localhost.evil.example", null, false],
    [trusted, "http://evil.example", "evil.example", null, false],
    [trusted, "http://localhost:3002", "localhost:3002", null, false],
    [trusted, "https://localhost:3001", "localhost:3001", null, false],
    [trusted, "http://localhost:3001", "localhost:3002", null, false],
    [trusted, "http://localhost:3001", "evil.example", null, false],
    [trusted, "http://localhost:3001", null, null, false],
    [trusted, null, "localhost:3001", "http://localhost:3001/watch-targets?q=1#edit", true],
    [undefined, null, "localhost", "http://localhost/watch-targets", true],
    [trusted, null, "localhost:3001", null, false],
    [trusted, null, "localhost:3001", "http://user:pass@localhost:3001/", false],
    [trusted, null, "localhost:3001", "not a URL", false],
    [trusted, null, "evil.example", "http://evil.example/", false],
    ...[
      "null",
      "",
      "not a URL",
      "http://localhost:3001/",
      "http://localhost:3001?q=1",
      "http://localhost:3001#fragment",
      "http://user:pass@localhost:3001",
      "http://localhost:3001,http://evil.example",
      "http://*.example",
      "ftp://localhost:3001",
    ].map((origin) => [trusted, origin, "localhost:3001", "http://localhost:3001/", false]),
    ...[
      "",
      "localhost:3001/",
      "user@localhost:3001",
      "localhost:3001,evil.example",
      "localhost:3001 extra",
      "localhost:3001?query",
      "localhost:3001#fragment",
    ].map((host) => [trusted, "http://localhost:3001", host, null, false]),
    ...[
      "http://localhost:3001/",
      "http://*.example",
      "http://user@localhost:3001",
      "http://localhost:3001,",
      "http://localhost:3001,not-a-url",
    ].map((configured) => [configured, "http://localhost:3001", "localhost:3001", null, false]),
  ];
  try {
    for (const [configured, origin, host, referer, allowed] of cases) {
      if (configured === undefined) delete process.env.FRONTEND_TRUSTED_ORIGINS;
      else process.env.FRONTEND_TRUSTED_ORIGINS = configured;
      for (const handler of [POST, PATCH, DELETE]) {
        let calls = 0;
        globalThis.fetch = async () => {
          calls += 1;
          return Response.json({});
        };
        const method = handler === POST ? "POST" : handler === PATCH ? "PATCH" : "DELETE";
        const input = request(method, "/", {});
        input.headers = new Headers();
        if (origin !== null) input.headers.set("origin", origin);
        if (host !== null) input.headers.set("host", host);
        if (referer !== null) input.headers.set("referer", referer);
        const response = await handler(input, {
          params: Promise.resolve({
            path: method === "POST" ? ["watch-targets"] : ["watch-targets", "id"],
          }),
        });
        const label = JSON.stringify({ method, configured, origin, host, referer });
        assert.equal(response.status, allowed ? 200 : 403, label);
        assert.equal(calls, allowed ? 1 : 0, label);
        if (!allowed)
          assert.deepEqual(
            await response.json(),
            { message: "Cross-origin mutation rejected" },
            label,
          );
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOrigins === undefined) delete process.env.FRONTEND_TRUSTED_ORIGINS;
    else process.env.FRONTEND_TRUSTED_ORIGINS = originalOrigins;
  }
});

test("proxy forwards relative browsing query and recording-ID location only on allowed routes", async () => {
  const original = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async (url) => {
      urls.push(new URL(url));
      return Response.json({ path: "twitch/channel", entries: [] });
    };
    assert.equal(
      (
        await GET(request("GET", "/?path=twitch%2Fchannel"), {
          params: Promise.resolve({ path: ["recordings", "filesystem"] }),
        })
      ).status,
      200,
    );
    assert.equal(urls[0].searchParams.get("path"), "twitch/channel");
    assert.equal(
      (
        await GET(request("GET", "/"), {
          params: Promise.resolve({ path: ["recordings", "recording-id", "location"] }),
        })
      ).status,
      200,
    );
    assert.equal(urls[1].pathname, "/recordings/recording-id/location");
    assert.equal(
      (
        await GET(request("GET", "/"), {
          params: Promise.resolve({ path: ["recordings", "id", "shell"] }),
        })
      ).status,
      404,
    );
    assert.equal(urls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("proxy preserves enabled false and API errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body), { enabled: false });
      return Response.json({ message: "Save failed" }, { status: 500 });
    };
    const response = await PATCH(request("PATCH", "/", { enabled: false }), {
      params: Promise.resolve({ path: ["watch-targets", "id"] }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).message, "Save failed");
  } finally {
    globalThis.fetch = original;
  }
});

test("proxy forwards only the session cookie and original origin evidence and relays cookies only for login/logout", async () => {
  const original = globalThis.fetch;
  const token = "a".repeat(43);
  try {
    for (const [method, path] of [
      ["GET", ["auth", "session"]],
      ["POST", ["auth", "login"]],
      ["POST", ["auth", "logout"]],
      ["GET", ["creators"]],
    ]) {
      globalThis.fetch = async (_url, init) => {
        const headers = new Headers(init.headers);
        assert.equal(headers.get("cookie"), `sr_session=${token}`);
        assert.equal(headers.get("origin"), "http://localhost");
        assert.equal(headers.get("referer"), "http://localhost/watch-targets");
        for (const name of [
          "authorization",
          "x-user-id",
          "internal_api_token",
          "x-internal-api-token",
        ])
          assert.equal(headers.get(name), null);
        return Response.json(
          {},
          { headers: { "Set-Cookie": "sr_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" } },
        );
      };
      const input = request(method, "/", {});
      input.headers = new Headers({
        Host: "localhost",
        Cookie: `unrelated=secret; sr_session=${token}`,
        Origin: "http://localhost",
        Referer: "http://localhost/watch-targets",
        Authorization: "Bearer secret",
        "X-User-Id": "another-user",
        "X-Internal-Api-Token": "secret",
      });
      const response = await (method === "GET" ? GET : POST)(input, {
        params: Promise.resolve({ path }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(
        response.headers.get("set-cookie"),
        path[0] === "auth" && path[1] !== "session"
          ? "sr_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
          : null,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("proxy rejects unsupported auth/internal routes, cross-origin mutations and malformed or duplicate session cookies", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      assert.equal(new Headers(init.headers).get("cookie"), null);
      assert.equal(new Headers(init.headers).get("origin"), null);
      return Response.json({});
    };
    for (const path of [
      ["internal", "v1", "watch-targets"],
      ["auth", "register"],
      ["auth", "session", "extra"],
    ]) {
      assert.equal(
        (await GET(request("GET", "/"), { params: Promise.resolve({ path }) })).status,
        404,
      );
    }
    const crossOrigin = request("POST", "/", {});
    crossOrigin.headers.set("origin", "https://localhost");
    crossOrigin.headers.set("host", "different-host");
    assert.equal(
      (await POST(crossOrigin, { params: Promise.resolve({ path: ["auth", "login"] }) })).status,
      403,
    );
    assert.equal(calls, 0);
    for (const cookie of [
      "sr_session=bad",
      `sr_session=${"a".repeat(43)}; sr_session=${"b".repeat(43)}`,
      "other=secret",
    ]) {
      const input = request("GET", "/");
      input.headers.set("cookie", cookie);
      assert.equal(
        (await GET(input, { params: Promise.resolve({ path: ["auth", "session"] }) })).status,
        200,
      );
    }
    globalThis.fetch = async () => {
      throw new Error("SECRET_BACKEND_DETAIL");
    };
    const response = await GET(request("GET", "/"), {
      params: Promise.resolve({ path: ["auth", "session"] }),
    });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await response.text(), /SECRET_BACKEND_DETAIL/);
  } finally {
    globalThis.fetch = original;
  }
});
