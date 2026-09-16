import test from "node:test";
import assert from "node:assert/strict";
import { api, requestLog } from "../lib/api.ts";
import { duration, timestamp } from "../lib/format.ts";

test("API client preserves errors, accepts empty DELETE responses, and bounds diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/backend/watch-targets/example");
      assert.equal(init.method, "DELETE");
      return new Response(null, { status: 200 });
    };
    assert.equal(
      await api("/watch-targets/example", { method: "DELETE" }),
      undefined,
    );
    assert.equal(requestLog.snapshot()[0].status, 200);
    globalThis.fetch = async () =>
      new Response('{"message":"Upstream failed"}', { status: 500 });
    await assert.rejects(api("/streams"), /HTTP 500.*Upstream failed/);
    assert.equal(requestLog.snapshot()[0].status, 500);
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(api("/recordings"), /Failed to fetch/);
    assert.equal(requestLog.snapshot()[0].status, null);
    globalThis.fetch = async () => new Response("[]");
    for (let i = 0; i < 85; i++) await api("/creators");
    assert.equal(requestLog.snapshot().length, 80);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("timestamps preserve Worker wall-clock values and durations require valid endpoints", () => {
  assert.equal(timestamp("2026-09-15T13:00:00"), "2026-09-15 13:00:00");
  assert.equal(timestamp(undefined), "—");
  assert.equal(
    duration("2026-09-15T13:00:00", "2026-09-15T14:01:02"),
    "1h 1m 2s",
  );
  assert.equal(duration("2026-09-15T13:00:00"), "—");
  assert.equal(duration("invalid", "also invalid"), "—");
  assert.equal(duration("2026-09-15T14:00:00", "2026-09-15T13:00:00"), "—");
});
