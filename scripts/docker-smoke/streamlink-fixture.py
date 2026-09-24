#!/usr/bin/env python3
"""Deterministic, test-only Streamlink replacement for Docker smoke scenarios."""

import json
import os
import pathlib
import signal
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

PROCESS_ID = str(uuid.uuid4())
SEQUENCE = 0


def append_event(operation, **details):
    global SEQUENCE

    state_dir = pathlib.Path(os.environ["SMOKE_FIXTURE_STATE_DIR"])
    events_dir = pathlib.Path(os.environ["SMOKE_FIXTURE_EVENTS_DIR"])
    state_dir.mkdir(parents=True, exist_ok=True)
    events_dir.mkdir(parents=True, exist_ok=True)
    SEQUENCE += 1
    event_id = f"{time.time_ns()}-{os.getpid()}-{PROCESS_ID}-{SEQUENCE}"
    event = {
        "event_id": event_id,
        "operation": operation,
        "pid": os.getpid(),
        "process_id": PROCESS_ID,
        "sequence": SEQUENCE,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **details,
    }
    encoded_event = json.dumps(event, separators=(",", ":")).encode("utf-8")
    event_path = events_dir / f"{event_id}.json"
    ready_path = events_dir / f"{event_id}.ready"
    descriptor = os.open(event_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, encoded_event)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    ready_descriptor = os.open(ready_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.fsync(ready_descriptor)
    finally:
        os.close(ready_descriptor)


def scenarios():
    with open(os.environ["SMOKE_FIXTURE_SCENARIOS"], encoding="utf-8") as handle:
        return json.load(handle)


def scenario_for_args(args):
    configured_scenarios = scenarios()
    for argument in args:
        if argument in configured_scenarios:
            return argument, configured_scenarios[argument]
    return None, None


def claim_action(url_id, operation, scenario):
    actions = scenario.get(operation, scenario.get(operation[:-1], []))
    if not isinstance(actions, list):
        actions = [actions]
    if not actions:
        return scenario.get(operation[:-1], "ERROR")

    state_dir = pathlib.Path(os.environ["SMOKE_FIXTURE_STATE_DIR"])
    lock_path = state_dir / ".fixture-actions.lock"
    claims_path = state_dir / "claims.json"
    while True:
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(descriptor)
            break
        except FileExistsError:
            time.sleep(0.01)
    try:
        try:
            claims = json.loads(claims_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            claims = {}
        key = f"{url_id}:{operation}"
        index = claims.get(key, 0)
        claims[key] = index + 1
        temporary = claims_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(claims), encoding="utf-8")
        os.replace(temporary, claims_path)
    finally:
        lock_path.unlink(missing_ok=True)
    return actions[min(index, len(actions) - 1)]


def wait_for_gate(action, url_id):
    gate = action.get("gate") if isinstance(action, dict) else None
    if not gate:
        return
    gate_path = pathlib.Path(os.environ["SMOKE_FIXTURE_STATE_DIR"]) / f"release-{gate}"
    append_event("gate_wait", url_id=url_id, gate=gate)
    for _ in range(300):
        if gate_path.exists():
            append_event("gate_release", url_id=url_id, gate=gate)
            return
        time.sleep(0.05)
    raise RuntimeError("fixture gate timed out")


def wait_for_completion_gate(action, url_id):
    gate = action.get("completion_gate") if isinstance(action, dict) else None
    if not gate:
        return
    gate_path = pathlib.Path(os.environ["SMOKE_FIXTURE_STATE_DIR"]) / f"release-{gate}"
    append_event("capture_ready", url_id=url_id, gate=gate)
    for _ in range(1200):
        if gate_path.exists():
            append_event("capture_release", url_id=url_id, gate=gate)
            return
        time.sleep(0.05)
    raise RuntimeError("fixture completion gate timed out")


def run_probe(url, scenario):
    url_id = scenario.get("id", "unknown")
    action = claim_action(url_id, "probes", scenario)
    result = action.get("result", "ERROR") if isinstance(action, dict) else action
    wait_for_gate(action, url_id) if isinstance(action, dict) else None
    stderr = action.get("stderr", scenario.get("probe_stderr")) if isinstance(action, dict) else scenario.get("probe_stderr")
    if stderr:
        sys.stderr.write(stderr)
        sys.stderr.flush()
    append_event("probe", url_id=url_id, result=result)
    if result == "LIVE":
        print(json.dumps({"streams": {"best": {"type": "hls"}}}))
        return 0
    if result == "OFFLINE":
        print(json.dumps({"error": f"No playable streams found on this URL: {url}"}))
        return 1
    print(json.dumps({"error": "fixture probe error"}))
    return 2


def run_capture(args, scenario):
    output = pathlib.Path(args[args.index("-o") + 1])
    url_id = scenario.get("id", "unknown")
    action = claim_action(url_id, "captures", scenario)
    mode = action.get("mode", "success") if isinstance(action, dict) else action
    wait_for_gate(action, url_id) if isinstance(action, dict) else None
    append_event("capture", url_id=url_id, mode=mode, output_basename=output.name)
    stderr = action.get("stderr", scenario.get("capture_stderr")) if isinstance(action, dict) else scenario.get("capture_stderr")
    if stderr:
        sys.stderr.write(stderr)
        sys.stderr.flush()
    if mode == "fail":
        return 1
    if mode == "hold-until-release":
        wait_for_completion_gate(action, url_id)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"fixture-media")
        append_event("capture_exit", url_id=url_id, exit_code=0)
        return 0
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(b"fixture-media")
    if mode in ("hold", "hold-until-signal"):
        terminated = False

        def mark_signal(signum, _frame):
            nonlocal terminated
            terminated = True
            append_event("capture_signal", url_id=url_id, signal=signum)

        signal.signal(signal.SIGTERM, mark_signal)
        signal.signal(signal.SIGINT, mark_signal)
        while not terminated:
            time.sleep(0.05)
        append_event("capture_exit", url_id=url_id, exit_code=0)
    elif isinstance(action, dict) and action.get("capture_exit"):
        append_event("capture_exit", url_id=url_id, exit_code=0)
    return 0


def main():
    args = sys.argv[1:]
    if len(args) == 3 and args[0] == "--emit-test-events":
        correlation_id, count_text = args[1:]
        count = int(count_text)
        if count < 1:
            raise ValueError("test event count must be positive")
        for _ in range(count):
            append_event("test_emit", correlation_id=correlation_id)
        return 0
    if args == ["--version"]:
        return subprocess.run(["/usr/local/bin/streamlink", "--version"], check=False).returncode
    url, scenario = scenario_for_args(args)
    if scenario is None:
        sys.stderr.write("fixture rejected unknown URL\n")
        return 2
    if "--json" in args:
        return run_probe(url, scenario)
    return run_capture(args, scenario)


if __name__ == "__main__":
    sys.exit(main())