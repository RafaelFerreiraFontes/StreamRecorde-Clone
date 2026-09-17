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

CONFIG_PATH = os.environ.get("WATCHLIST_PATH", "/app/config/watchlist.json")
CHANNELS_STATUS_PATH = os.environ.get(
    "CHANNELS_STATUS_PATH", "/app/config/channels_status.json"
)
SESSIONS_PATH = os.environ.get("SESSIONS_PATH", "/app/config/sessions.json")
STREAMS_PATH = os.environ.get("STREAMS_PATH", "/app/config/streams.json")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/recordings")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "60"))  # seconds
CHECK_TIMEOUT = 20  # seconds for the streamlink probe not to freeze the loop

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
        log.warning("Erro ao checar status de %s: %s", url, e)
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
    out_dir = pathlib.Path(OUTPUT_DIR) / safe_name
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

    log.info("[%s] Live detectada! Gravando em %s", channel_name, out_path)
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
            log.warning("Sessão em aberto não encontrada para o canal %s", id)
            return

        channels_status[id]["state"] = "finished" if ok else "error"

        recordings[recording_index]["state"] = "finished" if ok else "error"

        recordings[recording_index]["finished_at"] = finished_at

        recordings[recording_index]["output_file"] = output_file

        save_status()

        save_recordings()

    log.info(
        "[%s] Gravação finalizada (%s) -> %s",
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
                "Channels status não encontrado em %s. Aguardando...",
                CHANNELS_STATUS_PATH,
            )
            with lock:
                preserve_active_channel_status()
        except Exception as e:
            log.error("Erro ao ler channels status: %s", e)
            with lock:
                preserve_active_channel_status()

        try:
            watchlist = load_watchlist()
        except FileNotFoundError:
            log.warning("Watchlist não encontrada em %s. Aguardando...", CONFIG_PATH)
            watchlist = []
        except Exception as e:
            log.error("Erro ao ler watchlist: %s", e)
            watchlist = []

        try:
            with lock:
                reload_recordings_preserving_active()
        except FileNotFoundError:
            log.warning("Sessões não encontradas em %s. Aguardando...", SESSIONS_PATH)
        except Exception as e:
            log.error("Erro ao ler sessões: %s", e)

        try:
            with lock:
                reload_streams_preserving_active()
        except Exception as e:
            log.error("Erro ao ler streams: %s", e)

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
                log.warning("Entrada inválida na watchlist: %s", entry)
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

                log.info("[%s] Verificando status...", channel_name)

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
                log.warning("Erro ao verificar status do canal %s: %s", channel_name, e)
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
                log.warning("Erro ao verificar watchlist: %s", e)
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
    log.info("Encerrando worker... finalizando gravações em andamento.")

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
    log.info("Worker iniciado. Poll interval: %ss", POLL_INTERVAL)
    poll_loop()
