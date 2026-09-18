import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test: verify all required HTTP methods are exported from the route handler.
// This prevents 405 errors when clients send PATCH requests.
// We use source inspection because Next.js routes cannot be imported in plain Node.js.
test("route handler exports all required HTTP methods", () => {
  const routePath = resolve("app/api/backend/[...path]/route.ts");
  const source = readFileSync(routePath, "utf-8");

  // Check final export statement contains all expected methods
  const exportMatch = source.match(
    /export\s*{\s*([^}]+)}\s*;?\s*$/m,
  );
  assert.ok(exportMatch, "Route must have a named export statement");

  const exportedNames = exportMatch[1]
    .split(",")
    .map((s) => s.trim().split(" as ")[1]?.trim() || s.trim())
    .filter(Boolean);

  assert.ok(
    exportedNames.includes("GET"),
    "GET handler must be exported",
  );
  assert.ok(
    exportedNames.includes("POST"),
    "POST handler must be exported",
  );
  assert.ok(
    exportedNames.includes("PATCH"),
    "PATCH handler must be exported - without this, PATCH returns 405",
  );
  assert.ok(
    exportedNames.includes("DELETE"),
    "DELETE handler must be exported",
  );
});
