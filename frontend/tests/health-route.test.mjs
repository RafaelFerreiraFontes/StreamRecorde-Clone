import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source-based contract tests for the health route.
 * Actual runtime behavior (status 200, body {status:"ok"}) is verified by:
 * - compose.yml healthcheck: `curl -fsS http://localhost:3001/health`
 * - Manual smoke test: `curl http://localhost:3001/health`
 * These source tests validate the implementation structure deterministically.
 */
test("health route exports GET function and returns expected structure", () => {
  const routePath = resolve("app/health/route.ts");
  const source = readFileSync(routePath, "utf-8");

  // Verify GET function exists
  assert.ok(
    /export\s+function\s+GET\s*\(/.test(source),
    "Health route must export GET function",
  );

  // Verify force-dynamic to skip caching
  assert.ok(
    /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(source),
    "Health route must use force-dynamic to skip caching",
  );

  // Contract: response body must contain status:"ok"
  assert.ok(
    /NextResponse\.json\s*\(\s*\{[^}]*status\s*:\s*["']ok["'][^}]*\}/.test(source),
    "Health route must return {status:'ok'} in response body",
  );

  // Contract: status code must be 200
  assert.ok(
    /NextResponse\.json\s*\([^)]*,\s*\{\s*status\s*:\s*200\s*\}/.test(source),
    "Health route must return status 200",
  );
});

test("health route has no domain dependencies", () => {
  const routePath = resolve("app/health/route.ts");
  const source = readFileSync(routePath, "utf-8");

  // Health endpoint must not import domain modules (db, auth, etc.)
  const domainImports = [
    /from\s+["']@[^"/]+services/,
    /from\s+["']@[^"/]+repositories/,
    /from\s+["']@[^"/]+db/,
    /from\s+["']@[^"/]+auth/,
  ];
  const foundDomainImports = domainImports.filter((pattern) =>
    pattern.test(source),
  );
  assert.strictEqual(
    foundDomainImports.length,
    0,
    "Health route must not import domain modules",
  );
});
