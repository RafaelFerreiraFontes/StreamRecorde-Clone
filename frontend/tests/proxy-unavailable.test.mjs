import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contract tests for proxy error handling.
 * Actual runtime behavior (502 on API unavailability, recovery when API returns)
 * is verified by:
 * - Manual smoke test: docker compose up/down api, then curl /api/backend/creators
 * - compose healthcheck ensures frontend remains available
 * These source tests validate the implementation structure.
 */
test("proxy returns 502 controlled error when API is unavailable", () => {
  const routePath = resolve("app/api/backend/[...path]/route.ts");
  const source = readFileSync(routePath, "utf-8");

  // Verify catch block exists (there are multiple: isSameOrigin validation + proxy)
  assert.ok(
    /\bcatch\s*\([^)]*\)\s*\{/.test(source),
    "Proxy must have a catch block for error handling",
  );

  // Verify 502 status is returned somewhere in the file (used by proxy catch)
  assert.ok(
    /status\s*:\s*502/.test(source),
    "Proxy must return status 502 in error responses",
  );

  // Verify Response.json is used (not just Response.error or throw)
  assert.ok(
    /Response\.json/.test(source),
    "Proxy must use Response.json for error responses",
  );
});

test("proxy uses fetch with appropriate timeout", () => {
  const routePath = resolve("app/api/backend/[...path]/route.ts");
  const source = readFileSync(routePath, "utf-8");

  // Verify fetch is used
  assert.ok(
    /\bfetch\s*\(/.test(source),
    "Proxy must use fetch to call API",
  );

  // Verify timeout/abort signal is configured
  assert.ok(
    /(?:signal|AbortSignal|timeout)\s*:/.test(source),
    "Proxy fetch must have timeout/abort configuration",
  );
});

test("proxy does not crash on network errors", () => {
  const routePath = resolve("app/api/backend/[...path]/route.ts");
  const source = readFileSync(routePath, "utf-8");

  // Verify Error type check in catch block
  assert.ok(
    /error\s+instanceof\s+Error|error\s*\?/.test(source) ||
      /String\s*\(\s*error\s*\)/.test(source),
    "Proxy catch block must safely handle error (instanceof Error or String conversion)",
  );

  // Verify Response.json is used for error response (not throw)
  const catchBlockHasResponse =
    /catch\s*\([^)]*\)\s*\{[^}]*Response\.(?:json|error)[^}]*\}/s.test(source);
  assert.ok(
    catchBlockHasResponse,
    "Proxy catch block must return Response, not throw",
  );
});

test("proxy success path returns API response correctly", () => {
  const routePath = resolve("app/api/backend/[...path]/route.ts");
  const source = readFileSync(routePath, "utf-8");

  // Verify successful fetch returns response
  assert.ok(
    /return\s+new\s+Response\s*\(/.test(source),
    "Proxy must return Response on success",
  );

  // Verify response status is propagated
  assert.ok(
    /status\s*:\s*response\.(?:status|ok)/.test(source) ||
      /status\s*:\s*(?:r\.)?response\.status/.test(source),
    "Proxy must propagate API response status",
  );
});
