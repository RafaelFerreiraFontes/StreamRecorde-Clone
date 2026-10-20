import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = `streamrecorder-wave05-relational-qa-${randomBytes(6).toString("hex")}`;
const environment = { ...process.env, INTERNAL_API_TOKEN: randomBytes(32).toString("hex") };
const args = ["compose", "-p", project, "-f", "scripts/docker-smoke/compose.bridge-fixture.yml"];
function docker(parameters, options = {}) {
  return execFileSync("docker", parameters, { cwd: root, env: environment, encoding: "utf8", stdio: "pipe", ...options });
}
function compose(...parameters) { return docker([...args, ...parameters]); }
async function eventually(check, label) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch {}
    await new Promise((complete) => setTimeout(complete, 300));
  }
  throw new Error(`Timed out: ${label}`);
}
let created = false;
try {
  const normal = docker(["ps", "-aq", "--filter", "label=com.docker.compose.project=streamrecorder"]).trim();
  const config = JSON.parse(compose("config", "--format", "json"));
  for (const service of Object.values(config.services)) {
    for (const mount of service.volumes ?? []) {
      assert(mount.type === "volume" || (mount.type === "bind" && mount.read_only && mount.source === resolve(root, "scripts/docker-smoke")));
    }
  }
  for (const volume of Object.values(config.volumes)) assert(volume.name.startsWith(`${project}_`));
  assert.equal(compose("ps", "-aq").trim(), "");
  console.log(`Isolated project: ${project}; random loopback ports; no user storage`);
  compose("build", "api", "worker", "frontend");
  created = true;
  compose("up", "-d", "--wait", "postgres");
  compose("run", "--rm", "--no-deps", "api", "node", "dist/database/migrate.js");
  compose("run", "--rm", "--no-deps", "--user", "0:0", "worker", "sh", "-ceu", "mkdir -p /outbox /smoke-state/events; chown -R 1000:1000 /data /recordings /outbox /smoke-state");
  compose("run", "--rm", "--no-deps", "worker", "python", "-c", "import json,pathlib; pathlib.Path('/smoke-state/scenarios.json').write_text(json.dumps({'https://smoke.invalid/bridge':{'id':'bridge','probes':['LIVE'],'captures':[{'mode':'success','capture_exit':True}]}}))");
  compose("up", "-d", "api", "frontend");
  const address = (service, port) => `http://${compose("port", service, String(port)).trim()}`;
  async function request(path, method = "GET", body) {
    const api = address("api", 3000);
    const response = await fetch(`${api}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    assert(response.ok, `${method} ${path}: ${response.status}`);
    return response.json();
  }
  await eventually(() => request("/health"), "API readiness");
  await eventually(async () => (await fetch(`${address("frontend", 3001)}/health`, { signal: AbortSignal.timeout(4000) })).ok, "frontend readiness");
  const creator = await request("/creators", "POST", { display_name: "Bridge QA" });
  const target = await request("/watch-targets", "POST", { creator_id: creator.id, channel_name: "bridge", platform: "twitch", url: "https://smoke.invalid/bridge", quality: "best" });
  compose("up", "-d", "worker");
  const recording = await eventually(async () => (await request("/recordings")).find((entry) => entry.watch_target_id === target.id && entry.state === "finished"), "durable relational capture");
  assert(recording.stream_id);
  await request(`/watch-targets/${target.id}`, "PATCH", { enabled: false });
  compose("stop", "-t", "10", "worker");
  compose("restart", "postgres");
  compose("up", "-d", "--wait", "postgres");
  compose("restart", "api");
  await eventually(() => request("/health"), "API restart readiness");
  await eventually(async () => (await request("/recordings")).some((entry) => entry.session_id === recording.session_id && entry.state === "finished"), "restart durability");

  // 1. Frontend -> API -> PostgreSQL proxy E2E verification
  const frontendUrl = address("frontend", 3001);
  const proxyRecordingsResponse = await fetch(`${frontendUrl}/api/backend/recordings`, { signal: AbortSignal.timeout(4000) });
  assert(proxyRecordingsResponse.ok, `Frontend proxy recordings: ${proxyRecordingsResponse.status}`);
  const proxyRecordings = await proxyRecordingsResponse.json();
  const proxyRecording = proxyRecordings.find((entry) => entry.session_id === recording.session_id);
  assert(proxyRecording, "Recording must be accessible via frontend proxy");
  assert.equal(proxyRecording.watch_target_id, target.id);
  assert.equal(proxyRecording.state, "finished");
  assert.equal(proxyRecording.stream_id, recording.stream_id);

  // Verify internal endpoints are not exposed via frontend proxy:
  const proxyInternalResponse = await fetch(`${frontendUrl}/api/backend/internal/v1/events`, { signal: AbortSignal.timeout(4000) });
  assert.equal(proxyInternalResponse.status, 404, "Internal endpoints must not be exposed through frontend proxy");
  console.log("PASS bridge: Frontend -> API -> PostgreSQL proxy E2E and internal boundary isolation verified");

  // 2. Worker Docker restart with pending outbox event recovery and zero duplicate captures:
  const restartTarget = await request("/watch-targets", "POST", { creator_id: creator.id, channel_name: "restart_target", platform: "twitch", url: "https://smoke.invalid/restart", quality: "best" });
  compose("run", "--rm", "--no-deps", "worker", "python", "-c", "import json,pathlib; p=pathlib.Path('/smoke-state/scenarios.json'); data=json.loads(p.read_text()); data['https://smoke.invalid/restart']={'id':'restart_target','probes':['LIVE','OFFLINE'],'captures':[{'mode':'hold-until-release','completion_gate':'pending-restart','capture_exit':True}]}; p.write_text(json.dumps(data))");

  // Start worker to pick up the new target and begin capture
  compose("start", "worker");

  // Worker detects LIVE, starts capture, recording.start is durably acknowledged
  const activeRecording = await eventually(async () => (await request("/recordings")).find((entry) => entry.watch_target_id === restartTarget.id && entry.state === "recording"), "recording.start durably acknowledged");
  assert(activeRecording.stream_id);
  const initialSessionId = activeRecording.session_id;
  const initialStreamId = activeRecording.stream_id;

  // Interrupt API availability before the terminal event can be acknowledged
  compose("stop", "api");

  // Release fake Streamlink capture gate; Streamlink exits and writes media
  compose("run", "--rm", "--no-deps", "worker", "python", "-c", "import pathlib; pathlib.Path('/smoke-state/release-pending-restart').touch()");

  // Wait for worker polling cycle to detect process exit and enqueue terminal event in pending/
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Confirm terminal event exists in the persistent outbox/pending/ volume with stable event UUID
  const pendingFilesRaw = compose("run", "--rm", "--no-deps", "worker", "python", "-c", "import json,glob,pathlib; files=glob.glob('/outbox/pending/*.json'); print(json.dumps([json.loads(pathlib.Path(f).read_text()) for f in files]))").trim();
  const pendingEvents = JSON.parse(pendingFilesRaw);
  const terminalEvent = pendingEvents.find((e) => e.event_type === "recording.terminal" && e.session_id === initialSessionId);
  assert(terminalEvent, "Terminal event must exist in outbox/pending/ while API is unavailable");
  assert(terminalEvent.event_id, "Pending event must have event_id");
  const originalEventId = terminalEvent.event_id;

  // Stop Worker while preserving outbox volume
  compose("stop", "worker");

  // Recover API availability
  compose("start", "api");
  await eventually(() => request("/health"), "API recovered after interruption");

  // Start Worker; Worker startup recover() replays the original pending event
  compose("start", "worker");

  // Confirm Worker replays original event and PostgreSQL finalizes the recording
  const finalizedRecording = await eventually(async () => {
    const list = await request("/recordings");
    return list.find((entry) => entry.session_id === initialSessionId && entry.state === "finished");
  }, "Worker replayed pending event and recording finalized");
  assert.equal(finalizedRecording.stream_id, initialStreamId, "Stream identity must be preserved across restart replay");

  // Verify outbox directories are cleanly drained after successful replay
  await eventually(async () => {
    const outboxRaw = compose("run", "--rm", "--no-deps", "worker", "python", "-c", "import json,glob; pending=glob.glob('/outbox/pending/*.json'); active=glob.glob('/outbox/active/*.json'); print(json.dumps({'pending':len(pending),'active':len(active)}))").trim();
    const counts = JSON.parse(outboxRaw);
    return counts.pending === 0 && counts.active === 0;
  }, "outbox pending and active drained after replay");

  // Verify zero duplicate captures for restartTarget:
  const allRestartRecordings = (await request("/recordings")).filter((entry) => entry.watch_target_id === restartTarget.id);
  assert.equal(allRestartRecordings.length, 1, "Must not create duplicate recording attempts on restart recovery");

  // Verify local media file is intact in recordings volume:
  const mediaVerification = compose("run", "--rm", "--no-deps", "worker", "python", "-c", `import os; assert os.path.exists('${finalizedRecording.output_file}'), 'Media file missing'; print('media-ok')`).trim();
  assert(mediaVerification.includes("media-ok"), "Local media file must be intact in recordings volume");
  console.log("PASS bridge: Worker Docker restart with real pending outbox recovery, PostgreSQL identity preservation, zero duplicates, and media integrity verified");

  assert.equal(docker(["ps", "-aq", "--filter", "label=com.docker.compose.project=streamrecorder"]).trim(), normal);
  console.log("PASS bridge: migrations, Creator/target CRUD, real Worker fake capture, Stream link, frontend health, database/API restart durability; fake media is not playable-media evidence");
} catch (error) {
  console.error(`FAIL bridge: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      const owned = docker(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]).trim().split(/\r?\n/).filter(Boolean);
      for (const volume of owned) {
        const inspected = JSON.parse(docker(["volume", "inspect", volume]))[0];
        assert.equal(inspected.Labels["com.docker.compose.project"], project);
      }
      compose("down", "--volumes", "--remove-orphans");
      console.log(`Removed only project-owned resources: ${project}`);
    } catch (error) {
      console.error(`Cleanup blocked for ${project}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}