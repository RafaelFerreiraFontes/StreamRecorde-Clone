import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual route with a type-only NextRequest import removed by TypeScript.
const source = readFileSync("app/api/backend/[...path]/route.ts", "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { GET, PATCH } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
function request(method, pathname, body) {
  return { method, headers: new Headers(), nextUrl: new URL("http://localhost" + pathname),
    text: async () => JSON.stringify(body) };
}

test("proxy forwards relative browsing query and recording-ID location only on allowed routes", async () => {
  const original = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async (url) => { urls.push(new URL(url)); return Response.json({ path: "twitch/channel", entries: [] }); };
    assert.equal((await GET(request("GET", "/?path=twitch%2Fchannel"), { params: Promise.resolve({ path: ["recordings", "filesystem"] }) })).status, 200);
    assert.equal(urls[0].searchParams.get("path"), "twitch/channel");
    assert.equal((await GET(request("GET", "/"), { params: Promise.resolve({ path: ["recordings", "recording-id", "location"] }) })).status, 200);
    assert.equal(urls[1].pathname, "/recordings/recording-id/location");
    assert.equal((await GET(request("GET", "/"), { params: Promise.resolve({ path: ["recordings", "id", "shell"] }) })).status, 404);
    assert.equal(urls.length, 2);
  } finally { globalThis.fetch = original; }
});

test("proxy preserves enabled false and API errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body), { enabled: false });
      return Response.json({ message: "Save failed" }, { status: 500 });
    };
    const response = await PATCH(request("PATCH", "/", { enabled: false }), { params: Promise.resolve({ path: ["watch-targets", "id"] }) });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).message, "Save failed");
  } finally { globalThis.fetch = original; }
});
