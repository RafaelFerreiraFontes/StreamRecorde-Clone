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
)  # channel_id -> {process, output_file, started_at, channel_name, url, platform, session_id(current)}
channels_status = (
    {}
)  # channel_id -> { channel_name, platform, state(idle, offline, recording, finished, error)}
sessions = []  # session_id -> {channel_id, started_at, finished_at, output_file, state}
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


def save_status():
    with open(CHANNELS_STATUS_PATH, "w", encoding="utf-8") as f:
        json.dump(channels_status, f, ensure_ascii=False, indent=2, default=str)


def save_sessions():
    with open(SESSIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(sessions, f, ensure_ascii=False, indent=2, default=str)


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
    global active_recordings, channels_status, sessions, lock

    url = entry["url"]
    quality = entry.get("quality", "best")
    platform = entry.get("platform", "unknown")
    channel_name = entry.get("channel_name")
    id = entry.get("id")
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
        active_recordings[id] = {
            "process": process,
            "output_file": str(out_path),
            "started_at": started_at,
            "channel_name": channel_name,
            "platform": platform,
            "url": url,
            "session_id": session_id,
        }

        channels_status[id]["state"] = "recording"

        sessions.append(
            {
                "session_id": session_id,
                "channel_id": id,
                "started_at": started_at,
                "finished_at": None,
                "output_file": str(out_path),
                "state": "recording",
            }
        )

        save_status()

    threading.Thread(target=monitor_recording, args=(id,), daemon=True).start()


def monitor_recording(id: str):
    global active_recordings, channels_status, sessions, lock

    with lock:
        proc = active_recordings[id]["process"]
    proc.wait()

    with lock:
        info = active_recordings.pop(id, None)

        if not info:
            return

        finished_at = datetime.now().isoformat()

        output_file = info["output_file"]

        ok = os.path.exists(output_file) and os.path.getsize(output_file) > 0

        finished_stream = next(
            (
                i
                for i, s in enumerate(sessions)
                if s["channel_id"] == id and s["finished_at"] is None
            ),
            None,
        )

        if finished_stream is None:
            log.warning("Sessão em aberto não encontrada para o canal %s", id)
            return

        channels_status[id]["state"] = "finished" if ok else "error"

        sessions[finished_stream]["state"] = "finished" if ok else "error"

        sessions[finished_stream]["finished_at"] = finished_at

        sessions[finished_stream]["output_file"] = output_file

        save_status()

        save_sessions()

    log.info(
        "[%s] Gravação finalizada (%s) -> %s",
        info["channel_name"],
        channels_status[id]["state"],
        info["output_file"],
    )


def poll_loop():
    global active_recordings, channels_status, sessions, lock

    while True:
        # load channels_status, watchlist and sessions
        try:
            channels_status = load_channels_status()
        except FileNotFoundError:
            log.warning(
                "Channels status não encontrado em %s. Aguardando...",
                CHANNELS_STATUS_PATH,
            )
            channels_status = {}
        except Exception as e:
            log.error("Erro ao ler channels status: %s", e)
            channels_status = {}

        try:
            watchlist = load_watchlist()
        except FileNotFoundError:
            log.warning("Watchlist não encontrada em %s. Aguardando...", CONFIG_PATH)
            watchlist = []
        except Exception as e:
            log.error("Erro ao ler watchlist: %s", e)
            watchlist = []

        try:
            sessions = load_sessions()
        except FileNotFoundError:
            log.warning("Sessões não encontradas em %s. Aguardando...", SESSIONS_PATH)
            sessions = []
        except Exception as e:
            log.error("Erro ao ler sessões: %s", e)
            sessions = []

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

        time.sleep(POLL_INTERVAL)


def handle_shutdown(signum, frame):
    log.info("Encerrando worker... finalizando gravações em andamento.")

    with lock:
        for info in active_recordings.values():
            info["process"].terminate()
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)
    log.info("Worker iniciado. Poll interval: %ss", POLL_INTERVAL)
    poll_loop()
