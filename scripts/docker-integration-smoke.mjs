import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = "streamrecorder-smoke";
const apiPort = 3100;
const frontendPort = 3101;
const canonicalFiles = ["watchlist.json", "channels_status.json", "streams.json", "sessions.json"];
let tempRoot;
let scenarioStarted = false;
let normalState;
let smokeEnvironment;
let stepNumber = 0;

function pass(message) {
  stepNumber += 1;
  console.log(`PASS ${stepNumber}: ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function command(commandName, args, options = {}) {
  try {
    return await execFileAsync(commandName, args, {
      cwd: root,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n");
    throw new Error(`${commandName} ${args.join(" ")} failed\n${details}`);
  }
}

function composeArgs(...args) {
  return ["compose", "-p", project, "--project-directory", root, ...args];
}

function compose(...args) {
  if (!smokeEnvironment) fail("Smoke Compose environment is not initialized");
  return command("docker", composeArgs(...args), { env: smokeEnvironment });
}

async function waitFor(url, expectedStatus, attempts = 30) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status === expectedStatus) return response;
      lastError = new Error(`${url} returned ${response.status}, expected ${expectedStatus}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function assertPortAvailable(port) {
  await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", (error) => rejectPromise(new Error(`Host port ${port} is unavailable: ${error.message}`)));
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}

async function hashFile(filePath) {
  try {
    const content = await readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function directorySnapshot(directory) {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const filePath = join(entry.parentPath, entry.name);
      const fileStats = await stat(filePath);
      return [relative(directory, filePath), {
        size: fileStats.size,
        hash: fileStats.size <= 1024 * 1024 ? await hashFile(filePath) : null,
      }];
    }));
    return Object.fromEntries(files.sort(([left], [right]) => left.localeCompare(right)));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function parseComposePsJson(stdout) {
  const output = stdout.trim();
  if (!output) return [];

  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      const parsed = JSON.parse(line);
      return Array.isArray(parsed) ? parsed : [parsed];
    });
  }
}

async function normalStackSnapshot() {
  const runtimeDir = join(root, "runtime-data");
  const files = Object.fromEntries(await Promise.all(canonicalFiles.map(async (name) => [name, await hashFile(join(runtimeDir, name))])));
  const recordings = await directorySnapshot(join(root, "recordings"));
  const { stdout } = await command("docker", ["compose", "ps", "-a", "--format", "json"], { cwd: root });
  const containers = parseComposePsJson(stdout).map((container) => ({
    ID: container.ID,
    Service: container.Service,
    State: container.State,
    Health: container.Health,
    ExitCode: container.ExitCode,
  })).sort((left, right) => left.ID.localeCompare(right.ID));
  return { files, recordings, containers };
}

function assertSame(left, right, name) {
  if (JSON.stringify(left) !== JSON.stringify(right)) fail(`${name} changed during smoke test`);
}

async function assertSafeTempDirectory(directory) {
  const resolvedDirectory = resolve(directory);
  const resolvedTmp = resolve(tmpdir());
  if (!isAbsolute(resolvedDirectory) || !resolvedDirectory.startsWith(`${resolvedTmp}${sep}`) || !relative(resolvedTmp, resolvedDirectory).startsWith("streamrecorder-smoke-")) {
    fail(`Refusing unsafe temporary cleanup path: ${resolvedDirectory}`);
  }
}

async function jsonFile(name, expected) {
  const parsed = JSON.parse(await readFile(join(tempRoot, "runtime-data", name), "utf8"));
  assertSame(parsed, expected, `${name} canonical shape`);
}

async function bff(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${frontendPort}/api/backend${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  return { response, text, json: text ? JSON.parse(text) : undefined };
}

async function workerProbe(source) {
  const { stdout } = await compose("exec", "-T", "worker", "python", "-c", source);
  const line = stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).reverse().find((value) => {
    try { JSON.parse(value); return true; } catch { return false; }
  });
  if (!line) fail(`Worker probe did not emit JSON: ${stdout}`);
  return JSON.parse(line);
}

async function ps() {
  const { stdout } = await compose("ps", "-a", "--format", "json");
  return parseComposePsJson(stdout);
}

async function waitForWorkerRunning(attempts = 30) {
  let worker;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    worker = (await ps()).find((item) => item.Service === "worker");
    if (worker?.State === "running") return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  fail(`Worker did not return to running after restart: ${JSON.stringify(worker)}`);
}

async function cleanup(failed) {
  if (failed && scenarioStarted) {
    try {
      const { stdout } = await compose("logs", "--tail=100", "api", "frontend", "worker");
      console.error(`Smoke failure logs (last 100 lines):\n${stdout}`);
    } catch (error) { console.error(`Unable to collect smoke logs: ${error.message}`); }
  }
  if (scenarioStarted) {
    try { await compose("down", "--remove-orphans"); } catch (error) { console.error(`Smoke cleanup failed: ${error.message}`); }
  }
  if (tempRoot) {
    await assertSafeTempDirectory(tempRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  normalState = await normalStackSnapshot();
  await Promise.all([assertPortAvailable(apiPort), assertPortAvailable(frontendPort)]);
  tempRoot = await mkdtemp(join(tmpdir(), "streamrecorder-smoke-"));
  await assertSafeTempDirectory(tempRoot);
  const runtimeData = join(tempRoot, "runtime-data");
  const recordings = join(tempRoot, "recordings");
  smokeEnvironment = {
    ...process.env,
    RUNTIME_DATA_DIR: runtimeData,
    RECORDINGS_DIR: recordings,
    API_HOST_PORT: String(apiPort),
    FRONTEND_HOST_PORT: String(frontendPort),
    WORKER_POLL_INTERVAL: "3600",
  };
  const config = await compose("config", "--format", "json");
  const configured = JSON.parse(config.stdout);
  assertSame(Object.keys(configured.services).sort(), ["api", "frontend", "worker"], "Compose service set");
  pass("isolated Compose configuration contains only api, frontend, and worker");
  scenarioStarted = true;
  await compose("up", "-d", "--build", "--wait");
  const containers = await ps();
  if (containers.length !== 3) fail(`Expected exactly 3 smoke containers, found ${containers.length}`);
  for (const service of ["api", "frontend"]) {
    const container = containers.find((item) => item.Service === service);
    if (container?.Health !== "healthy") fail(`${service} is not healthy: ${JSON.stringify(container)}`);
  }
  if (containers.find((item) => item.Service === "worker")?.State !== "running") fail("Worker is not running");
  await Promise.all([waitFor(`http://127.0.0.1:${apiPort}/health`, 200), waitFor(`http://127.0.0.1:${frontendPort}/health`, 200)]);
  pass("all three isolated containers are up; API and frontend health endpoints respond");
  await Promise.all(canonicalFiles.map((name, index) => jsonFile(name, index === 1 ? {} : [])));
  const empty = await bff("/watch-targets");
  if (!empty.response.ok || !Array.isArray(empty.json) || empty.json.length !== 0) fail("BFF watch-target collection is not empty");
  pass("canonical runtime JSON files and empty BFF collection are available");
  const created = await bff("/watch-targets", "POST", {
    creator_id: "smoke-creator", channel_name: "smoke-channel", platform: "twitch", url: "https://example.invalid/smoke", quality: "best", recording_subdir: "smoke/initial",
  });
  if (created.response.status !== 201 || !created.json?.id) fail(`BFF create failed: ${created.response.status} ${created.text}`);
  const id = created.json.id;
  const initial = await workerProbe("import json, worker; target=next(item for item in worker.load_watchlist() if item['id']=='" + id + "'); print(json.dumps({'target': target, 'output': str(worker.resolve_output_dir(target, worker.OUTPUT_DIR))}))");
  if (initial.target.recording_subdir !== "smoke/initial" || !initial.output.endsWith("/smoke/initial")) fail("Worker cannot see initial watch target/output path");
  pass("BFF creation persists the initial target and Worker resolves its output directory");
  const patched = await bff(`/watch-targets/${id}`, "PATCH", { recording_subdir: "smoke/nested" });
  if (!patched.response.ok || patched.json?.recording_subdir !== "smoke/nested") fail("BFF patch failed");
  const nested = await workerProbe("import json, worker; target=next(item for item in worker.load_watchlist() if item['id']=='" + id + "'); print(json.dumps({'target': target, 'output': str(worker.resolve_output_dir(target, worker.OUTPUT_DIR))}))");
  if (nested.target.recording_subdir !== "smoke/nested" || !nested.output.endsWith("/smoke/nested")) fail("Worker cannot see patched target/output path");
  await compose("restart", "worker");
  await waitForWorkerRunning();
  const restarted = await workerProbe("import json, worker; target=next(item for item in worker.load_watchlist() if item['id']=='" + id + "'); print(json.dumps({'target': target, 'output': str(worker.resolve_output_dir(target, worker.OUTPUT_DIR))}))");
  if (restarted.target.recording_subdir !== "smoke/nested" || !restarted.output.endsWith("/smoke/nested")) fail("Worker cannot see patched target/output path after restart");
  pass("Worker restart preserves the target and patched recording subdirectory");
  await workerProbe("import json, worker; worker.channels_status=worker.load_channels_status(); worker.channels_status['" + id + "']={'channel_name':'smoke-channel','platform':'twitch','state':'offline'}; worker.save_status(); print(json.dumps({'saved': True}))");
  const offline = await bff(`/watch-targets/${id}`);
  if (!offline.response.ok || offline.json?.state !== "offline") fail("BFF does not expose Worker-written offline state");
  pass("Worker-written offline status is shared through runtime data");
  await compose("restart", "api");
  await waitFor(`http://127.0.0.1:${apiPort}/health`, 200);
  const persisted = await bff(`/watch-targets/${id}`);
  if (!persisted.response.ok || persisted.json?.recording_subdir !== "smoke/nested" || persisted.json?.state !== "offline") fail("BFF persistence failed after API restart");
  pass("API restart preserves the target, patched subdirectory, and Worker-written status");
  const deleted = await bff(`/watch-targets/${id}`, "DELETE");
  if (![200, 204].includes(deleted.response.status)) fail(`BFF delete failed: ${deleted.response.status}`);
  if (JSON.parse(await readFile(join(runtimeData, "watchlist.json"), "utf8")).some((item) => item.id === id)) fail("Deleted target remains in the host watchlist");
  const absent = await workerProbe("import json, worker; print(json.dumps({'present': any(item['id']=='" + id + "' for item in worker.load_watchlist())}))");
  if (absent.present) fail("Deleted target remains visible to Worker");
  pass("BFF deletion removes the target from both host data and Worker visibility");
  await compose("stop", "api");
  await waitFor(`http://127.0.0.1:${frontendPort}/health`, 200);
  const unavailable = await bff("/watch-targets");
  if (unavailable.response.status !== 502) fail(`Expected BFF 502 while API stopped, got ${unavailable.response.status}`);
  await compose("start", "api");
  await waitFor(`http://127.0.0.1:${apiPort}/health`, 200);
  if (!(await bff("/watch-targets")).response.ok) fail("BFF did not recover after API start");
  pass("frontend stays healthy through API outage and BFF recovers without frontend restart");
  const workerLogs = await compose("logs", "--tail=100", "worker");
  if (!workerLogs.stdout.trim()) fail("Worker logs are not accessible");
  await compose("stop", "worker");
  const stoppedWorker = (await ps()).find((item) => item.Service === "worker");
  if (stoppedWorker?.ExitCode !== 0) fail(`Worker exited with ${stoppedWorker?.ExitCode}`);
  const shutdownLogs = await compose("logs", "--tail=100", "worker");
    if (!/Shutting down worker/i.test(shutdownLogs.stdout)) fail("Worker shutdown logs do not show graceful termination");
  pass("Worker logs are accessible and SIGTERM shutdown exits cleanly without test-created media children");
  console.log("PASS: Docker integration smoke scenario completed.");
}

let failure;
try { await main(); } catch (error) { failure = error; console.error(`FAIL: ${error.stack || error.message}`); }
await cleanup(Boolean(failure));
if (normalState) assertSame(await normalStackSnapshot(), normalState, "Normal Compose stack/data state");
if (failure) process.exitCode = 1;