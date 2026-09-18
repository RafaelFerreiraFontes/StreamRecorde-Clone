// Run only against a separately started API with an isolated CONFIG_DIR.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_FRONTEND_URL;
if (!origin || process.env.TEST_ALLOW_MUTATIONS !== "true")
  throw new Error(
    "Set TEST_FRONTEND_URL and TEST_ALLOW_MUTATIONS=true for an isolated test API.",
  );
const created = [];
async function request(path, method = "GET", body) {
  const response = await fetch(`${origin}/api/backend${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}
try {
  for (const path of [
    "/creators",
    "/watch-targets",
    "/streams",
    "/recordings",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.data));
  }
  const before = (await request("/watch-targets")).data.map((t) => t.id).sort();
  const creator = `UI integration & ${randomUUID()}`;
  for (const platform of ["twitch", "youtube"]) {
    const response = await request("/watch-targets", "POST", {
      creator_id: creator,
      channel_name: `test-${platform}`,
      platform,
      url: `https://example.invalid/${platform}`,
      quality: "best",
    });
    assert.equal(response.status, 201);
    assert.equal(response.data.state, "idle");
    created.push(response.data.id);
  }
  // Test recording_subdir creation
  const subdirCreator = `UI subdir test & ${randomUUID()}`;
  const withSubdir = await request("/watch-targets", "POST", {
    creator_id: subdirCreator,
    channel_name: "subdir-channel",
    platform: "twitch",
    url: "https://twitch.tv/subdir-channel",
    quality: "best",
    recording_subdir: "favorites/twitch",
  });
  assert.equal(withSubdir.status, 201);
  assert.equal(withSubdir.data.recording_subdir, "favorites/twitch");
  created.push(withSubdir.data.id);

  // Verify persisted recording_subdir
  const readBack = await request(`/watch-targets/${withSubdir.data.id}`);
  assert.equal(readBack.status, 200);
  assert.equal(readBack.data.recording_subdir, "favorites/twitch");

  // Test PATCH update
  const patchResp = await request(`/watch-targets/${withSubdir.data.id}`, "PATCH", {
    recording_subdir: "new/path",
  });
  assert.equal(patchResp.status, 200);
  assert.equal(patchResp.data.recording_subdir, "new/path");

  // Test PATCH clear (empty string)
  const clearResp = await request(`/watch-targets/${withSubdir.data.id}`, "PATCH", {
    recording_subdir: "",
  });
  assert.equal(clearResp.status, 200);
  assert.equal(clearResp.data.recording_subdir, undefined);

  // Test PATCH rejection for traversal
  const invalidPatch = await request(`/watch-targets/${withSubdir.data.id}`, "PATCH", {
    recording_subdir: "../etc",
  });
  assert.equal(invalidPatch.status, 400);

  // Test PATCH rejection for absolute path
  const absolutePatch = await request(`/watch-targets/${withSubdir.data.id}`, "PATCH", {
    recording_subdir: "/absolute",
  });
  assert.equal(absolutePatch.status, 400);

  assert.equal(
    (await request(`/creators/${encodeURIComponent(creator)}/watch-targets`))
      .data.length,
    2,
  );
  assert.ok((await request("/creators")).data.some((c) => c.id === creator));
  assert.equal(
    (await request(`/recordings?watchTargetId=${created[0]}`)).data.length,
    0,
  );
  assert.equal(
    (await request(`/watch-targets/${created[0]}`, "DELETE")).status,
    200,
  );
  assert.equal((await request(`/watch-targets/${created[0]}`)).status, 404);
  assert.equal((await request(`/watch-targets/${created[1]}`)).status, 200);
  assert.equal((await request("/streamer", "POST", {})).status, 404);
  assert.equal((await request("/recordings/nonexistent")).status, 404);
  const crossOrigin = await fetch(`${origin}/api/backend/watch-targets`, {
    method: "POST",
    headers: {
      Origin: "https://example.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);
  for (const id of created) await request(`/watch-targets/${id}`, "DELETE");
  assert.deepEqual(
    (await request("/watch-targets")).data.map((t) => t.id).sort(),
    before,
  );
  console.log(
    "PASS: collections, create, recording_subdir, PATCH, clear, invalid rejection, Creator grouping, initial state, filtering, isolated deletion, errors, proxy method/origin restrictions, cleanup.",
  );
} finally {
  for (const id of created)
    await request(`/watch-targets/${id}`, "DELETE").catch(() => {});
}
