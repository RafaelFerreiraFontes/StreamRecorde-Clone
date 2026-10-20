import ctypes
import json
import logging
import os
import pathlib
import random
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


log = logging.getLogger("worker")


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def pid_is_dead(pid):
    if type(pid) is not int or pid <= 0:
        return False
    if os.name == "nt":
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() == 87
        try:
            code = ctypes.c_ulong()
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value != 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except OSError:
        return False
    return False


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Outbox:
    def __init__(self, directory, base_url, token, transport=None, clock=time.monotonic, jitter=random.random):
        if not isinstance(token, str) or not token.strip():
            raise RuntimeError("INTERNAL_API_TOKEN must be configured when bridge mode is enabled")
        parsed = urlsplit(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Invalid bridge base URL")
        self.pending = pathlib.Path(directory) / "pending"
        self.active = pathlib.Path(directory) / "active"
        self.pending.mkdir(parents=True, exist_ok=True)
        self.active.mkdir(parents=True, exist_ok=True)
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.transport = transport or self._request
        self.clock = clock
        self.jitter = jitter
        self.next_retry = 0
        self.failures = 0
        self.config_failures = 0
        self.config_retry = 0
        self.sequence = 0
        self.blocked_targets = set()
        self.mutex = threading.RLock()

    def _request(self, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(self.base_url + path, data=body, method=method,
                          headers={"X-Internal-Token": self.token, "Content-Type": "application/json"})
        with build_opener(NoRedirect()).open(request, timeout=10) as response:
            data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise ValueError("Bridge response exceeds limit")
            return json.loads(data)

    def configs(self):
        if self.clock() < self.config_retry:
            raise RuntimeError("Execution config retry backoff active")
        try:
            result = self.transport("GET", "/internal/v1/watch-targets/execution-configs")
            if not isinstance(result, list) or not all(isinstance(item, dict) for item in result):
                raise ValueError("Invalid bridge execution configs")
        except Exception:
            self.config_failures += 1
            self.config_retry = self.clock() + min(60, 2 ** min(self.config_failures, 6)) * (0.5 + self.jitter())
            raise
        self.config_failures = 0
        self.config_retry = 0
        return result

    def _sync_directory(self, directory):
        if os.name != "nt":
            descriptor = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)

    def _write(self, destination, payload):
        encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
        if len(encoded) > 65536:
            raise ValueError("Outbox payload exceeds limit")
        descriptor, temporary = tempfile.mkstemp(prefix=".tmp-", dir=destination.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
            self._sync_directory(destination.parent)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _read(self, path):
        if path.stat().st_size > 65536:
            raise ValueError("Outbox payload exceeds limit")
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)

    def checkpoint(self, payload):
        session_id = str(uuid.UUID(payload["session_id"]))
        with self.mutex:
            self._write(self.active / (session_id + ".json"), payload)

    def event(self, event_type, target_id, **values):
        return {"event_id": str(uuid.uuid4()), "event_type": event_type,
                "occurred_at": utc_now(), "watch_target_id": target_id, **values}

    def files(self):
        return sorted(self.pending.glob("*.json"))

    def ready(self, target_id):
        with self.mutex:
            return target_id not in self.blocked_targets and not self.files()

    def enqueue(self, event):
        with self.mutex:
            event_id = str(uuid.UUID(event["event_id"]))
            existing = list(self.pending.glob("*_" + event_id + ".json"))
            if existing:
                if self._read(existing[0]) != event:
                    raise ValueError("Conflicting local event ID")
                return
            files = self.files()
            if len(files) >= 1000:
                log.error("Worker outbox saturated; blocking new launches")
                raise RuntimeError("Outbox saturated")
            self.sequence += 1
            timestamp = max(int(time.time() * 1000), int(files[-1].name.split("_")[0]) if files else 0)
            if files:
                self.sequence = max(self.sequence, int(files[-1].name.split("_")[1]) + 1)
            self._write(self.pending / f"{timestamp:016d}_{self.sequence:012d}_{event_id}.json", event)

    def replay(self):
        with self.mutex:
            if self.clock() < self.next_retry:
                return False
            for path in self.files():
                try:
                    event = self._read(path)
                    uuid.UUID(event["event_id"])
                    uuid.UUID(event["watch_target_id"])
                    if event["event_type"] not in ("recording.start", "recording.terminal", "stream.offline"):
                        raise ValueError("Invalid event type")
                    response = self.transport("POST", "/internal/v1/events", event)
                    if not isinstance(response, dict) or response.get("acknowledged") is not True:
                        raise ValueError("Missing durable acknowledgement")
                    session_id = event.get("session_id")
                    checkpoint_path = self.active / (str(uuid.UUID(session_id)) + ".json") if session_id else None
                    if event["event_type"] == "recording.start":
                        if response.get("session_id") != session_id:
                            raise ValueError("Mismatched acknowledgement")
                        uuid.UUID(response["stream_id"])
                        if checkpoint_path.exists():
                            checkpoint = self._read(checkpoint_path)
                            checkpoint.update(phase="start_committed", stream_id=response["stream_id"])
                            self.checkpoint(checkpoint)
                    elif event["event_type"] == "recording.terminal":
                        if response.get("session_id") != session_id or response.get("state") != event["state"]:
                            raise ValueError("Mismatched terminal acknowledgement")
                        if checkpoint_path.exists():
                            checkpoint_path.unlink()
                            self._sync_directory(self.active)
                        if not any(self._read(active_path).get("watch_target_id") == event["watch_target_id"]
                                   for active_path in self.active.glob("*.json")):
                            self.blocked_targets.discard(event["watch_target_id"])
                    path.unlink()
                    self._sync_directory(self.pending)
                except Exception as error:
                    self.failures += 1
                    self.next_retry = self.clock() + min(60, 2 ** min(self.failures, 6)) * (0.5 + self.jitter())
                    log.warning("Worker bridge replay pending (exception_type=%s, failures=%s)", type(error).__name__, self.failures)
                    return False
            self.failures = 0
            self.next_retry = 0
            return True

    def start(self, target_id, session_id, stream_id, output_file, quality):
        with self.mutex:
            if not self.ready(target_id):
                raise RuntimeError("Bridge not ready for launch")
            event = self.event("recording.start", target_id, session_id=session_id,
                               stream_id=stream_id or str(uuid.uuid4()), output_file=output_file, quality=quality)
            checkpoint = {"session_id": session_id, "stream_id": event["stream_id"], "watch_target_id": target_id,
                          "event_id": event["event_id"], "started_at": event["occurred_at"],
                          "output_file": output_file, "phase": "start_pending", "pid": None, "create_time": None}
            self.checkpoint(checkpoint)
            self.blocked_targets.add(target_id)
            self.enqueue(event)
            if not self.replay():
                raise RuntimeError("Start acknowledgement pending; launch blocked")
            return self._read(self.active / (session_id + ".json"))

    def launched(self, checkpoint, process):
        with self.mutex:
            checkpoint.update(pid=process.pid, create_time=time.time(), phase="capturing")
            self.checkpoint(checkpoint)

    def terminal(self, checkpoint, state, output_file, occurred_at=None, reason=None):
        with self.mutex:
            event = checkpoint.get("terminal_event")
            if event is None:
                event = self.event("recording.terminal", checkpoint["watch_target_id"],
                                   session_id=checkpoint["session_id"], stream_id=checkpoint["stream_id"],
                                   state=state, output_file=output_file)
                if occurred_at:
                    event["occurred_at"] = occurred_at
                if reason:
                    event["reason"] = reason
                checkpoint.update(phase="terminal_pending", terminal_event=event)
                self.checkpoint(checkpoint)
            self.enqueue(event)
            self.replay()
            acknowledged = not (self.active / (checkpoint["session_id"] + ".json")).exists()
            if acknowledged:
                self.blocked_targets.discard(checkpoint["watch_target_id"])
            return acknowledged

    def recover(self):
        with self.mutex:
            self.replay()
            for path in sorted(self.active.glob("*.json")):
                checkpoint = self._read(path)
                target_id = str(uuid.UUID(checkpoint["watch_target_id"]))
                if path.stem != str(uuid.UUID(checkpoint["session_id"])):
                    raise ValueError("Invalid active checkpoint filename")
                self.blocked_targets.add(target_id)
                if checkpoint.get("terminal_event") or pid_is_dead(checkpoint.get("pid")):
                    self.terminal(checkpoint, "error", checkpoint.get("output_file"), reason="worker_restart_interruption")
                else:
                    log.warning("Ambiguous active capture ownership for target %s; blocking new launches until reconciliation", target_id)