"""
Stream recording Worker (local MVP).

Responsibilities:
- Read a watchlist (JSON) containing the streams the user wants to record.
- Periodically check if each stream is live (using Streamlink, without
requiring an API key from any platform).
- Upon detecting a live stream, launch Streamlink + FFmpeg to record in MP4
  format directly to the mounted local folder (`/recordings`).
- Maintain a `status.json` file tracking the state of each stream (idle/offline/
  recording/finished/error) — currently read manually, but it uses the same
  event format that will later trigger database updates and WebSocket
  notifications in Phase 5.

This covers Phase 1.5 (recording worker) and part of Phase 4.1 (checking
online status) of the plan, intentionally excluding: the queue (BullMQ),
OAuth, and cloud upload (Phase 4.4), which will be implemented later.
"""

import uuid
import json
import logging
import os
import pathlib
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime
from typing import Optional

try:
    from worker.json_adapters import (
        RecordingJsonAdapter,
        RuntimeStatusJsonAdapter,
        StreamJsonAdapter,
        WatchTargetJsonAdapter,
    )
except ModuleNotFoundError:
    from json_adapters import (
        RecordingJsonAdapter,
        RuntimeStatusJsonAdapter,
        StreamJsonAdapter,
        WatchTargetJsonAdapter,
    )

OUTPUT_DIR = "/recordings"
POLL_INTERVAL = 60  # seconds
CHECK_TIMEOUT = 20  # seconds for the streamlink probe not to freeze the loop


def _get_module_dir():
    """Get the directory containing this worker module."""
    return pathlib.Path(__file__).parent.resolve()


def _get_default_config_dir():
    """Default config directory based on module location."""
    return str(_get_module_dir() / "config")


def _is_non_empty(val: Optional[str]) -> bool:
    """Check if value is non-empty when trimmed."""
    return val is not None and val.strip() != ""


def _get_env_int(name: str, default: int) -> int:
    """Read an integer environment variable with a default fallback.

    Args:
        name: Environment variable name.
        default: Default value when env var is absent, empty, or whitespace.

    Returns:
        The integer value from env or the default.

    Raises:
        ValueError: If the env var is set but not a valid integer.
    """
    raw = os.environ.get(name)
    if not _is_non_empty(raw):
        return default
    try:
        return int(raw.strip())
    except ValueError:
        raise ValueError(
            f"Environment variable {name} must be an integer, got: {raw!r}"
        )


def _resolve_output_dir() -> str:
    """Resolve OUTPUT_DIR from environment or default."""
    raw = os.environ.get("OUTPUT_DIR")
    return raw.strip() if _is_non_empty(raw) else "/recordings"


# Resolve runtime configuration from environment at module load time
OUTPUT_DIR = _resolve_output_dir()
POLL_INTERVAL = _get_env_int("POLL_INTERVAL", 60)


def _resolve_all_paths(
    env: Optional[dict] = None,
) -> dict:
    """Resolve all four config paths from an explicit env mapping.

    Precedence for each path:
      1. NON-EMPTY individual env var > NON-EMPTY CONFIG_DIR + filename > module-relative default

    Args:
        env: Explicit environment variable mapping. Defaults to os.environ.

    Returns:
        dict with keys: watchlist, channels_status, sessions, streams
    """
    if env is None:
        env = os.environ

    # Extract overrides from env
    watchlist_override = env.get("WATCHLIST_PATH")
    channels_status_override = env.get("CHANNELS_STATUS_PATH")
    sessions_override = env.get("SESSIONS_PATH")
    streams_override = env.get("STREAMS_PATH")
    config_dir_override = env.get("CONFIG_DIR")

    # Level 2: non-empty CONFIG_DIR
    config_dir = _is_non_empty(config_dir_override) and config_dir_override.strip() or None

    # Level 3: module-relative default
    default_dir = _get_default_config_dir()

    def resolve_single(filename: str, override: Optional[str]) -> str:
        # Level 1: non-empty individual override wins
        if _is_non_empty(override):
            return override.strip()
        # Level 2: non-empty CONFIG_DIR + filename
        if config_dir:
            # Normalize separators for cross-platform consistency
            normalized_config_dir = config_dir.replace("\\", "/")
            return normalized_config_dir + "/" + filename
        # Level 3: module-relative default
        return str(pathlib.Path(default_dir) / filename)

    return {
        "watchlist": resolve_single("watchlist.json", watchlist_override),
        "channels_status": resolve_single("channels_status.json", channels_status_override),
        "sessions": resolve_single("sessions.json", sessions_override),
        "streams": resolve_single("streams.json", streams_override),
    }


# Initialize module-level paths using current env
_initial_paths = _resolve_all_paths()
CONFIG_PATH = _initial_paths["watchlist"]
CHANNELS_STATUS_PATH = _initial_paths["channels_status"]
SESSIONS_PATH = _initial_paths["sessions"]
STREAMS_PATH = _initial_paths["streams"]


def initialize_runtime_files(paths: dict) -> None:
    """Initialize runtime files from resolved paths.

    Creates each dirname(path) recursively and exclusive-creates missing files
    with canonical JSON shapes. Never overwrites existing files.

    Args:
        paths: Pre-resolved config file paths dict with keys: watchlist, channels_status, sessions, streams

    Raises:
        OSError: If a file cannot be created (parent dir creation failure, etc.)
    """
    # Canonical shapes for each file
    canonical_shapes = {
        "watchlist": [],
        "channels_status": {},
        "sessions": [],
        "streams": [],
    }

    for key in ("watchlist", "channels_status", "sessions", "streams"):
        file_path_str = paths[key]
        file_path = pathlib.Path(file_path_str)
        parent_dir = file_path.parent

        # Create parent directory recursively
        parent_dir.mkdir(parents=True, exist_ok=True)

        # Exclusive-create missing file (skip if already exists)
        try:
            with open(file_path, "x", encoding="utf-8") as f:
                json.dump(canonical_shapes[key], f, indent=2)
        except FileExistsError:
            # File already exists - this is fine, skip
            pass


def ensure_runtime_dirs() -> None:
    """Ensure OUTPUT_DIR and all four config paths are initialized at startup.

    Call this once before entering the main loop.

    Raises:
        OSError: If OUTPUT_DIR or config files cannot be created
    """
    # Initialize OUTPUT_DIR
    pathlib.Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    log.info("Output directory ready: %s", OUTPUT_DIR)

    # Get config directory and paths
    paths = _resolve_all_paths()
    config_dir = paths["watchlist"].rsplit("/", 1)[0]

    # Initialize all four config files
    initialize_runtime_files(paths)
    log.info("Config directory initialized: %s", config_dir)
    log.info("  watchlist: %s", paths["watchlist"])
    log.info("  channels_status: %s", paths["channels_status"])
    log.info("  sessions: %s", paths["sessions"])
    log.info("  streams: %s", paths["streams"])


def normalize_recording_subdir(input_str: str) -> str | None:
    """
    Normalize a recording_subdir input value.

    Returns:
        - Normalized path string for valid input
        - None for invalid input (reject, do not fallback silently)

    Security rules applied BEFORE normalization:
    1. Reject null bytes and control characters
    2. Reject absolute paths (leading / or \\)
    3. Reject Windows drive letters (^[A-Za-z]:)
    4. Reject UNC paths (starting with \\\\)
    5. Reject traversal segments (., ..) in raw input

    Then normalize:
    - Convert separators to forward slash
    - Collapse multiple consecutive slashes
    - Remove leading/trailing slashes
    - Max length 255
    """
    if not input_str:
        return None

    # Step 1: Reject null bytes and control characters in raw input (0x00-0x1f, 0x7f)
    for c in input_str:
        if ord(c) < 32 or ord(c) == 127:
            return None

    # Step 2: Check raw trimmed input for dangerous patterns
    trimmed = input_str.strip()
    if not trimmed:
        return None

    # Reject absolute paths BEFORE stripping
    if trimmed.startswith("/") or trimmed.startswith("\\"):
        return None
    # Windows drive letter
    if len(trimmed) >= 2 and trimmed[1] == ":" and trimmed[0].isalpha():
        return None
    # UNC path
    if trimmed.startswith("\\\\"):
        return None

    # Check for traversal in raw segments
    segments = trimmed.split("/")
    for seg in segments:
        # Also check backslash-split segments
        for part in seg.split("\\"):
            if part == ".." or part == ".":
                return None

    # Step 3: Normalize
    normalized = trimmed.replace("\\", "/")
    # Collapse multiple slashes
    while "//" in normalized:
        normalized = normalized.replace("//", "/")
    # Remove leading/trailing slashes
    normalized = normalized.strip("/")

    # Step 4: Final validation
    if not normalized:
        return None

    # Check for remaining dangerous patterns after normalization
    if ".." in normalized or "." in normalized:
        return None

    # Step 5: Length check
    if len(normalized) > 255:
        return None

    return normalized


def is_valid_recording_subdir(input_str: str) -> bool:
    """
    Validate recording_subdir strictly.
    Returns True for valid normalized values or empty (legacy fallback).
    """
    if not input_str:
        return True
    result = normalize_recording_subdir(input_str)
    return result is not None and result == input_str


def resolve_output_dir(entry: dict, output_base: str) -> pathlib.Path:
    """
    Resolve the output directory for a recording.

    If entry has a valid non-empty recording_subdir:
        output_dir = output_base / recording_subdir
    Otherwise:
        output_dir = output_base / sanitize(channel_name)

    Security: Validates the resolved path stays within output_base.
    Raises ValueError for invalid custom paths.
    """
    recording_subdir = entry.get("recording_subdir")

    if "recording_subdir" in entry:
        # Field is present - must have a valid normalized value
        if recording_subdir:
            # Non-empty value provided - normalize and validate
            normalized = normalize_recording_subdir(recording_subdir)
            if normalized:
                candidate = pathlib.Path(output_base) / normalized
                try:
                    # Resolve to absolute for strict containment check
                    resolved = candidate.resolve()
                    base_resolved = pathlib.Path(output_base).resolve()
                    # Verify strict containment
                    resolved.relative_to(base_resolved)
                    return candidate
                except (ValueError, OSError):
                    # Not contained or resolution failed - reject explicitly
                    raise ValueError(
                        f"Invalid recording_subdir '{recording_subdir}': must be a relative path"
                    )
            else:
                # Value present but failed normalization - raise, do not fallback
                raise ValueError(
                    f"Invalid recording_subdir '{recording_subdir}': must be a relative path"
                )
        # Empty/whitespace value - use legacy fallback

    # Legacy fallback: use sanitized channel name
    channel_name = str(entry.get("channel_name") or "unknown-channel")
    safe_name = sanitize(channel_name)
    return pathlib.Path(output_base) / safe_name


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("worker")

active_recordings = (
    {}
)  # watch_target_id -> {process, output_file, started_at, channel_name, url, platform, session_id(current), stream_id}
channels_status = (
    {}
)  # watch_target_id -> { channel_name, platform, state(idle, offline, recording, finished, error)}
recordings = (
    []
)  # session_id -> {watch_target_id, started_at, finished_at, output_file, state}
streams_data = (
    []
)  # Array<Stream> - actual detected live broadcast occurrences
lock = threading.Lock()


def load_watchlist():
    return WatchTargetJsonAdapter.read(CONFIG_PATH)


def load_channels_status():
    return RuntimeStatusJsonAdapter.read(CHANNELS_STATUS_PATH)


def load_sessions():
    return RecordingJsonAdapter.read(SESSIONS_PATH)


def deserialize_session(session: dict) -> dict:
    return RecordingJsonAdapter.to_domain(session)


def serialize_recording(recording: dict) -> dict:
    return RecordingJsonAdapter.from_domain(recording)


def save_status():
    RuntimeStatusJsonAdapter.write(CHANNELS_STATUS_PATH, channels_status)


def load_recordings():
    return load_sessions()


def save_recordings():
    RecordingJsonAdapter.write(SESSIONS_PATH, recordings)


def load_streams():
    return StreamJsonAdapter.read(STREAMS_PATH)


def save_streams():
    StreamJsonAdapter.write(STREAMS_PATH, streams_data)


def find_active_stream(watch_target_id: str):
    """Find the active (not finalized) stream for a watch target."""
    for stream in streams_data:
        if stream.get("watch_target_id") == watch_target_id and stream.get("finished_at") is None:
            return stream
    return None


def create_stream(watch_target_id: str) -> dict:
    """Create a new stream for a watch target with started_at timestamp."""
    stream = {
        "id": str(uuid.uuid4()),
        "watch_target_id": watch_target_id,
        "state": "recording",
        "started_at": datetime.now().isoformat(),
        "finished_at": None,
    }
    streams_data.append(stream)
    save_streams()
    return stream


def finalize_stream(watch_target_id: str):
    """Finalize the active stream for a watch target if no recording is active."""
    if watch_target_id in active_recordings:
        return None
    stream = find_active_stream(watch_target_id)
    if stream:
        stream["finished_at"] = datetime.now().isoformat()
        stream["state"] = "finished"
        save_streams()
    return stream


def reload_streams_preserving_active():
    """Reload streams from disk, preserving all in-memory streams.

    In-memory streams (active or recently finalized) are always kept so that
    poll_loop does not lose stream state between iterations.  Disk streams
    that are not yet in memory are merged in (worker restart scenario).
    """
    global streams_data

    # Capture IDs of all streams currently in memory
    in_memory_ids = {s["id"] for s in streams_data}

    loaded_streams = load_streams()

    # Keep every in-memory stream; add disk-only streams that are finished
    # (active disk streams would already be in active_recordings and thus in memory)
    streams_data = list(streams_data) + [
        s for s in loaded_streams
        if s.get("id") not in in_memory_ids
    ]


def reload_recordings_preserving_active():
    global recordings

    loaded_recordings = load_recordings()
    active_recording_ids = {info["session_id"] for info in active_recordings.values()}
    active_recordings_in_memory = [
        recording
        for recording in recordings
        if recording["session_id"] in active_recording_ids
    ]
    recordings = [
        recording
        for recording in loaded_recordings
        if recording["session_id"] not in active_recording_ids
    ]
    recordings.extend(active_recordings_in_memory)


def preserve_active_channel_status():
    """Ensure every active recording has a channels_status entry.

    Uses available info from active_recordings, falling back to existing
    channels_status data or sensible defaults so that tests with minimal
    active_recordings entries (e.g. process/session_id/stream_id only)
    do not raise KeyError.
    """
    for channel_id, info in active_recordings.items():
        existing = channels_status.get(channel_id, {})
        status = channels_status.setdefault(
            channel_id,
            {
                "channel_name": info.get("channel_name") or existing.get("channel_name") or channel_id,
                "platform": info.get("platform") or existing.get("platform") or "unknown",
                "state": "recording",
            },
        )
        status["state"] = "recording"


def reload_channels_status_preserving_active():
    global channels_status

    loaded_status = load_channels_status()
    channels_status = loaded_status
    preserve_active_channel_status()


def sanitize(s: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in s)


def is_live(url: str) -> bool:
    """Uses Streamlink as a probe: if it finds available streams
    for the URL, considers the live online. Works for Twitch/YouTube/
    Kick without needing API credentials."""
    try:
        result = subprocess.run(
            ["streamlink", "--json", url],
            capture_output=True,
            text=True,
            timeout=CHECK_TIMEOUT,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return False
        data = json.loads(result.stdout)
        return bool(data.get("streams"))
    except Exception as e:
        log.warning("Error checking status of %s: %s", url, e)
        return False


def start_recording(entry: dict, stream_id: str | None = None):
    global active_recordings, channels_status, recordings, lock

    url = entry["url"]
    quality = entry.get("quality", "best")
    platform = entry.get("platform", "unknown")
    channel_name = str(entry.get("channel_name") or "unknown-channel")
    watch_target_id = entry.get("id")
    if not isinstance(watch_target_id, str):
        raise ValueError("Watch target id is required to start a recording")
    session_id = str(uuid.uuid4())

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = sanitize(channel_name)

    # Resolve output directory: custom subdir or legacy fallback
    out_dir = resolve_output_dir(entry, OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{safe_name}_{session_id}_{timestamp}.mp4"

    cmd = [
        "streamlink",
        "--hls-live-restart",
        "--retry-streams",
        "10",
        "--retry-max",
        "3",
        url,
        quality,
        "-o",
        str(out_path),
    ]

    log.info("[%s] Live detected! Recording to %s", channel_name, out_path)
    process = subprocess.Popen(
        cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True
    )

    started_at = datetime.now().isoformat()
    with lock:
        active_recordings[watch_target_id] = {
            "process": process,
            "output_file": str(out_path),
            "started_at": started_at,
            "channel_name": channel_name,
            "platform": platform,
            "url": url,
            "session_id": session_id,
            "stream_id": stream_id,
        }

        channels_status[watch_target_id]["state"] = "recording"

        recording_entry = {
            "session_id": session_id,
            "watch_target_id": watch_target_id,
            "started_at": started_at,
            "finished_at": None,
            "output_file": str(out_path),
            "state": "recording",
        }
        if stream_id:
            recording_entry["stream_id"] = stream_id
        recordings.append(recording_entry)

        save_status()
        save_recordings()

    threading.Thread(
        target=monitor_recording, args=(watch_target_id,), daemon=True
    ).start()


def drain_stderr(process, channel_name):
    """Drain stderr continuously in the calling thread without a separate reader thread.

    Logs non-empty Streamlink output lines without logging URLs or credentials.
    """
    try:
        if process.stderr is None:
            return
        while True:
            line = process.stderr.readline()
            if not line:
                break
            stripped = line.rstrip("\r\n")
            if stripped:
                log.info("[%s] [streamlink] %s", channel_name, stripped)
    except Exception:
        pass  # Process may have ended; stderr is closed


def monitor_recording(id: str):
    global active_recordings, channels_status, recordings, lock

    with lock:
        proc = active_recordings[id]["process"]
        channel_name = active_recordings[id]["channel_name"]

    # Drain stderr in this thread before waiting for process
    drain_stderr(proc, channel_name)
    proc.wait()

    with lock:
        info = active_recordings.pop(id, None)

        if not info:
            return

        finished_at = datetime.now().isoformat()

        output_file = info["output_file"]

        ok = (
            proc.returncode == 0
            and os.path.exists(output_file)
            and os.path.getsize(output_file) > 0
        )

        recording_index = next(
            (
                i
                for i, recording in enumerate(recordings)
                if recording["session_id"] == info["session_id"]
            ),
            None,
        )

        if recording_index is None:
            log.warning("Open session not found for channel %s", id)
            return

        channels_status[id]["state"] = "finished" if ok else "error"

        recordings[recording_index]["state"] = "finished" if ok else "error"

        recordings[recording_index]["finished_at"] = finished_at

        recordings[recording_index]["output_file"] = output_file

        save_status()

        save_recordings()

    log.info(
        "[%s] Recording finished (%s) -> %s",
        info["channel_name"],
        channels_status[id]["state"],
        info["output_file"],
    )


def poll_loop():
    global active_recordings, channels_status, recordings, streams_data, lock

    while True:
        # load channels_status, watchlist and sessions
        try:
            with lock:
                reload_channels_status_preserving_active()
        except FileNotFoundError:
            log.warning(
                "Missing channels_status at %s. Waiting...",
                CHANNELS_STATUS_PATH,
            )
            with lock:
                preserve_active_channel_status()
        except Exception as e:
            log.error("Failed to read channels_status: %s", e)
            with lock:
                preserve_active_channel_status()

        try:
            watchlist = load_watchlist()
        except FileNotFoundError:
            log.warning("Missing watchlist at %s. Waiting...", CONFIG_PATH)
            watchlist = []
        except Exception as e:
            log.error("Failed to read watchlist: %s", e)
            watchlist = []

        try:
            with lock:
                reload_recordings_preserving_active()
        except FileNotFoundError:
            log.warning("Missing sessions at %s. Waiting...", SESSIONS_PATH)
        except Exception as e:
            log.error("Failed to read sessions: %s", e)

        try:
            with lock:
                reload_streams_preserving_active()
        except Exception as e:
            log.error("Failed to read streams: %s", e)

        try:
            watchlist_lastmodified = os.path.getmtime(CONFIG_PATH)
        except FileNotFoundError:
            watchlist_lastmodified = None

        for entry in watchlist:
            url = entry.get("url")
            channel_name = entry.get("channel_name")
            id = entry.get("id")
            platform = entry.get("platform")

            if url is None or channel_name is None or id is None or platform is None:
                log.warning("Invalid watchlist entry: %s", entry)
                continue

            try:
                with lock:
                    if id in active_recordings:
                        continue
                    channels_status.setdefault(
                        id,
                        {
                            "channel_name": channel_name,
                            "platform": platform,
                            "state": "idle",
                        },
                    )

                log.info("[%s] Checking status...", channel_name)

                if is_live(url):
                    stream_id = None
                    with lock:
                        active_stream = find_active_stream(id)
                        if active_stream:
                            stream_id = active_stream["id"]
                        else:
                            new_stream = create_stream(id)
                            stream_id = new_stream["id"]
                    start_recording(entry, stream_id)
                else:
                    with lock:
                        channels_status[id]["state"] = "offline"
                        finalize_stream(id)
                    save_status()
            except Exception as e:
                log.warning("Error checking channel status %s: %s", channel_name, e)
                continue

            try:
                new_watchlist_lastmodified = os.path.getmtime(CONFIG_PATH)
                if (
                    watchlist_lastmodified is None
                    or new_watchlist_lastmodified > watchlist_lastmodified
                ):
                    watchlist_lastmodified = new_watchlist_lastmodified

                    watchlist = load_watchlist()
                    continue
            except Exception as e:
                log.warning("Error checking watchlist: %s", e)
                continue

        time.sleep(POLL_INTERVAL)


def _wait_for_process(proc, timeout_sec=5):
    """Wait for a process with timeout, using kill as fallback if needed.

    Tolerates processes that have already exited (ProcessLookupError,
    PermissionError, and other process-lifecycle errors).
    """
    try:
        proc.wait(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            log.warning("Process did not terminate after kill; forcibly exiting.")
        except (OSError, AttributeError):
            log.warning("Process already exited during kill/wait; skipping.")
    except (OSError, AttributeError):
        log.warning("Process already exited during wait; skipping.")


def handle_shutdown(signum, frame):
    log.info("Shutting down worker... finishing ongoing recordings.")

    with lock:
        # Snapshot active processes before terminating
        active_procs = [
            (channel_id, info)
            for channel_id, info in active_recordings.items()
        ]

        finished_at = datetime.now().isoformat()

        for channel_id, info in active_procs:
            proc = info["process"]
            try:
                proc.terminate()
            except OSError:
                log.warning(
                    "Process for channel %s already exited during terminate; skipping.",
                    channel_id,
                )
                continue
            channels_status[channel_id]["state"] = "error"
            for recording in recordings:
                if recording["session_id"] == info["session_id"]:
                    recording["state"] = "error"
                    recording["finished_at"] = finished_at
                    break

        save_status()
        save_recordings()

    # Wait for all processes outside the lock to avoid deadlocks
    for channel_id, info in active_procs:
        _wait_for_process(info["process"])

    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)
    # Initialize runtime directories before entering the main loop
    ensure_runtime_dirs()
    log.info("Worker started. Poll interval: %ss", POLL_INTERVAL)
    poll_loop()
