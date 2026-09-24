import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = `streamrecorder-smoke-${randomBytes(6).toString("hex")}`;
const volumes = Object.fromEntries(["runtime", "recordings", "state"].map((kind) => [kind, `${project}-${kind}`]));
const normalContainers = ["streamrecorder-api-1", "streamrecorder-worker-1"];
const canonicalFiles = ["watchlist.json", "channels_status.json", "sessions.json", "streams.json"];
const gateBPollIntervalMilliseconds = 5000;
const gateBPostReductionWaitMilliseconds = gateBPollIntervalMilliseconds + 500;
const gateCPollOpportunityMilliseconds = gateBPollIntervalMilliseconds + 500;
let environment;
let normalSnapshot;
let createdVolumes = [];
let inspectorContainer;
let step = 0;

function pass(message) { console.log(`PASS ${++step}: ${message}`); }

async function docker(args, options = {}) {
  try {
    return await execFileAsync("docker", args, { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024, ...options });
  } catch (error) {
    throw new Error(`docker ${args.join(" ")} failed\n${[error.stdout, error.stderr, error.message].filter(Boolean).join("\n")}`);
  }
}

function compose(...args) {
  return docker(["compose", "-p", project, "--project-directory", root, "-f", "compose.yml", "-f", "scripts/docker-smoke/compose.worker-fixture.yml", ...args], { env: environment });
}

const auditSource = `import hashlib,json,pathlib
names=${JSON.stringify(canonicalFiles)}; root=pathlib.Path('/data'); values={name:json.loads((root/name).read_bytes()) for name in names}
def fingerprint(name,value):
 if name == 'watchlist.json': value=[{key:item[key] for key in sorted(item) if key != 'url'} if isinstance(item,dict) else item for item in value]
 return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
print(json.dumps({'hashes':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names},'semantic_fingerprints':{name:fingerprint(name,value) for name,value in values.items()},'shapes':{name:len(value) for name,value in values.items()},'valid':[isinstance(values['watchlist.json'],list),isinstance(values['channels_status.json'],dict),isinstance(values['sessions.json'],list),isinstance(values['streams.json'],list)]},sort_keys=True))`;
const importSource = `import hashlib,json,os,pathlib,tempfile
names=${JSON.stringify(canonicalFiles)}; source=pathlib.Path('/data'); target=pathlib.Path('/isolated'); values={name:json.loads((source/name).read_text()) for name in names}
if not (isinstance(values['watchlist.json'],list) and isinstance(values['channels_status.json'],dict) and isinstance(values['sessions.json'],list) and isinstance(values['streams.json'],list)): raise SystemExit('invalid canonical source JSON shapes')
for item in values['watchlist.json']:
 if not isinstance(item,dict) or not isinstance(item.get('id'),str) or not item['id']: raise SystemExit('watch target lacks safe id')
 item['url']='https://smoke.invalid/'+''.join(char if char.isalnum() or char in '._-' else '-' for char in item['id'])
 if not item['url'].startswith('https://smoke.invalid/'): raise SystemExit('unsafe isolated URL')
target.mkdir(parents=True,exist_ok=True)
for name,value in values.items():
 descriptor,temp=tempfile.mkstemp(prefix='.'+name+'.',suffix='.tmp',dir=target)
 with os.fdopen(descriptor,'w') as handle: json.dump(value,handle,separators=(',',':')); handle.flush(); os.fsync(handle.fileno())
 os.chown(temp,1000,1000); os.chmod(temp,0o664); os.replace(temp,target/name)
os.chown(target,1000,1000); os.chmod(target,0o2775)
def fingerprint(name,value):
 if name == 'watchlist.json': value=[{key:item[key] for key in sorted(item) if key != 'url'} if isinstance(item,dict) else item for item in value]
 return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
print(json.dumps({'counts':{name:len(values[name]) for name in names},'semantic_fingerprints':{name:fingerprint(name,value) for name,value in values.items()}},sort_keys=True))`;

function jsonLine(stdout) {
  const line = stdout.trim().split(/\r?\n/).find((value) => value.startsWith("{"));
  if (!line) throw new Error("Expected structural JSON output from helper");
  return JSON.parse(line);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function inspectorJson(source, options = {}) {
  if (!inspectorContainer) throw new Error("Gate B inspector container is unavailable");
  const environmentArguments = Object.entries(options.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  return jsonLine((await docker(["exec", ...environmentArguments, inspectorContainer, "python", "-c", source])).stdout);
}

const prepareGateBSource = `import copy,json,os,pathlib,tempfile
root=pathlib.Path('/data'); state=pathlib.Path('/smoke-state'); watchlist=json.loads((root/'watchlist.json').read_text())
if not isinstance(watchlist,list) or not watchlist or not isinstance(watchlist[0],dict): raise SystemExit('imported watchlist lacks a target shape')
seed=watchlist[0]
def target(identifier,enabled):
 item=copy.deepcopy(seed); item.update({'id':identifier,'url':'https://smoke.invalid/'+identifier.removeprefix('smoke-'),'channel_name':identifier,'enabled':enabled})
 if 'display_name' in item: item['display_name']=identifier
 if 'recording_subdir' in item: item['recording_subdir']='smoke/isolated'
 return item
targets=[target('smoke-offline',True),target('smoke-error',True),target('smoke-live',True),target('smoke-disabled',False)]
scenarios={
 'https://smoke.invalid/offline':{'id':'smoke-offline','probes':['OFFLINE']},
 'https://smoke.invalid/error':{'id':'smoke-error','probes':['ERROR']},
 'https://smoke.invalid/live':{'id':'smoke-live','probes':['LIVE'],'captures':['hold-until-signal']},
 'https://smoke.invalid/disabled':{'id':'smoke-disabled','probes':['LIVE'],'captures':['hold-until-signal']}}
def atomic(path,value):
 descriptor,temporary=tempfile.mkstemp(prefix='.'+path.name+'.',suffix='.tmp',dir=path.parent)
 with os.fdopen(descriptor,'w') as handle: json.dump(value,handle,separators=(',',':')); handle.flush(); os.fsync(handle.fileno())
 os.replace(temporary,path)
for child in ('events','claims.json','scenarios.json'):
 path=state/child
 if path.is_dir():
  for entry in path.iterdir(): entry.unlink()
 elif path.exists(): path.unlink()
(state/'events').mkdir(exist_ok=True)
atomic(root/'watchlist.json',targets); atomic(root/'channels_status.json',{}); atomic(root/'streams.json',[]); atomic(root/'sessions.json',[]); atomic(state/'scenarios.json',scenarios)
print(json.dumps({'target_ids':[item['id'] for item in targets],'scenario_ids':sorted(item['id'] for item in scenarios.values())},sort_keys=True))`;

const reduceGateBWatchlistSource = `import json,os,pathlib,tempfile
path=pathlib.Path('/data/watchlist.json'); values=json.loads(path.read_text()); values=[item for item in values if item.get('id') in {'smoke-live','smoke-disabled'}]
if {item.get('id') for item in values}!={'smoke-live','smoke-disabled'}: raise SystemExit('Gate B watchlist reduction is unsafe')
descriptor,temporary=tempfile.mkstemp(prefix='.watchlist.',suffix='.tmp',dir=path.parent)
with os.fdopen(descriptor,'w') as handle: json.dump(values,handle,separators=(',',':')); handle.flush(); os.fsync(handle.fileno())
os.replace(temporary,path); print(json.dumps({'remaining':[item['id'] for item in values]}))`;

const gateBEventsSource = `import json,pathlib
events=pathlib.Path('/smoke-state/events'); allowed={'smoke-offline','smoke-error','smoke-live','smoke-disabled'}; parsed=[]
for ready in events.glob('*.ready'):
 payload=ready.with_suffix('.json')
 if not payload.exists(): raise SystemExit('ready mailbox lacks payload')
 value=json.loads(payload.read_text())
 if value.get('url_id') not in allowed or value.get('operation') not in {'probe','capture','capture_exit'} or not isinstance(value.get('event_id'),str): raise SystemExit('invalid fixture event')
 parsed.append(value)
if len({value['event_id'] for value in parsed}) != len(parsed): raise SystemExit('duplicate fixture event ids')
counts={identifier:{'probe':0,'capture':0} for identifier in allowed}
for value in parsed:
 if value['operation'] in {'probe','capture'}: counts[value['url_id']][value['operation']]+=1
print(json.dumps({'counts':counts,'events':len(parsed)},sort_keys=True))`;

const gateBStateSource = `import json,pathlib
root=pathlib.Path('/data'); status=json.loads((root/'channels_status.json').read_text()); streams=json.loads((root/'streams.json').read_text()); sessions=json.loads((root/'sessions.json').read_text())
ids={'smoke-offline','smoke-error','smoke-live','smoke-disabled'}
synthetic_streams=[item for item in streams if item.get('watch_target_id') in ids]
synthetic_sessions=[item for item in sessions if item.get('channel_id') in ids]
print(json.dumps({'status':{key:status.get(key) for key in ids},'streams':synthetic_streams,'sessions':synthetic_sessions},sort_keys=True))`;

async function waitForGateBEvent(timeoutMilliseconds = 12000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const events = await inspectorJson(gateBEventsSource);
    if (events.counts['smoke-live'].capture === 1) return events;
    await delay(100);
  }
  throw new Error("Gate B did not receive the LIVE capture event before its timeout");
}

async function runGateB() {
  const prepared = await inspectorJson(prepareGateBSource);
  if (JSON.stringify(prepared.target_ids) !== JSON.stringify(["smoke-offline", "smoke-error", "smoke-live", "smoke-disabled"]) || JSON.stringify(prepared.scenario_ids) !== JSON.stringify(["smoke-disabled", "smoke-error", "smoke-live", "smoke-offline"])) throw new Error("Gate B synthetic target preparation failed");
  await compose("up", "-d", "--no-deps", "worker");
  const started = await compose("ps", "--services", "--status", "running");
  if (!started.stdout.split(/\r?\n/).includes("worker")) throw new Error("Gate B Worker did not start");
  await waitForGateBEvent();
  const reduced = await inspectorJson(reduceGateBWatchlistSource);
  if (JSON.stringify(reduced.remaining) !== JSON.stringify(["smoke-live", "smoke-disabled"])) throw new Error("Gate B watchlist reduction failed");
  await delay(gateBPostReductionWaitMilliseconds);
  const runningBeforeFinalCounts = await compose("ps", "--services", "--status", "running");
  if (!runningBeforeFinalCounts.stdout.split(/\r?\n/).includes("worker")) throw new Error("Gate B Worker stopped before final event counts");
  const events = await inspectorJson(gateBEventsSource);
  const expectedCounts = {"smoke-offline": {probe: 1, capture: 0}, "smoke-error": {probe: 1, capture: 0}, "smoke-live": {probe: 1, capture: 1}, "smoke-disabled": {probe: 0, capture: 0}};
  const assertEventCount = (identifier) => {
    const expected = expectedCounts[identifier];
    if (events.counts[identifier]?.probe !== expected.probe || events.counts[identifier]?.capture !== expected.capture) throw new Error(`Gate B ${identifier} event count failed: ${JSON.stringify(events.counts)}`);
  };
  assertEventCount("smoke-offline");
  const state = await inspectorJson(gateBStateSource);
  if (state.status['smoke-offline']?.state !== "offline") throw new Error("Gate B offline status persistence assertion failed");
  pass("gate_b.offline");

  assertEventCount("smoke-live");
  if (state.status['smoke-live']?.state !== "recording" || state.streams.length !== 1 || state.streams[0].watch_target_id !== "smoke-live" || state.streams[0].finished_at !== null || state.sessions.length !== 1) throw new Error("Gate B live persistence assertion failed");
  const recording = state.sessions[0];
  if (recording.channel_id !== "smoke-live" || recording.state !== "recording" || recording.finished_at !== null || typeof recording.output_file !== "string" || !recording.output_file.startsWith("/recordings/")) throw new Error("Gate B live recording persistence assertion failed");
  pass("gate_b.live");

  for (const [identifier, expected] of Object.entries(expectedCounts)) {
    if (events.counts[identifier]?.probe !== expected.probe || events.counts[identifier]?.capture !== expected.capture) throw new Error(`Gate B event counts are unstable: ${JSON.stringify(events.counts)}`);
  }
  pass("gate_b.duplicate_prevention");

  assertEventCount("smoke-error");
  if (state.status['smoke-error'] && state.status['smoke-error'].state === "offline") throw new Error("Gate B error status persistence assertion failed");
  pass("gate_b.error");

  assertEventCount("smoke-disabled");
  if (state.status['smoke-disabled']) throw new Error("Gate B disabled status persistence assertion failed");
  pass("gate_b.enabled_false");

  const logs = (await compose("logs", "--tail=100", "worker")).stdout;
  for (const result of ["OFFLINE", "LIVE", "ERROR"]) if (!logs.includes(`Probe: ${result}`)) throw new Error(`Gate B Worker logs lack Probe: ${result}`);
  await compose("stop", "-t", "8", "worker");
  const afterStop = await compose("ps", "--services", "--status", "running");
  if (afterStop.stdout.split(/\r?\n/).includes("worker")) throw new Error("PRODUCTION_SHUTDOWN_FIX_REGRESSION: Worker did not stop gracefully");
  pass("Gate B Worker polling proves offline/live/duplicate/error/enabled_false classification, persistence, and graceful isolated shutdown without network access");
}

const resetGateCSource = `import copy,json,os,pathlib,tempfile
root=pathlib.Path('/data'); state=pathlib.Path('/smoke-state'); watchlist=json.loads((root/'watchlist.json').read_text())
if not isinstance(watchlist,list) or not watchlist or not isinstance(watchlist[0],dict): raise SystemExit('imported watchlist lacks a target shape')
seed=watchlist[0]
def atomic(path,value):
 descriptor,temporary=tempfile.mkstemp(prefix='.'+path.name+'.',suffix='.tmp',dir=path.parent)
 with os.fdopen(descriptor,'w') as handle: json.dump(value,handle,separators=(',',':')); handle.flush(); os.fsync(handle.fileno())
 os.replace(temporary,path)
def target(identifier):
 item=copy.deepcopy(seed); item.update({'id':identifier,'url':'https://smoke.invalid/'+identifier.removeprefix('smoke-'),'channel_name':identifier,'enabled':True})
 if 'display_name' in item: item['display_name']=identifier
 if 'recording_subdir' in item: item['recording_subdir']='smoke/isolated'
 return item
for path in state.iterdir():
 if path.is_dir():
  for entry in path.iterdir(): entry.unlink()
 elif path.name in {'claims.json','scenarios.json'} or path.name.startswith('release-') or path.name == '.fixture-actions.lock': path.unlink()
(state/'events').mkdir(exist_ok=True)
identifier=os.environ['GATE_C_TARGET']; scenario=json.loads(os.environ['GATE_C_SCENARIO'])
atomic(root/'watchlist.json',[target(identifier)]); atomic(root/'channels_status.json',{}); atomic(root/'streams.json',[]); atomic(root/'sessions.json',[]); atomic(state/'scenarios.json',scenario)
print(json.dumps({'target_id':identifier,'scenario_ids':sorted(item['id'] for item in scenario.values())},sort_keys=True))`;

function gateCScenario(identifier, probes, captures) {
  return { [`https://smoke.invalid/${identifier.replace(/^smoke-/, "")}`]: { id: identifier, probes, captures } };
}

function cStateSource(identifier) {
  return `import hashlib,json,pathlib
root=pathlib.Path('/data'); events=pathlib.Path('/smoke-state/events'); names=${JSON.stringify(canonicalFiles)}
values={name:json.loads((root/name).read_bytes()) for name in names}; parsed=[]
for ready in events.glob('*.ready'):
 payload=ready.with_suffix('.json')
 if not payload.exists(): raise SystemExit('ready mailbox lacks payload')
 value=json.loads(payload.read_text())
 if value.get('url_id') == ${JSON.stringify(identifier)}: parsed.append(value)
if len({value.get('event_id') for value in parsed}) != len(parsed): raise SystemExit('duplicate fixture event ids')
streams=[item for item in values['streams.json'] if item.get('watch_target_id') == ${JSON.stringify(identifier)}]
sessions=[item for item in values['sessions.json'] if item.get('channel_id') == ${JSON.stringify(identifier)}]
counts={operation:sum(1 for item in parsed if item.get('operation') == operation) for operation in ('probe','capture','capture_ready','capture_release','capture_exit','gate_wait','gate_release')}
print(json.dumps({'hashes':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names},'bytes':{name:(root/name).read_bytes().hex() for name in names},'status':values['channels_status.json'].get(${JSON.stringify(identifier)}),'streams':streams,'sessions':sessions,'counts':counts,'events':parsed},sort_keys=True))`;
}

async function waitForCState(identifier, predicate, description, timeoutMilliseconds = 18000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let last;
  while (Date.now() < deadline) {
    last = await inspectorJson(cStateSource(identifier));
    if (predicate(last)) return last;
    await delay(100);
  }
  throw new Error(`${description}: ${JSON.stringify(last)}`);
}

async function releaseGate(gate) {
  await inspectorJson(`import os,pathlib
path=pathlib.Path('/smoke-state/release-${gate}'); descriptor=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.close(descriptor); print('{}')`);
}

function assertSingleOpenStream(state, identifier) {
  if (state.streams.length !== 1 || state.streams[0].watch_target_id !== identifier || state.streams[0].finished_at !== null) throw new Error(`Expected one open Stream for ${identifier}: ${JSON.stringify(state.streams)}`);
  return state.streams[0];
}

async function runGateC1() {
  const identifier = "smoke-c1";
  const scenario = gateCScenario(identifier, ["LIVE", "ERROR", "LIVE", "OFFLINE", { result: "LIVE", gate: "c1-fifth-probe" }], ["fail", { mode: "hold-until-release", completion_gate: "c1-second-capture" }, { mode: "hold-until-release", completion_gate: "c1-third-capture" }]);
  const prepared = await inspectorJson(resetGateCSource, { env: { GATE_C_TARGET: identifier, GATE_C_SCENARIO: JSON.stringify(scenario) } });
  if (prepared.target_id !== identifier || JSON.stringify(prepared.scenario_ids) !== JSON.stringify([identifier])) throw new Error("Gate C1 reset failed");
  await compose("up", "-d", "--no-deps", "worker");
  const first = await waitForCState(identifier, (state) => state.sessions.length === 1 && state.sessions[0].state === "error" && state.streams.length === 1 && state.streams[0].finished_at === null, "Gate C1 first failed capture did not persist");
  const streamOne = assertSingleOpenStream(first, identifier);
  const recordingOne = first.sessions[0];
  if (first.counts.probe !== 1 || first.counts.capture !== 1 || recordingOne.finished_at === null) throw new Error("Gate C1 R1 error state is incomplete");
  const second = await waitForCState(identifier, (state) => state.counts.capture_ready === 1 && state.sessions.length === 2 && state.sessions.some((session) => session.state === "recording"), "Gate C1 R2 did not become active");
  const streamAgain = assertSingleOpenStream(second, identifier);
  const recordingTwo = second.sessions.find((session) => session.state === "recording");
  if (streamAgain.id !== streamOne.id || recordingTwo.session_id === recordingOne.session_id || second.counts.probe !== 3 || second.counts.capture !== 2) throw new Error("Gate C1 ERROR/LIVE reuse did not preserve S1 or create distinct R2");
  const activeTwoSnapshot = JSON.stringify({ counts: second.counts, streams: second.streams, sessions: second.sessions, events: second.events.map((event) => event.event_id) });
  await delay(gateCPollOpportunityMilliseconds);
  const activeTwoAfterWait = await inspectorJson(cStateSource(identifier));
  if (JSON.stringify({ counts: activeTwoAfterWait.counts, streams: activeTwoAfterWait.streams, sessions: activeTwoAfterWait.sessions, events: activeTwoAfterWait.events.map((event) => event.event_id) }) !== activeTwoSnapshot) throw new Error("Gate C1 R2 changed during a full active-capture poll opportunity");
  pass("gate_c1.error_live_reuse: R1 error leaves S1 open; ERROR is non-mutating; R2 reuses S1 without duplicate polling");
  await releaseGate("c1-second-capture");
  const offline = await waitForCState(identifier, (state) => state.counts.probe === 4 && state.sessions.length === 2 && state.sessions.some((session) => session.session_id === recordingOne.session_id && session.state === "error") && state.sessions.some((session) => session.session_id === recordingTwo.session_id && session.state === "finished" && session.finished_at !== null) && state.streams.length === 1 && state.streams[0].finished_at !== null, "Gate C1 OFFLINE did not finalize S1 after R2");
  if (offline.streams[0].id !== streamOne.id) throw new Error("Gate C1 OFFLINE finalized the wrong Stream");
  await releaseGate("c1-fifth-probe");
  const third = await waitForCState(identifier, (state) => state.counts.capture_ready === 2 && state.sessions.length === 3 && state.streams.length === 2 && state.sessions.some((session) => session.state === "recording"), "Gate C1 R3 did not become active on S2");
  const streamTwo = third.streams.find((stream) => stream.finished_at === null);
  const recordingThree = third.sessions.find((session) => session.state === "recording");
  if (!streamTwo || streamTwo.id === streamOne.id || recordingThree.session_id === recordingOne.session_id || recordingThree.session_id === recordingTwo.session_id || third.counts.probe !== 5 || third.counts.capture !== 3) throw new Error("Gate C1 later LIVE did not create distinct S2/R3");
  const activeThreeSnapshot = JSON.stringify({ counts: third.counts, streams: third.streams, sessions: third.sessions, events: third.events.map((event) => event.event_id) });
  await delay(gateCPollOpportunityMilliseconds);
  const activeThreeAfterWait = await inspectorJson(cStateSource(identifier));
  if (JSON.stringify({ counts: activeThreeAfterWait.counts, streams: activeThreeAfterWait.streams, sessions: activeThreeAfterWait.sessions, events: activeThreeAfterWait.events.map((event) => event.event_id) }) !== activeThreeSnapshot) throw new Error("Gate C1 R3 changed during a full active-capture poll opportunity");
  await releaseGate("c1-third-capture");
  const finished = await waitForCState(identifier, (state) => state.sessions.length === 3 && state.sessions.some((session) => session.session_id === recordingOne.session_id && session.state === "error" && session.finished_at !== null) && state.sessions.some((session) => session.session_id === recordingTwo.session_id && session.state === "finished" && session.finished_at !== null) && state.sessions.some((session) => session.session_id === recordingThree.session_id && session.state === "finished" && session.finished_at !== null) && state.counts.capture_exit === 2, "Gate C1 did not persist R3 before stop");
  if (finished.streams.filter((stream) => stream.finished_at === null).length !== 1) throw new Error("Gate C1 R3 completion unexpectedly closed S2");
  await compose("stop", "-t", "8", "worker");
  pass("gate_c1.offline_new_stream: OFFLINE finalized S1, later LIVE created distinct S2/R3, and both gated active captures remained duplicate-free for a full poll interval");
}

async function runGateC2() {
  const identifier = "smoke-c2";
  const scenario = gateCScenario(identifier, ["LIVE"], [{ mode: "hold-until-release", completion_gate: "c2-terminal" }]);
  const prepared = await inspectorJson(resetGateCSource, { env: { GATE_C_TARGET: identifier, GATE_C_SCENARIO: JSON.stringify(scenario) } });
  if (prepared.target_id !== identifier) throw new Error("Gate C2 reset failed");
  await compose("up", "-d", "--no-deps", "worker");
  const initial = await waitForCState(identifier, (state) => state.counts.capture_ready === 1 && state.sessions.length === 1 && state.sessions[0].state === "recording" && state.streams.length === 1, "Gate C2 initial recording was not durable");
  const stream = assertSingleOpenStream(initial, identifier);
  const recording = initial.sessions[0];
  if (initial.counts.probe !== 1 || initial.counts.capture !== 1) throw new Error("Gate C2 initial fixture counts failed");
  const immutableSnapshot = JSON.stringify({ hashes: initial.hashes, bytes: initial.bytes });
  await docker(["run", "--rm", "--user", "0:0", "-v", `${volumes.runtime}:/data`, "--entrypoint", "sh", "streamrecorder-worker:wave-03.5", "-ceu", "chown root:root /data /data/*.json; chmod 0555 /data; chmod 0444 /data/*.json"]);
  await docker(["run", "--rm", "--user", "1000:1000", "-v", `${volumes.runtime}:/data`, "--entrypoint", "sh", "streamrecorder-worker:wave-03.5", "-ceu", "probe=/data/.c2-sibling-create-must-fail; if (: > \"$probe\") 2>/dev/null; then rm -f \"$probe\"; exit 1; fi"]);
  await releaseGate("c2-terminal");
  const terminalLogDeadline = Date.now() + 12000;
  while (Date.now() < terminalLogDeadline) {
    const logs = (await compose("logs", "--tail=100", "worker")).stdout;
    if (logs.includes(`Terminal recording persistence failed (watch_target_id=${identifier}, session_id=${recording.session_id}, exception_type=PermissionError)`)) break;
    await delay(100);
  }
  const denied = await inspectorJson(cStateSource(identifier));
  const deniedLogs = (await compose("logs", "--tail=100", "worker")).stdout;
  if (!deniedLogs.includes(`Terminal recording persistence failed (watch_target_id=${identifier}, session_id=${recording.session_id}, exception_type=PermissionError)`)) throw new Error("Gate C2 did not log the first terminal persistence failure");
  if (JSON.stringify({ hashes: denied.hashes, bytes: denied.bytes }) !== immutableSnapshot || denied.sessions.length !== 1 || denied.sessions[0].state !== "recording" || denied.status?.state !== "recording" || assertSingleOpenStream(denied, identifier).id !== stream.id || denied.counts.probe !== 1 || denied.counts.capture !== 1) throw new Error("Gate C2 denial changed canonical persistence or active identity");
  await delay(gateCPollOpportunityMilliseconds);
  const deniedAfterWait = await inspectorJson(cStateSource(identifier));
  if (JSON.stringify({ hashes: deniedAfterWait.hashes, bytes: deniedAfterWait.bytes }) !== immutableSnapshot || deniedAfterWait.counts.probe !== 1 || deniedAfterWait.counts.capture !== 1) throw new Error("Gate C2 denial did not preserve canonical bytes for a retry opportunity");
  await docker(["run", "--rm", "--user", "0:0", "-v", `${volumes.runtime}:/data`, "--entrypoint", "python", "streamrecorder-worker:wave-03.5", "-c", "import json,os,tempfile; p='/data/watchlist.json'; v=json.load(open(p)); v[0]['enabled']=False; fd,t=tempfile.mkstemp(prefix='.watchlist.',dir='/data'); f=os.fdopen(fd,'w'); json.dump(v,f,separators=(',',':')); f.close(); os.chown(t,0,0); os.chmod(t,0o444); os.replace(t,p)"]);
  await delay(gateCPollOpportunityMilliseconds);
  await docker(["run", "--rm", "--user", "0:0", "-v", `${volumes.runtime}:/data`, "--entrypoint", "sh", "streamrecorder-worker:wave-03.5", "-ceu", "chown 1000:1000 /data /data/*.json; chmod 2775 /data; chmod 0664 /data/*.json"]);
  await docker(["run", "--rm", "--user", "1000:1000", "-v", `${volumes.runtime}:/data`, "--entrypoint", "sh", "streamrecorder-worker:wave-03.5", "-ceu", "python -c 'import json,os,tempfile; p=\"/data/watchlist.json\"; v=json.load(open(p)); v[0][\"enabled\"]=False; fd,t=tempfile.mkstemp(prefix=\".watchlist.\",dir=\"/data\"); f=os.fdopen(fd,\"w\"); json.dump(v,f,separators=(\",\",\":\")); f.close(); os.replace(t,p)'; probe=/data/.c2-recovery-probe; printf c2 > \"$probe.tmp\"; mv \"$probe.tmp\" \"$probe\"; test \"$(cat \"$probe\")\" = c2; rm \"$probe\""]);
  const recovered = await waitForCState(identifier, (state) => state.sessions.length === 1 && state.sessions[0].session_id === recording.session_id && state.sessions[0].state === "finished" && state.sessions[0].finished_at !== null, "Gate C2 did not persist the original terminal recording after recovery");
  if (recovered.status?.state !== "finished" || assertSingleOpenStream(recovered, identifier).id !== stream.id || recovered.sessions[0].output_file !== recording.output_file || recovered.counts.probe !== 1 || recovered.counts.capture !== 1 || recovered.events.filter((event) => event.operation === "capture_exit").length !== 1) throw new Error("Gate C2 recovery changed identities or duplicated fixture work");
  const childCheck = (await compose("exec", "-T", "worker", "sh", "-ceu", "! ps -eo args | grep -F '[s]treamlink-fixture.py'")).stdout;
  if (childCheck) throw new Error("Gate C2 fixture child check produced unexpected output");
  await compose("stop", "-t", "8", "worker");
  pass("gate_c2.terminal_persistence: denied terminal writes leave all canonical bytes unchanged through a retry interval; restored UID 1000 permissions persist the same R without duplicates or an orphan fixture child");
}

async function runGateC() {
  await runGateC1();
  await runGateC2();
}

const apiRequestSource = `import json,os,urllib.error,urllib.request
request=urllib.request.Request('http://api:3000'+os.environ['SMOKE_API_PATH'],data=os.environ.get('SMOKE_API_BODY','').encode() if os.environ.get('SMOKE_API_BODY') else None,method=os.environ['SMOKE_API_METHOD'],headers={'Content-Type':'application/json'})
try:
 response=urllib.request.urlopen(request,timeout=5); body=response.read().decode(); status=response.status
except urllib.error.HTTPError as error:
 body=error.read().decode(); status=error.code
print(json.dumps({'status':status,'body':json.loads(body) if body else None},sort_keys=True))`;

const resetGateDSource = `import json,os,pathlib,tempfile
root=pathlib.Path('/data'); state=pathlib.Path('/smoke-state')
def atomic(path,value):
 descriptor,temporary=tempfile.mkstemp(prefix='.'+path.name+'.',suffix='.tmp',dir=path.parent)
 with os.fdopen(descriptor,'w') as handle: json.dump(value,handle,separators=(',',':')); handle.flush(); os.fsync(handle.fileno())
 os.replace(temporary,path)
for child in state.iterdir():
 if child.is_dir():
  for entry in child.iterdir(): entry.unlink()
 elif child.name in {'claims.json','scenarios.json'} or child.name.startswith('release-') or child.name == '.fixture-actions.lock': child.unlink()
(state/'events').mkdir(exist_ok=True)
if os.environ.get('GATE_D_CLEAR_WATCHLIST') == '1': atomic(root/'watchlist.json',[])
atomic(root/'channels_status.json',{}); atomic(root/'streams.json',[]); atomic(root/'sessions.json',[]); atomic(state/'scenarios.json',json.loads(os.environ['GATE_D_SCENARIO']))
print(json.dumps({'scenario_ids':sorted(value['id'] for value in json.loads(os.environ['GATE_D_SCENARIO']).values())},sort_keys=True))`;

function pythonLiteral(value) {
  return value == null ? "None" : JSON.stringify(value);
}

function gateDStateSource(identifier, expectedUrl = null) {
  return `import json,pathlib
root=pathlib.Path('/data'); events=pathlib.Path('/smoke-state/events'); parsed=[]
for ready in events.glob('*.ready'):
 value=json.loads(ready.with_suffix('.json').read_text())
 if value.get('url_id') == ${pythonLiteral(identifier)}: parsed.append(value)
if len({value.get('event_id') for value in parsed}) != len(parsed): raise SystemExit('duplicate fixture event ids')
values={name:json.loads((root/name).read_text()) for name in ${JSON.stringify(canonicalFiles)}}
streams=[item for item in values['streams.json'] if item.get('watch_target_id') == ${pythonLiteral(identifier)}]
sessions=[item for item in values['sessions.json'] if item.get('channel_id') == ${pythonLiteral(identifier)}]
watchlist=values['watchlist.json']; identifiers=[item.get('id') for item in watchlist if isinstance(item,dict)]
expected_id=${pythonLiteral(identifier)}; expected_url=${pythonLiteral(expectedUrl)}
print(json.dumps({'canonical':{'valid':[isinstance(watchlist,list),isinstance(values['channels_status.json'],dict),isinstance(values['sessions.json'],list),isinstance(values['streams.json'],list)],'counts':{name:len(value) for name,value in values.items()}},'watchlist':{'count':len(watchlist),'unique_ids':len(identifiers)==len(set(identifiers)),'expected_match':sum(1 for item in watchlist if isinstance(item,dict) and item.get('id')==expected_id and item.get('url')==expected_url)},'status':values['channels_status.json'].get(expected_id),'streams':streams,'sessions':sessions,'events':parsed,'tmp':[path.name for path in root.glob('.*.tmp')]},sort_keys=True))`;
}

async function apiRequest(method, path, body) {
  return inspectorJson(apiRequestSource, { env: { SMOKE_API_METHOD: method, SMOKE_API_PATH: path, ...(body === undefined ? {} : { SMOKE_API_BODY: JSON.stringify(body) }) } });
}

async function waitForGateDState(identifier, predicate, description, timeoutMilliseconds = 18000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let last;
  while (Date.now() < deadline) {
    last = await inspectorJson(gateDStateSource(identifier));
    if (predicate(last)) return last;
    await delay(100);
  }
  throw new Error(`${description}: ${JSON.stringify(last)}`);
}

async function stopWorkerForGateD() {
  const running = (await compose("ps", "--services", "--status", "running")).stdout.split(/\r?\n/);
  if (running.includes("worker")) await compose("stop", "-t", "8", "worker");
}

async function resetGateD(scenario, clearWatchlist = false) {
  await stopWorkerForGateD();
  await docker(["run", "--rm", "-v", `${volumes.recordings}:/recordings`, "--entrypoint", "sh", "streamrecorder-worker:wave-03.5", "-ceu", "rm -rf /recordings/*"]);
  const prepared = await inspectorJson(resetGateDSource, { env: { GATE_D_SCENARIO: JSON.stringify(scenario), ...(clearWatchlist ? { GATE_D_CLEAR_WATCHLIST: "1" } : {}) } });
  if (!Array.isArray(prepared.scenario_ids)) throw new Error("Gate D isolated reset failed");
}

function assertGateDCanonical(state, identifier, requireNoTemporaryFiles = false) {
  if (!state.canonical?.valid?.every(Boolean)) throw new Error(`Gate D canonical JSON shape check failed for ${identifier}`);
  if (requireNoTemporaryFiles && state.tmp.length) throw new Error(`Gate D left stale temporary files: ${JSON.stringify(state.tmp)}`);
  if (state.streams.length > 1 || state.sessions.length > 1) throw new Error(`Gate D duplicated persisted state for ${identifier}`);
}

function assertGateDWatchlist(state, identifier, expectedCount, expectedMatch) {
  if (state.watchlist?.count !== expectedCount || state.watchlist?.unique_ids !== true || state.watchlist?.expected_match !== expectedMatch) throw new Error(`Gate D watchlist assertion failed for ${identifier}: count=${state.watchlist?.count}, unique_ids=${state.watchlist?.unique_ids}, expected_match=${state.watchlist?.expected_match}`);
}

function assertGateDLogs(workerLogs, apiLogs) {
  const unsafePatterns = [
    /PermissionError/i,
    /(?:JSONDecodeError|json\s+(?:decode|parse|corrupt)|(?:decode|parse|corrupt)\s+json)/i,
    /(?:stale|leftover)\s+(?:temporary|temp)|(?:temporary|temp)\s+(?:file\s+)?(?:exists|stale|leftover)/i,
    /(?:atomic|os\.)?(?:replace|write)\s+(?:failed|error)|(?:failed|error)\s+(?:atomic\s+)?(?:replace|write)/i,
  ];
  for (const pattern of unsafePatterns) {
    if (pattern.test(workerLogs) || pattern.test(apiLogs)) throw new Error(`Gate D1 persistence log scan matched ${pattern}`);
  }
}

async function runGateD1() {
  const resolved = JSON.parse((await compose("config", "--format", "json")).stdout);
  if (resolved.volumes?.["smoke-runtime"]?.name !== volumes.runtime) throw new Error("Gate D1 runtime volume physical name is not isolated");
  for (const service of ["api", "worker", "inspector"]) {
    const mount = resolved.services[service]?.volumes?.find((value) => value.target === "/data");
    if (mount?.type !== "volume" || mount.source !== "smoke-runtime") throw new Error(`Gate D1 ${service} /data does not resolve to the isolated runtime volume`);
  }
  const generatedTargetIds = new Set();
  for (const suffix of ["a", "b"]) {
    const identifier = `smoke-d1-${suffix}`;
    const url = `https://smoke.invalid/cross-writer-${suffix}`;
    await resetGateD({}, true);
    const empty = await inspectorJson(gateDStateSource(null, null));
    assertGateDCanonical(empty, "reset", true);
    assertGateDWatchlist(empty, "reset", 0, 0);
    const created = await apiRequest("POST", "/watch-targets", { creator_id: "smoke-cross-writer", channel_name: identifier, platform: "twitch", url, quality: "best", recording_subdir: "smoke/isolated" });
    if (created.status !== 201 || typeof created.body?.id !== "string") throw new Error(`Gate D1 API create failed: ${JSON.stringify(created)}`);
    const targetId = created.body.id;
    if (generatedTargetIds.has(targetId)) throw new Error(`Gate D1 generated duplicate dynamic target ID: ${targetId}`);
    generatedTargetIds.add(targetId);
    const posted = await inspectorJson(gateDStateSource(targetId, url));
    assertGateDCanonical(posted, targetId, true);
    assertGateDWatchlist(posted, targetId, 1, 1);
    const scenario = { [url]: { id: targetId, probes: ["OFFLINE"] } };
    await resetGateD(scenario);
    const workerLogSince = new Date().toISOString();
    await compose("up", "-d", "--no-deps", "worker");
    const workerContainerId = (await compose("ps", "-q", "worker")).stdout.trim();
    if (!workerContainerId) throw new Error("Gate D1 Worker container ID is unavailable");
    const state = await waitForGateDState(targetId, (value) => value.events.filter((event) => event.operation === "probe").length === 1 && value.status?.state === "offline", "Gate D1 Worker did not persist offline status");
    assertGateDCanonical(state, targetId, true);
    const throughApi = await apiRequest("GET", `/watch-targets/${encodeURIComponent(targetId)}`);
    if (throughApi.status !== 200 || throughApi.body?.id !== targetId || throughApi.body?.url !== url || throughApi.body?.state !== "offline") throw new Error("Gate D1 API did not return the Worker-produced offline target state");
    await stopWorkerForGateD();
    const workerLogs = await docker(["logs", "--since", workerLogSince, workerContainerId]);
    const apiContainerId = (await compose("ps", "-q", "api")).stdout.trim();
    if (!apiContainerId) throw new Error("Gate D1 API container ID is unavailable");
    const apiLogs = await docker(["logs", "--since", workerLogSince, "--tail", "200", apiContainerId]);
    assertGateDLogs(`${workerLogs.stdout ?? ""}\n${workerLogs.stderr ?? ""}`, `${apiLogs.stdout ?? ""}\n${apiLogs.stderr ?? ""}`);
    const deleted = await apiRequest("DELETE", `/watch-targets/${encodeURIComponent(targetId)}`);
    const absent = await apiRequest("GET", `/watch-targets/${encodeURIComponent(targetId)}`);
    if (deleted.status !== 200 || absent.status !== 404) throw new Error(`Gate D1 API delete/404 failed: ${JSON.stringify({ deleted, absent })}`);
    const deletedState = await inspectorJson(gateDStateSource(targetId, url));
    assertGateDCanonical(deletedState, targetId, true);
    assertGateDWatchlist(deletedState, targetId, 0, 0);
  }
  if (generatedTargetIds.size !== 2) throw new Error("Gate D1 did not generate distinct dynamic target IDs across cycles");
  pass("gate_d1.cross_writer: each isolated API POST creates one unique dynamic WatchTarget, a fresh Worker persists offline state visible through API GET, and API DELETE restores canonical empty state without persistence errors or stale temporary files");
}

async function runGateD2() {
  const identifier = "smoke-d2";
  const url = "https://smoke.invalid/d2";
  await resetGateD({ [url]: { id: identifier, probes: ["LIVE"], captures: ["hold-until-signal"] } }, true);
  const direct = await inspectorJson(`import json,os,pathlib,tempfile
path=pathlib.Path('/data/watchlist.json'); values=json.loads(path.read_text()); values.append({'id':'${identifier}','channel_name':'${identifier}','platform':'twitch','url':'${url}','quality':'best','enabled':True,'recording_subdir':'smoke/isolated'}); fd,tmp=tempfile.mkstemp(prefix='.watchlist.',suffix='.tmp',dir=path.parent)
with os.fdopen(fd,'w') as handle: json.dump(values,handle,separators=(',',':')); handle.flush(); os.fsync(handle.fileno())
os.replace(tmp,path); print('{}')`);
  if (Object.keys(direct).length) throw new Error("Gate D2 direct target setup emitted unexpected data");
  await compose("up", "-d", "--no-deps", "worker");
  const containerId = (await compose("ps", "-q", "worker")).stdout.trim();
  if (!containerId) throw new Error("Gate D2 Worker container ID is unavailable");
  const active = await waitForGateDState(identifier, (state) => state.events.some((event) => event.operation === "capture") && state.sessions.length === 1 && state.sessions[0].state === "recording" && !state.events.some((event) => event.operation === "capture_signal" || event.operation === "capture_exit"), "Gate D2 capture did not become active");
  if (!(JSON.parse((await docker(["inspect", containerId])).stdout)[0]?.State?.Running)) throw new Error("Gate D2 Worker stopped before signal test");
  await Promise.race([compose("stop", "-t", "8", "worker"), delay(14000).then(() => { throw new Error("Gate D2 compose stop exceeded bounded timeout"); })]);
  const inspected = JSON.parse((await docker(["inspect", containerId])).stdout)[0];
  if (inspected.State?.Running || inspected.State?.ExitCode !== 0 || inspected.State?.OOMKilled || inspected.State?.Pid !== 0 || inspected.State?.ExitCode === 137) throw new Error(`Gate D2 Worker stop state failed: ${JSON.stringify(inspected.State)}`);
  const finished = await waitForGateDState(identifier, (state) => state.sessions.length === 1 && state.sessions[0].state === "error" && state.sessions[0].finished_at && state.status?.state === "error", "Gate D2 shutdown persistence failed");
  assertGateDCanonical(finished, identifier);
  const events = finished.events.filter((event) => ["capture", "capture_signal", "capture_exit"].includes(event.operation)).sort((left, right) => left.sequence - right.sequence);
  if (events.length !== 3 || events.map((event) => event.operation).join(",") !== "capture,capture_signal,capture_exit" || events[1].signal !== 15 || new Set(events.map((event) => `${event.pid}:${event.process_id}`)).size !== 1) throw new Error(`Gate D2 signal event ordering/correlation failed: ${JSON.stringify(events)}`);
  const top = await docker(["top", containerId], { maxBuffer: 1024 * 1024 }).catch((error) => ({ stderr: error.message }));
  if (!String(top.stdout ?? top.stderr).includes("is not running")) throw new Error("Gate D2 stopped container still reports runnable processes");
  if (active.events.filter((event) => event.operation === "capture").length !== 1) throw new Error("Gate D2 started more than one capture");
  pass("gate_d2.graceful_stop: retained Worker exits 0 after SIGTERM, persists error completion, emits one correlated capture -> SIGTERM -> exit sequence, and leaves no runnable child");
}

async function runGateD3() {
  const identifier = "smoke-d3";
  const url = "https://smoke.invalid/d3";
  const longSafeDiagnostic = `safe long fixture diagnostic ${"x".repeat(450)}`;
  const stderr = [
    "Authorization: Bearer SECRET_AUTH token=SECRET_TOKEN access_token=SECRET_ACCESS refresh_token=SECRET_REFRESH cookie=SECRET_COOKIE signed=SECRET_SIGNED sig=SECRET_SIG https://user:password@smoke.invalid/private?auth=SECRET_QUERY_AUTH attacker\r\u0000\u007f\t",
    "safe fixture diagnostic",
    longSafeDiagnostic,
  ].join("\n");
  await resetGateD({ [url]: { id: identifier, probes: ["LIVE"], captures: [{ mode: "success", capture_exit: true, stderr }] } }, true);
  await inspectorJson(`import json,os,pathlib,tempfile
path=pathlib.Path('/data/watchlist.json'); values=json.loads(path.read_text()); values.append({'id':'${identifier}','channel_name':'${identifier}','platform':'twitch','url':'${url}','quality':'best','enabled':True,'recording_subdir':'smoke/isolated'}); fd,tmp=tempfile.mkstemp(prefix='.watchlist.',suffix='.tmp',dir=path.parent)
with os.fdopen(fd,'w') as handle: json.dump(values,handle,separators=(',',':')); handle.flush(); os.fsync(handle.fileno())
os.replace(tmp,path); print('{}')`);
  await compose("up", "-d", "--no-deps", "worker");
  const containerId = (await compose("ps", "-q", "worker")).stdout.trim();
  const state = await waitForGateDState(identifier, (value) => value.events.some((event) => event.operation === "capture_exit") && value.sessions.length === 1 && value.sessions[0].finished_at, "Gate D3 capture did not finish");
  assertGateDCanonical(state, identifier);
  const logDeadline = Date.now() + 4000;
  let logs = "";
  while (Date.now() < logDeadline) {
    const result = await docker(["logs", containerId]);
    logs = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (logs.includes("diagnostic suppressed") && logs.includes("Streamlink diagnostic")) break;
    await delay(100);
  }
  for (const secret of ["SECRET_AUTH", "SECRET_TOKEN", "SECRET_ACCESS", "SECRET_REFRESH", "SECRET_COOKIE", "SECRET_SIGNED", "SECRET_SIG", "user:password", "SECRET_QUERY_AUTH", "attacker"]) if (logs.includes(secret)) throw new Error(`Gate D3 leaked diagnostic content: ${secret}`);
  if (!logs.includes("diagnostic suppressed") || !logs.includes("Streamlink diagnostic")) throw new Error("Gate D3 lacks suppressed marker or normalized safe diagnostic");
  const diagnosticMessages = logs.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/Streamlink diagnostic \(watch_target_id=smoke-d3, message=(.*)\)$/);
    return match ? [match[1]] : [];
  });
  if (!diagnosticMessages.includes("safe fixture diagnostic") || !diagnosticMessages.some((message) => message.startsWith("safe long fixture diagnostic "))) throw new Error("Gate D3 lacks normalized safe diagnostic records");
  if (diagnosticMessages.some((message) => message.length > 256) || !diagnosticMessages.some((message) => message.length === 256)) throw new Error("Gate D3 diagnostic records are not bounded");
  if (/\r|\u0000|\u007f/.test(logs)) throw new Error("Gate D3 emitted raw control characters or multiline diagnostic injection");
  await stopWorkerForGateD();
  pass("gate_d3.stderr_sanitization: fixture stderr reached the real PIPE drain path while secrets, credentials, controls, and continuation content stayed out of bounded Docker logs with suppression and safe diagnostics present");
}

async function runGateD() {
  await runGateD1();
  await runGateD2();
  await runGateD3();
}

async function inspectNormal(name) {
  const inspected = JSON.parse((await docker(["inspect", name])).stdout)[0];
  if (!inspected || inspected.State?.Running) throw new Error(`Normal container ${name} must exist and be stopped`);
  const audit = jsonLine((await docker(["run", "--rm", "--volumes-from", `${name}:ro`, "--entrypoint", "python", "streamrecorder-worker:wave-03.5", "-c", auditSource])).stdout);
  if (!audit.valid?.every(Boolean)) throw new Error(`Normal container ${name} has invalid canonical JSON shapes`);
  return { id: inspected.Id, status: inspected.State.Status, audit };
}

async function ownedVolume(name) {
  const volume = JSON.parse((await docker(["volume", "inspect", name])).stdout)[0];
  return volume?.Name === name && volume.Labels?.["streamrecorder.smoke.owned"] === "true" && volume.Labels?.["streamrecorder.smoke.project"] === project;
}

async function cleanup() {
  const errors = [];
  try { await compose("down", "--remove-orphans"); } catch (error) { errors.push(`Compose project cleanup failed: ${error.message}`); }
  for (const name of createdVolumes.reverse()) {
    try {
      if (!await ownedVolume(name)) throw new Error("ownership labels do not match");
      await docker(["volume", "rm", name]);
    } catch (error) { errors.push(`Volume cleanup failed for ${name}: ${error.message}`); }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

async function main() {
  environment = { ...process.env, SMOKE_RUNTIME_VOLUME: volumes.runtime, SMOKE_RECORDINGS_VOLUME: volumes.recordings, SMOKE_STATE_VOLUME: volumes.state, SMOKE_FIXTURE_DIR: resolve(root, "scripts", "docker-smoke") };
  normalSnapshot = Object.fromEntries(await Promise.all(normalContainers.map(async (name) => [name, await inspectNormal(name)])));
  if (JSON.stringify(normalSnapshot[normalContainers[0]].audit) !== JSON.stringify(normalSnapshot[normalContainers[1]].audit)) throw new Error("Normal API and Worker canonical data audits differ");
  pass("gate_a.normal_source: normal API and Worker are stopped; read-only canonical structural audits and fingerprints match");

  await compose("build", "api", "worker");
  const resolved = JSON.parse((await compose("config", "--format", "json")).stdout);
  for (const name of ["api", "worker", "inspector"]) {
    for (const mount of resolved.services[name]?.volumes ?? []) {
      if (mount.type === "bind" && !(mount.source === environment.SMOKE_FIXTURE_DIR && mount.read_only === true)) throw new Error(`${name} has an unsafe bind mount`);
      if (!["bind", "volume"].includes(mount.type)) throw new Error(`${name} has an invalid mount type`);
    }
  }
  if ((resolved.services.worker.volumes ?? []).filter((mount) => mount.type === "bind").length !== 1) throw new Error("Worker fixture source is not the sole bind mount");
  pass("gate_a.compose_config: resolved Compose configuration has named mutable volumes and one read-only fixture bind");

  for (const name of Object.values(volumes)) {
    await docker(["volume", "create", "--label", "streamrecorder.smoke.owned=true", "--label", `streamrecorder.smoke.project=${project}`, name]);
    createdVolumes.push(name);
    if (!await ownedVolume(name)) throw new Error(`Volume ownership verification failed for ${name}`);
  }
  await docker(["run", "--rm", "--user", "0:0", "-v", `${volumes.runtime}:/runtime`, "-v", `${volumes.recordings}:/recordings`, "-v", `${volumes.state}:/smoke-state`, "--entrypoint", "sh", "streamrecorder-worker:wave-03.5", "-ceu", "mkdir -p /runtime /recordings /smoke-state; chown 1000:1000 /runtime /recordings /smoke-state; chmod 2775 /runtime /recordings /smoke-state"]);
  pass("gate_a.named_volumes: three uniquely named, project-owned volumes exist for runtime, recordings, and state");

  const sourceContainer = normalContainers[0];
  const imported = jsonLine((await docker(["run", "--rm", "--user", "0:0", "--volumes-from", `${sourceContainer}:ro`, "-v", `${volumes.runtime}:/isolated`, "--entrypoint", "python", "streamrecorder-worker:wave-03.5", "-c", importSource])).stdout);
  if (JSON.stringify(imported.counts) !== JSON.stringify(normalSnapshot[sourceContainer].audit.shapes) || JSON.stringify(imported.semantic_fingerprints) !== JSON.stringify(normalSnapshot[sourceContainer].audit.semantic_fingerprints)) throw new Error("Importer changed non-URL canonical data");
  pass("gate_a.import: one-shot read-only importer preserves safe semantic fingerprints and counts while atomically sanitizing isolated URLs");

  const runtimeProbe = "test -r /data/watchlist.json; for directory in /data /recordings /smoke-state; do probe=\"$directory/.production-runtime-probe\"; printf runtime > \"$probe.tmp\"; test -s \"$probe.tmp\"; mv \"$probe.tmp\" \"$probe\"; test -s \"$probe\"; rm \"$probe\"; done";
  const production = await docker(["run", "--rm", "--user", "1000:1000", "-v", `${volumes.runtime}:/data`, "-v", `${volumes.recordings}:/recordings`, "-v", `${volumes.state}:/smoke-state`, "--entrypoint", "sh", "streamrecorder-worker:wave-03.5", "-ceu", `python --version; /usr/local/bin/streamlink --version; python -m pip check; id; ${runtimeProbe}`]);
  if (!production.stdout.includes("Python 3.12.") || !production.stdout.includes("streamlink 8.6.1") || !production.stdout.includes("No broken requirements found.") || !/uid=1000\(/.test(production.stdout)) throw new Error("production runtime version, dependency, identity, or volume probes failed");
  pass("gate_a.runtime: one-shot production Worker image verifies Python, Streamlink 8.6.1, pip, UID/GID 1000, and read/write/replace probes before fixture PATH setup");

  await compose("up", "-d", "api", "inspector");
  inspectorContainer = (await compose("ps", "-q", "inspector")).stdout.trim();
  if (!inspectorContainer) throw new Error("Inspector container did not start");
  const apiIdentity = (await compose("exec", "-T", "api", "id")).stdout;
  await compose("exec", "-T", "api", "sh", "-ceu", "test -r /data/watchlist.json && test -w /data");
  const activeServices = (await compose("ps", "--services", "--all")).stdout.trim().split(/\r?\n/).filter(Boolean);
  if (!/uid=1000\(/.test(apiIdentity) || activeServices.includes("worker") || !activeServices.includes("api") || !activeServices.includes("inspector")) throw new Error("API identity/access or Gate A service isolation check failed");
  pass("gate_a.api_identity: only API and inspector persist; API runs as UID/GID 1000 with isolated runtime access");

  const fixtureChecks = (await compose("run", "--rm", "--no-deps", "worker", "sh", "-ceu", "command -v streamlink; /usr/local/bin/streamlink --version; printf fixture-path > /smoke-state/.fixture-path-probe.tmp; mv /smoke-state/.fixture-path-probe.tmp /smoke-state/fixture-path-probe")).stdout;
  if (!fixtureChecks.includes("/tmp/streamrecorder-smoke-bin/streamlink") || !fixtureChecks.includes("streamlink 8.6.1")) throw new Error("fixture PATH resolution did not preserve real Streamlink diagnostics");
  const stateProbe = (await compose("exec", "-T", "inspector", "sh", "-ceu", "test \"$(cat /smoke-state/fixture-path-probe)\" = fixture-path")).stdout;
  if (stateProbe) throw new Error("unexpected fixture state probe output");
  const boundedLogs = (await compose("logs", "--tail=20", "api", "inspector")).stdout;
  if (/worker\.py|poll_loop|streamlink --json/.test(boundedLogs)) throw new Error("bounded persistent-service logs show unexpected Worker polling or probes");
  pass("gate_a.fake_path: one-shot fake-PATH helper exits without Worker polling; bounded API/inspector logs and its state probe confirm real platform access is NOT_RUN");

  await runGateB();
  await runGateC();
  await runGateD();
}

let failure;
try { await main(); } catch (error) { failure = error; console.error(`FAIL smoke: ${error.message}`); } finally {
  try { await cleanup(); } catch (error) { failure ??= error; console.error(`FAIL cleanup: ${error.message}`); }
  if (normalSnapshot) {
    try {
      for (const name of normalContainers) {
        if (JSON.stringify(await inspectNormal(name)) !== JSON.stringify(normalSnapshot[name])) throw new Error(`${name} changed during Gate A`);
      }
      pass("cleanup removed only owned resources; normal container IDs, states, and canonical data are unchanged");
    } catch (error) { failure ??= error; console.error(`FAIL normal-data safety: ${error.message}`); }
  }
}
if (failure) process.exitCode = 1;
