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

CONFIG_PATH = os.environ.get("WATCHLIST_PATH", "/app/config/watchlist.json")
CHANNELS_STATUS_PATH = os.environ.get(
    "CHANNELS_STATUS_PATH", "/app/config/channels_status.json"
)
SESSIONS_PATH = os.environ.get("SESSIONS_PATH", "/app/config/sessions.json")
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
)  # watch_target_id -> {process, output_file, started_at, channel_name, url, platform, session_id(current)}
channels_status = (
    {}
)  # watch_target_id -> { channel_name, platform, state(idle, offline, recording, finished, error)}
recordings = (
    []
)  # session_id -> {watch_target_id, started_at, finished_at, output_file, state}
lock = threading.Lock()


def load_watchlist():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_channels_status():
    with open(CHANNELS_STATUS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_sessions():
    with open(SESSIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def deserialize_session(session: dict) -> dict:
    recording = dict(session)
    recording["watch_target_id"] = recording.pop("channel_id")
    return recording


def serialize_recording(recording: dict) -> dict:
    session = dict(recording)
    session["channel_id"] = session.pop("watch_target_id")
    return session


def save_status():
    with open(CHANNELS_STATUS_PATH, "w", encoding="utf-8") as f:
        json.dump(channels_status, f, ensure_ascii=False, indent=2, default=str)


def load_recordings():
    return [deserialize_session(session) for session in load_sessions()]


def save_recordings():
    with open(SESSIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(
            [serialize_recording(recording) for recording in recordings],
            f,
            ensure_ascii=False,
            indent=2,
            default=str,
        )


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
    for channel_id, info in active_recordings.items():
        status = channels_status.setdefault(
            channel_id,
            {
                "channel_name": info["channel_name"],
                "platform": info["platform"],
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


def start_recording(entry: dict):
    global active_recordings, channels_status, recordings, lock

    url = entry["url"]
    quality = entry.get("quality", "best")
    platform = entry.get("platform", "unknown")
    channel_name = str(entry.get("channel_name") or "unknown-channel")
    watch_target_id = entry.get("id")
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
        }

        channels_status[watch_target_id]["state"] = "recording"

        recordings.append(
            {
                "session_id": session_id,
                "watch_target_id": watch_target_id,
                "started_at": started_at,
                "finished_at": None,
                "output_file": str(out_path),
                "state": "recording",
            }
        )

        save_status()
        save_recordings()

    threading.Thread(
        target=monitor_recording, args=(watch_target_id,), daemon=True
    ).start()


def monitor_recording(id: str):
    global active_recordings, channels_status, recordings, lock

    with lock:
        proc = active_recordings[id]["process"]
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

        finished_stream = next(
            (
                i
                for i, recording in enumerate(recordings)
                if recording["session_id"] == info["session_id"]
            ),
            None,
        )

        if finished_stream is None:
            log.warning("Sessão em aberto não encontrada para o canal %s", id)
            return

        channels_status[id]["state"] = "finished" if ok else "error"

        recordings[finished_stream]["state"] = "finished" if ok else "error"

        recordings[finished_stream]["finished_at"] = finished_at

        recordings[finished_stream]["output_file"] = output_file

        save_status()

        save_recordings()

    log.info(
        "[%s] Gravação finalizada (%s) -> %s",
        info["channel_name"],
        channels_status[id]["state"],
        info["output_file"],
    )


def poll_loop():
    global active_recordings, channels_status, recordings, lock

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

        watchlist_lastmodified = os.path.getmtime(CONFIG_PATH)

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
                    start_recording(entry)
                else:
                    with lock:
                        channels_status[id]["state"] = "offline"
                    save_status()
            except Exception as e:
                log.warning("Erro ao verificar status do canal %s: %s", channel_name, e)
                continue

            try:
                new_watchlist_lastmodified = os.path.getmtime(CONFIG_PATH)
                if new_watchlist_lastmodified > watchlist_lastmodified:
                    watchlist_lastmodified = new_watchlist_lastmodified

                    watchlist = load_watchlist()
                    continue
            except Exception as e:
                log.warning("Erro ao verificar watchlist: %s", e)
                continue

        time.sleep(POLL_INTERVAL)


def handle_shutdown(signum, frame):
    log.info("Encerrando worker... finalizando gravações em andamento.")

    with lock:
        finished_at = datetime.now().isoformat()
        for channel_id, info in active_recordings.items():
            info["process"].terminate()
            channels_status[channel_id]["state"] = "error"
            for recording in recordings:
                if recording["session_id"] == info["session_id"]:
                    recording["state"] = "error"
                    recording["finished_at"] = finished_at
                    break
        save_status()
        save_recordings()
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)
    log.info("Worker iniciado. Poll interval: %ss", POLL_INTERVAL)
    poll_loop()
