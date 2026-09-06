import json
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

worker_spec = importlib.util.spec_from_file_location(
    "worker_module", Path(__file__).with_name("worker.py")
)
worker = importlib.util.module_from_spec(worker_spec)
worker_spec.loader.exec_module(worker)


class FakeProcess:
    def __init__(self, returncode=0):
        self.returncode = returncode

    def wait(self):
        return self.returncode

    def terminate(self):
        self.returncode = -15


class WorkerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        config_dir = Path(self.temp_dir.name)
        worker.CHANNELS_STATUS_PATH = str(config_dir / "channels_status.json")
        worker.SESSIONS_PATH = str(config_dir / "sessions.json")
        worker.OUTPUT_DIR = str(config_dir / "recordings")
        worker.channels_status = {}
        worker.sessions = []
        worker.active_recordings = {}
        worker.lock = worker.threading.Lock()
        Path(worker.CHANNELS_STATUS_PATH).write_text("{}", encoding="utf-8")
        Path(worker.SESSIONS_PATH).write_text("[]", encoding="utf-8")
        self.watchlist_path = config_dir / "watchlist.json"
        self.watchlist_path.write_text("[]", encoding="utf-8")
        worker.CONFIG_PATH = str(self.watchlist_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_start_recording_persists_recording_session_immediately(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
            "quality": "best",
        }
        process = FakeProcess()

        with patch.object(worker.subprocess, "Popen", return_value=process), patch.object(
            worker.threading, "Thread"
        ) as thread:
            worker.channels_status["channel-1"] = {
                "channel_name": "example",
                "platform": "twitch",
                "state": "idle",
            }
            worker.start_recording(entry)
            thread.assert_called_once()

        sessions = json.loads(Path(worker.SESSIONS_PATH).read_text(encoding="utf-8"))
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["channel_id"], "channel-1")
        self.assertEqual(sessions[0]["state"], "recording")

    def test_poll_reload_preserves_active_session(self):
        active_session = {
            "session_id": "session-1",
            "channel_id": "channel-1",
            "started_at": "2026-09-05T00:00:00",
            "finished_at": None,
            "output_file": "recording.mp4",
            "state": "recording",
        }
        worker.sessions = [active_session]
        worker.active_recordings = {"channel-1": {"session_id": "session-1"}}
        Path(worker.SESSIONS_PATH).write_text("[]", encoding="utf-8")

        with worker.lock:
            worker.reload_sessions_preserving_active()

        self.assertEqual(worker.sessions, [active_session])

    def test_monitor_updates_the_existing_session(self):
        output_file = Path(worker.OUTPUT_DIR) / "recording.mp4"
        output_file.parent.mkdir(parents=True)
        output_file.write_bytes(b"recorded")
        worker.channels_status = {
            "channel-1": {
                "channel_name": "example",
                "platform": "twitch",
                "state": "recording",
            }
        }
        worker.sessions = [
            {
                "session_id": "session-1",
                "channel_id": "channel-1",
                "started_at": "2026-09-05T00:00:00",
                "finished_at": None,
                "output_file": str(output_file),
                "state": "recording",
            }
        ]
        worker.active_recordings = {
            "channel-1": {
                "process": FakeProcess(),
                "output_file": str(output_file),
                "channel_name": "example",
                "session_id": "session-1",
            }
        }

        worker.monitor_recording("channel-1")

        self.assertEqual(len(worker.sessions), 1)
        self.assertEqual(worker.sessions[0]["session_id"], "session-1")
        self.assertEqual(worker.sessions[0]["state"], "finished")
        self.assertIsNotNone(worker.sessions[0]["finished_at"])

    def test_monitor_marks_the_existing_session_as_error_on_process_failure(self):
        worker.channels_status = {
            "channel-1": {
                "channel_name": "example",
                "platform": "twitch",
                "state": "recording",
            }
        }
        worker.sessions = [
            {
                "session_id": "session-1",
                "channel_id": "channel-1",
                "started_at": "2026-09-05T00:00:00",
                "finished_at": None,
                "output_file": "missing.mp4",
                "state": "recording",
            }
        ]
        worker.active_recordings = {
            "channel-1": {
                "process": FakeProcess(returncode=1),
                "output_file": "missing.mp4",
                "channel_name": "example",
                "session_id": "session-1",
            }
        }

        worker.monitor_recording("channel-1")

        self.assertEqual(worker.sessions[0]["state"], "error")
        self.assertIsNotNone(worker.sessions[0]["finished_at"])

    def test_offline_channel_does_not_start_a_recording(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
            "quality": "best",
        }
        worker.channels_status["channel-1"] = {
            "channel_name": "example",
            "platform": "twitch",
            "state": "idle",
        }
        worker_path = worker.CONFIG_PATH
        Path(worker_path).write_text(json.dumps([entry]), encoding="utf-8")

        with patch.object(worker, "is_live", return_value=False), patch.object(
            worker.subprocess, "Popen"
        ) as popen, patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        popen.assert_not_called()
        self.assertEqual(worker.sessions, [])
        self.assertEqual(worker.channels_status["channel-1"]["state"], "offline")

    def test_session_reload_failure_preserves_active_session_for_finalization(self):
        output_file = Path(worker.OUTPUT_DIR) / "recording.mp4"
        output_file.parent.mkdir(parents=True)
        output_file.write_bytes(b"recorded")
        session = {
            "session_id": "session-1",
            "channel_id": "channel-1",
            "started_at": "2026-09-05T00:00:00",
            "finished_at": None,
            "output_file": str(output_file),
            "state": "recording",
        }
        worker.sessions = [session]
        worker.channels_status = {
            "channel-1": {
                "channel_name": "example",
                "platform": "twitch",
                "state": "recording",
            }
        }
        worker.active_recordings = {
            "channel-1": {
                "session_id": "session-1",
                "process": FakeProcess(),
                "output_file": str(output_file),
                "channel_name": "example",
                "platform": "twitch",
            }
        }

        with patch.object(worker, "load_sessions", side_effect=OSError("temporary failure")):
            with worker.lock:
                try:
                    worker.reload_sessions_preserving_active()
                except OSError:
                    pass

        self.assertEqual(worker.sessions, [session])
        worker.monitor_recording("channel-1")
        self.assertEqual(worker.sessions[0]["state"], "finished")

    def test_active_channel_status_survives_reload_without_disk_entry(self):
        worker.channels_status = {}
        worker.active_recordings = {
            "channel-1": {
                "session_id": "session-1",
                "channel_name": "example",
                "platform": "twitch",
            }
        }

        with patch.object(worker, "load_channels_status", return_value={}):
            with worker.lock:
                worker.reload_channels_status_preserving_active()

        self.assertEqual(
            worker.channels_status["channel-1"],
            {
                "channel_name": "example",
                "platform": "twitch",
                "state": "recording",
            },
        )

    def test_shutdown_finalizes_active_session_and_persists_error(self):
        session = {
            "session_id": "session-1",
            "channel_id": "channel-1",
            "started_at": "2026-09-05T00:00:00",
            "finished_at": None,
            "output_file": "recording.mp4",
            "state": "recording",
        }
        process = FakeProcess()
        worker.sessions = [session]
        worker.channels_status = {
            "channel-1": {
                "channel_name": "example",
                "platform": "twitch",
                "state": "recording",
            }
        }
        worker.active_recordings = {
            "channel-1": {
                "session_id": "session-1",
                "process": process,
                "channel_name": "example",
                "platform": "twitch",
            }
        }

        with self.assertRaises(SystemExit):
            worker.handle_shutdown(None, None)

        self.assertEqual(process.returncode, -15)
        self.assertEqual(session["state"], "error")
        self.assertIsNotNone(session["finished_at"])
        persisted_sessions = json.loads(
            Path(worker.SESSIONS_PATH).read_text(encoding="utf-8")
        )
        self.assertEqual(persisted_sessions[0]["state"], "error")


if __name__ == "__main__":
    unittest.main()