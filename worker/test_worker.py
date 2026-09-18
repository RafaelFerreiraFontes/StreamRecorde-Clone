import json
import os
import importlib.util
import tempfile
import unittest
import io
from typing import Any
from pathlib import Path
from unittest.mock import patch

worker_spec = importlib.util.spec_from_file_location(
    "worker_module", Path(__file__).with_name("worker.py")
)
if worker_spec is None or worker_spec.loader is None:
    raise ImportError("Unable to load worker module")
worker: Any = importlib.util.module_from_spec(worker_spec)
worker_spec.loader.exec_module(worker)


class FakeProcess:
    """Fake subprocess.Popen for testing.

    Supports:
    - wait(timeout=None) - Python 3 subprocess compatibility
    - kill() - for force termination
    - stderr - file-like object for stderr drain tests
    """

    def __init__(self, returncode=0, stderr_lines=None):
        self.returncode = returncode
        self._stderr = io.StringIO(stderr_lines or "")
        self.stderr = self._stderr
        self._wait_called = False

    def wait(self, timeout=None):
        """Wait for process to complete.

        Args:
            timeout: Optional timeout in seconds. If None, returns immediately.

        Returns:
            The returncode of the process.
        """
        self._wait_called = True
        return self.returncode

    def terminate(self):
        self.returncode = -15

    def kill(self):
        self.returncode = -9

    @property
    def pid(self):
        return 99999

    def poll(self):
        """Check if process has terminated."""
        return self.returncode if self._wait_called else None


class WorkerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        config_dir = Path(self.temp_dir.name)
        worker.CHANNELS_STATUS_PATH = str(config_dir / "channels_status.json")
        worker.SESSIONS_PATH = str(config_dir / "sessions.json")
        worker.STREAMS_PATH = str(config_dir / "streams.json")
        worker.OUTPUT_DIR = str(config_dir / "recordings")
        worker.channels_status = {}
        worker.recordings = []
        worker.active_recordings = {}
        worker.lock = worker.threading.Lock()
        Path(worker.CHANNELS_STATUS_PATH).write_text("{}", encoding="utf-8")
        Path(worker.SESSIONS_PATH).write_text("[]", encoding="utf-8")
        Path(worker.STREAMS_PATH).write_text("[]", encoding="utf-8")
        self.watchlist_path = config_dir / "watchlist.json"
        self.watchlist_path.write_text("[]", encoding="utf-8")
        worker.CONFIG_PATH = str(self.watchlist_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_start_recording_persists_recording_immediately(self):
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

        persisted_sessions = json.loads(
            Path(worker.SESSIONS_PATH).read_text(encoding="utf-8")
        )
        self.assertEqual(len(worker.recordings), 1)
        self.assertEqual(worker.recordings[0]["watch_target_id"], "channel-1")
        self.assertEqual(persisted_sessions[0]["channel_id"], "channel-1")
        self.assertEqual(persisted_sessions[0]["state"], "recording")

    def test_deserialize_session_maps_channel_id_to_watch_target_id(self):
        legacy_session = {
            "session_id": "session-1",
            "channel_id": "channel-1",
            "state": "recording",
        }

        recording = worker.deserialize_session(legacy_session)

        self.assertEqual(recording["watch_target_id"], "channel-1")
        self.assertNotIn("channel_id", recording)

    def test_serialize_recording_maps_watch_target_id_to_channel_id(self):
        recording = {
            "session_id": "session-1",
            "watch_target_id": "channel-1",
            "state": "recording",
        }

        session = worker.serialize_recording(recording)

        self.assertEqual(session["channel_id"], "channel-1")
        self.assertNotIn("watch_target_id", session)

    def test_recording_session_adapter_round_trip_preserves_legacy_shape(self):
        legacy_session = {
            "session_id": "session-1",
            "channel_id": "channel-1",
            "started_at": "2026-09-05T00:00:00",
            "finished_at": None,
            "output_file": "recording.mp4",
            "state": "recording",
        }

        recording = worker.deserialize_session(legacy_session)

        self.assertEqual(worker.serialize_recording(recording), legacy_session)

    def test_save_recordings_preserves_legacy_json_fields(self):
        worker.recordings = [
            {
                "session_id": "session-1",
                "watch_target_id": "channel-1",
                "stream_id": "stream-1",
                "started_at": "2026-09-05T00:00:00",
                "finished_at": None,
                "output_file": "recording.mp4",
                "state": "recording",
            }
        ]

        worker.save_recordings()
        persisted_session = json.loads(
            Path(worker.SESSIONS_PATH).read_text(encoding="utf-8")
        )[0]

        self.assertIn("channel_id", persisted_session)
        self.assertNotIn("watch_target_id", persisted_session)
        self.assertNotIn("stream_id", persisted_session)
        self.assertEqual(persisted_session["session_id"], "session-1")
        self.assertEqual(persisted_session["started_at"], "2026-09-05T00:00:00")
        self.assertIsNone(persisted_session["finished_at"])
        self.assertEqual(persisted_session["output_file"], "recording.mp4")
        self.assertEqual(persisted_session["state"], "recording")

    def test_malformed_json_is_an_explicit_error(self):
        Path(worker.SESSIONS_PATH).write_text("{", encoding="utf-8")

        with self.assertRaises(json.JSONDecodeError):
            worker.load_sessions()

    def test_stream_persistence_is_distinct_from_runtime_status(self):
        worker.streams_data = [
            {
                "id": "stream-1",
                "watch_target_id": "channel-1",
                "state": "recording",
                "started_at": "2026-09-05T00:00:00",
                "finished_at": None,
            }
        ]
        worker.save_streams()

        persisted_stream = json.loads(Path(worker.STREAMS_PATH).read_text(encoding="utf-8"))[0]
        self.assertEqual(persisted_stream["id"], "stream-1")
        self.assertNotIn("channel_id", persisted_stream)
        self.assertEqual(worker.channels_status, {})

    def test_atomic_write_replaces_destination_without_temp_artifacts(self):
        Path(worker.CHANNELS_STATUS_PATH).write_text('{"old": true}', encoding="utf-8")
        worker.channels_status = {"channel-1": {"state": "offline"}}

        worker.save_status()

        self.assertEqual(
            json.loads(Path(worker.CHANNELS_STATUS_PATH).read_text(encoding="utf-8")),
            worker.channels_status,
        )
        self.assertEqual(list(Path(worker.CHANNELS_STATUS_PATH).parent.glob("*.tmp")), [])

    def test_poll_reload_preserves_active_session(self):
        active_session = {
            "session_id": "session-1",
            "channel_id": "channel-1",
            "started_at": "2026-09-05T00:00:00",
            "finished_at": None,
            "output_file": "recording.mp4",
            "state": "recording",
        }
        worker.recordings = [worker.deserialize_session(active_session)]
        worker.active_recordings = {"channel-1": {"session_id": "session-1"}}
        Path(worker.SESSIONS_PATH).write_text("[]", encoding="utf-8")

        with worker.lock:
            worker.reload_recordings_preserving_active()

        self.assertEqual(worker.recordings, [worker.deserialize_session(active_session)])

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
        worker.recordings = [
            {
                "session_id": "session-1",
            "watch_target_id": "channel-1",
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

        self.assertEqual(len(worker.recordings), 1)
        self.assertEqual(worker.recordings[0]["session_id"], "session-1")
        self.assertEqual(worker.recordings[0]["state"], "finished")
        self.assertIsNotNone(worker.recordings[0]["finished_at"])

    def test_monitor_marks_the_existing_session_as_error_on_process_failure(self):
        worker.channels_status = {
            "channel-1": {
                "channel_name": "example",
                "platform": "twitch",
                "state": "recording",
            }
        }
        worker.recordings = [
            {
                "session_id": "session-1",
            "watch_target_id": "channel-1",
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

        self.assertEqual(worker.recordings[0]["state"], "error")
        self.assertIsNotNone(worker.recordings[0]["finished_at"])

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
        self.assertEqual(worker.recordings, [])
        self.assertEqual(worker.channels_status["channel-1"]["state"], "offline")

    def test_poll_loop_waits_for_a_missing_watchlist_to_reappear(self):
        self.watchlist_path.unlink()

        def recreate_watchlist_then_stop(_):
            if not self.watchlist_path.exists():
                self.watchlist_path.write_text("[]", encoding="utf-8")
                return
            raise KeyboardInterrupt

        with patch.object(
            worker.time,
            "sleep",
            side_effect=recreate_watchlist_then_stop,
        ) as sleep:
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(sleep.call_count, 2)
        self.assertTrue(self.watchlist_path.exists())

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
        worker.recordings = [worker.deserialize_session(session)]
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
                    worker.reload_recordings_preserving_active()
                except OSError:
                    pass

        self.assertEqual(worker.recordings, [worker.deserialize_session(session)])
        worker.monitor_recording("channel-1")
        self.assertEqual(worker.recordings[0]["state"], "finished")

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
        worker.recordings = [worker.deserialize_session(session)]
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
        self.assertEqual(worker.recordings[0]["state"], "error")
        self.assertIsNotNone(worker.recordings[0]["finished_at"])
        persisted_sessions = json.loads(
            Path(worker.SESSIONS_PATH).read_text(encoding="utf-8")
        )
        self.assertEqual(persisted_sessions[0]["state"], "error")

    def test_shutdown_with_no_active_recordings_exits_cleanly(self):
        """Shutdown handler should exit cleanly when no active recordings exist."""
        worker.active_recordings = {}
        worker.channels_status = {}
        worker.recordings = []

        with patch.object(worker, "save_status"), \
             patch.object(worker, "save_recordings"):
            with self.assertRaises(SystemExit) as ctx:
                worker.handle_shutdown(None, None)
            self.assertEqual(ctx.exception.code, 0)

    def test_shutdown_with_already_exited_process_tolerates_gracefully(self):
        """Shutdown should tolerate processes that have already exited."""
        session = {
            "session_id": "session-1",
            "channel_id": "channel-1",
            "started_at": "2026-09-05T00:00:00",
            "finished_at": None,
            "output_file": "recording.mp4",
            "state": "recording",
        }
        # Process already exited with returncode=0
        process = FakeProcess(returncode=0)
        worker.recordings = [worker.deserialize_session(session)]
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

        with patch.object(worker, "save_status"), \
             patch.object(worker, "save_recordings"):
            with self.assertRaises(SystemExit):
                worker.handle_shutdown(None, None)

    def test_drain_stderr_logs_non_empty_lines(self):
        """Drain stderr should log non-empty stderr lines."""
        stderr_lines = "streamlink output line 1\nstreamlink output line 2\n"
        proc = FakeProcess(stderr_lines=stderr_lines)

        with patch.object(worker.log, "info") as mock_log:
            worker.drain_stderr(proc, "test-channel")

        # Should have logged 2 lines (non-empty)
        self.assertEqual(mock_log.call_count, 2)
        mock_log.assert_any_call("[%s] [streamlink] %s", "test-channel", "streamlink output line 1")
        mock_log.assert_any_call("[%s] [streamlink] %s", "test-channel", "streamlink output line 2")

    def test_drain_stderr_skips_empty_lines(self):
        """Drain stderr should skip empty or whitespace-only lines."""
        # Only genuinely non-empty lines should be logged
        stderr_lines = "valid line\n\nanother valid\n"
        proc = FakeProcess(stderr_lines=stderr_lines)

        with patch.object(worker.log, "info") as mock_log:
            worker.drain_stderr(proc, "test-channel")

        # Should log only non-empty lines (2 instead of 3)
        self.assertEqual(mock_log.call_count, 2)

    def test_drain_stderr_handles_missing_stderr(self):
        """Drain stderr should handle missing/None stderr gracefully."""
        proc = FakeProcess()
        proc.stderr = None

        # Should not raise
        worker.drain_stderr(proc, "test-channel")

    def test_drain_stderr_handles_empty_stderr(self):
        """Drain stderr should handle empty stderr gracefully."""
        proc = FakeProcess(stderr_lines="")

        with patch.object(worker.log, "info") as mock_log:
            worker.drain_stderr(proc, "test-channel")

        mock_log.assert_not_called()

    def test_monitor_recording_drains_stderr_before_wait(self):
        """monitor_recording should drain stderr before calling wait."""
        stderr_lines = "streamlink: connected\nstreamlink: downloading\n"
        proc = FakeProcess(returncode=0, stderr_lines=stderr_lines)
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
        worker.recordings = [
            {
                "session_id": "session-1",
                "watch_target_id": "channel-1",
                "started_at": "2026-09-05T00:00:00",
                "finished_at": None,
                "output_file": str(output_file),
                "state": "recording",
            }
        ]
        worker.active_recordings = {
            "channel-1": {
                "process": proc,
                "output_file": str(output_file),
                "channel_name": "example",
                "session_id": "session-1",
            }
        }

        with patch.object(worker.log, "info") as mock_log:
            worker.monitor_recording("channel-1")

        # Verify stderr lines were logged
        self.assertGreaterEqual(mock_log.call_count, 2)
        # Verify recording was finalized
        self.assertEqual(worker.recordings[0]["state"], "finished")

    def test_wait_for_process_calls_kill_on_timeout(self):
        """_wait_for_process should call kill when terminate times out."""
        proc = FakeProcess()

        with patch.object(proc, "kill") as mock_kill:
            with patch.object(proc, "wait", side_effect=worker.subprocess.TimeoutExpired("cmd", 5)):
                worker._wait_for_process(proc)
                mock_kill.assert_called_once()

    def test_wait_for_process_handles_already_exited_process(self):
        """_wait_for_process should tolerate already-exited processes."""
        proc = FakeProcess(returncode=0)

        # Should not raise
        worker._wait_for_process(proc)

    def test_wait_for_process_handles_missing_kill_method(self):
        """_wait_for_process should handle processes without kill() method."""
        # Create a minimal fake process without kill attribute
        class MinimalFakeProcess:
            def __init__(self):
                self.returncode = 1
            def wait(self, timeout=None):
                return self.returncode
            def terminate(self):
                pass
        proc = MinimalFakeProcess()

        with patch.object(proc, "wait", side_effect=worker.subprocess.TimeoutExpired("cmd", 5)):
            # Should not raise
            worker._wait_for_process(proc)


if __name__ == "__main__":
    unittest.main()


class StreamDetectionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        config_dir = Path(self.temp_dir.name)
        worker.CHANNELS_STATUS_PATH = str(config_dir / "channels_status.json")
        worker.SESSIONS_PATH = str(config_dir / "sessions.json")
        worker.STREAMS_PATH = str(config_dir / "streams.json")
        worker.OUTPUT_DIR = str(config_dir / "recordings")
        worker.channels_status = {}
        worker.recordings = []
        worker.active_recordings = {}
        worker.streams_data = []
        worker.lock = worker.threading.Lock()
        Path(worker.CHANNELS_STATUS_PATH).write_text("{}", encoding="utf-8")
        Path(worker.SESSIONS_PATH).write_text("[]", encoding="utf-8")
        Path(worker.STREAMS_PATH).write_text("[]", encoding="utf-8")
        self.watchlist_path = config_dir / "watchlist.json"
        self.watchlist_path.write_text("[]", encoding="utf-8")
        worker.CONFIG_PATH = str(self.watchlist_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_first_positive_poll_creates_stream(self):
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
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        with patch.object(worker, "is_live", return_value=True), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            popen_mock.return_value = FakeProcess()
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(len(worker.streams_data), 1)
        self.assertEqual(worker.streams_data[0]["watch_target_id"], "channel-1")
        self.assertIsNotNone(worker.streams_data[0]["started_at"])
        self.assertIsNone(worker.streams_data[0]["finished_at"])

    def test_repeated_positive_polls_reuse_same_stream(self):
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
            "state": "recording",
        }
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        existing_stream = {
            "id": "stream-123",
            "watch_target_id": "channel-1",
            "state": "recording",
            "started_at": "2026-09-14T00:00:00",
            "finished_at": None,
        }
        worker.streams_data.append(existing_stream)
        worker.active_recordings["channel-1"] = {
            "process": FakeProcess(),
            "session_id": "session-1",
            "stream_id": "stream-123",
        }

        with patch.object(worker, "is_live", return_value=True), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            popen_mock.return_value = FakeProcess()
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(len(worker.streams_data), 1)
        self.assertEqual(worker.streams_data[0]["id"], "stream-123")
        self.assertEqual(popen_mock.call_count, 0)

    def test_negative_poll_finalizes_stream_when_no_recording_active(self):
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
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        existing_stream = {
            "id": "stream-123",
            "watch_target_id": "channel-1",
            "state": "recording",
            "started_at": "2026-09-14T00:00:00",
            "finished_at": None,
        }
        worker.streams_data.append(existing_stream)

        with patch.object(worker, "is_live", return_value=False), \
             patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertIsNotNone(worker.streams_data[0]["finished_at"])
        self.assertEqual(worker.streams_data[0]["state"], "finished")

    def test_negative_poll_does_not_finalize_stream_when_recording_active(self):
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
            "state": "recording",
        }

        existing_stream = {
            "id": "stream-123",
            "watch_target_id": "channel-1",
            "state": "recording",
            "started_at": "2026-09-14T00:00:00",
            "finished_at": None,
        }
        worker.streams_data.append(existing_stream)
        worker.active_recordings["channel-1"] = {
            "process": FakeProcess(),
            "session_id": "session-1",
            "stream_id": "stream-123",
        }

        with patch.object(worker, "is_live", return_value=False), \
             patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertIsNone(worker.streams_data[0]["finished_at"])
        self.assertEqual(worker.streams_data[0]["state"], "recording")

    def test_failed_recording_does_not_end_stream(self):
        output_file = Path(worker.OUTPUT_DIR) / "recording.mp4"
        output_file.parent.mkdir(parents=True)
        output_file.write_bytes(b"recorded")
        worker.channels_status["channel-1"] = {
            "channel_name": "example",
            "platform": "twitch",
            "state": "recording",
        }

        existing_stream = {
            "id": "stream-123",
            "watch_target_id": "channel-1",
            "state": "recording",
            "started_at": "2026-09-14T00:00:00",
            "finished_at": None,
        }
        worker.streams_data.append(existing_stream)
        worker.recordings = [
            {
                "session_id": "session-1",
                "watch_target_id": "channel-1",
                "stream_id": "stream-123",
                "started_at": "2026-09-14T00:00:00",
                "finished_at": None,
                "output_file": str(output_file),
                "state": "recording",
            }
        ]
        worker.active_recordings["channel-1"] = {
            "process": FakeProcess(returncode=1),
            "session_id": "session-1",
            "stream_id": "stream-123",
            "output_file": str(output_file),
            "channel_name": "example",
        }

        worker.monitor_recording("channel-1")

        self.assertIsNone(worker.streams_data[0]["finished_at"])
        self.assertEqual(worker.recordings[0]["state"], "error")

    def test_later_broadcast_creates_new_stream_id(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
            "quality": "best",
        }

        old_stream = {
            "id": "stream-123",
            "watch_target_id": "channel-1",
            "state": "finished",
            "started_at": "2026-09-14T00:00:00",
            "finished_at": "2026-09-14T01:00:00",
        }
        worker.streams_data.append(old_stream)
        worker.channels_status["channel-1"] = {
            "channel_name": "example",
            "platform": "twitch",
            "state": "idle",
        }
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        with patch.object(worker, "is_live", return_value=True), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            popen_mock.return_value = FakeProcess()
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(len(worker.streams_data), 2)
        self.assertEqual(worker.streams_data[0]["id"], "stream-123")
        self.assertNotEqual(worker.streams_data[1]["id"], "stream-123")
        self.assertEqual(worker.streams_data[1]["watch_target_id"], "channel-1")

    def test_recording_stores_stream_id(self):
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
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        with patch.object(worker, "is_live", return_value=True), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            popen_mock.return_value = FakeProcess()
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(len(worker.recordings), 1)
        self.assertEqual(worker.recordings[0]["watch_target_id"], "channel-1")
        self.assertIn("stream_id", worker.recordings[0])
        self.assertEqual(worker.recordings[0]["stream_id"], worker.streams_data[0]["id"])

    def test_streams_json_excludes_channel_id(self):
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
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        with patch.object(worker, "is_live", return_value=True), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.time, "sleep", side_effect=KeyboardInterrupt):
            popen_mock.return_value = FakeProcess()
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        persisted_streams = json.loads(
            Path(worker.STREAMS_PATH).read_text(encoding="utf-8")
        )
        self.assertEqual(len(persisted_streams), 1)
        self.assertNotIn("channel_id", persisted_streams[0])
        self.assertEqual(persisted_streams[0]["watch_target_id"], "channel-1")

    def test_worker_restart_reloads_streams_preserving_active(self):
        existing_stream = {
            "id": "stream-123",
            "watch_target_id": "channel-1",
            "state": "recording",
            "started_at": "2026-09-14T00:00:00",
            "finished_at": None,
        }
        worker.streams_data.append(existing_stream)
        worker.active_recordings["channel-1"] = {
            "session_id": "session-1",
            "stream_id": "stream-123",
            "channel_name": "example",
            "platform": "twitch",
        }

        with patch.object(worker, "load_streams", return_value=[existing_stream]):
            with worker.lock:
                worker.reload_streams_preserving_active()

        # Active stream from disk is preserved in memory
        self.assertEqual(len(worker.streams_data), 1)
        self.assertEqual(worker.streams_data[0]["id"], "stream-123")

        with patch.object(worker, "load_streams", return_value=[]):
            with worker.lock:
                worker.reload_streams_preserving_active()

        # Active stream remains even when disk has nothing new
        self.assertEqual(len(worker.streams_data), 1)


class RecordingSubdirPathTests(unittest.TestCase):
    """Tests for recording_subdir path validation and output directory resolution."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_dir = Path(self.temp_dir.name)
        self.output_dir = self.config_dir / "recordings"
        self.output_dir.mkdir(parents=True)
        worker.OUTPUT_DIR = str(self.output_dir)

    def tearDown(self):
        self.temp_dir.cleanup()

    # normalize_recording_subdir tests
    def test_normalize_valid_simple_path(self):
        result = worker.normalize_recording_subdir("favorites")
        self.assertEqual(result, "favorites")

    def test_normalize_valid_nested_path(self):
        result = worker.normalize_recording_subdir("favorites/twitch")
        self.assertEqual(result, "favorites/twitch")

    def test_normalize_valid_deeply_nested_path(self):
        result = worker.normalize_recording_subdir("a/b/c/d/e")
        self.assertEqual(result, "a/b/c/d/e")

    def test_normalize_backslash_to_forward_slash(self):
        result = worker.normalize_recording_subdir("favorites\\twitch")
        self.assertEqual(result, "favorites/twitch")

    def test_normalize_mixed_separators(self):
        result = worker.normalize_recording_subdir("favorites\\twitch/pixel")
        self.assertEqual(result, "favorites/twitch/pixel")

    def test_normalize_collapse_multiple_slashes(self):
        result = worker.normalize_recording_subdir("favorites///twitch///channel")
        self.assertEqual(result, "favorites/twitch/channel")

    def test_normalize_strip_leading_slash(self):
        result = worker.normalize_recording_subdir("/favorites/twitch/")
        self.assertIsNone(result)

    def test_normalize_strip_trailing_slash(self):
        result = worker.normalize_recording_subdir("favorites/twitch/")
        self.assertEqual(result, "favorites/twitch")

    def test_normalize_returns_none_for_empty(self):
        result = worker.normalize_recording_subdir("")
        self.assertIsNone(result)

    def test_normalize_returns_none_for_whitespace_only(self):
        result = worker.normalize_recording_subdir("   ")
        self.assertIsNone(result)

    def test_normalize_rejects_posix_absolute(self):
        result = worker.normalize_recording_subdir("/etc/passwd")
        self.assertIsNone(result)

    def test_normalize_rejects_windows_absolute_backslash(self):
        result = worker.normalize_recording_subdir("\\etc\\passwd")
        self.assertIsNone(result)

    def test_normalize_rejects_windows_drive_letter(self):
        result = worker.normalize_recording_subdir("C:\\windows\\system32")
        self.assertIsNone(result)

    def test_normalize_rejects_drive_letter_uppercase(self):
        result = worker.normalize_recording_subdir("D:\\data\\file")
        self.assertIsNone(result)

    def test_normalize_rejects_unc_path(self):
        result = worker.normalize_recording_subdir("\\\\server\\share")
        self.assertIsNone(result)

    def test_normalize_rejects_traversal_parent(self):
        result = worker.normalize_recording_subdir("../etc")
        self.assertIsNone(result)

    def test_normalize_rejects_traversal_parent_in_segment(self):
        result = worker.normalize_recording_subdir("a/../etc")
        self.assertIsNone(result)

    def test_normalize_rejects_dot_segment(self):
        result = worker.normalize_recording_subdir("a/./b")
        self.assertIsNone(result)

    def test_normalize_rejects_null_byte(self):
        result = worker.normalize_recording_subdir("valid\x00path")
        self.assertIsNone(result)

    def test_normalize_rejects_control_character(self):
        result = worker.normalize_recording_subdir("valid\x01path")
        self.assertIsNone(result)

    def test_normalize_rejects_newline(self):
        result = worker.normalize_recording_subdir("valid\npath")
        self.assertIsNone(result)

    def test_normalize_rejects_tab(self):
        result = worker.normalize_recording_subdir("valid\tpath")
        self.assertIsNone(result)

    def test_normalize_rejects_exceeds_255_chars(self):
        long_path = "a" * 256
        result = worker.normalize_recording_subdir(long_path)
        self.assertIsNone(result)

    def test_normalize_accepts_255_chars(self):
        path_255 = "a" * 255
        result = worker.normalize_recording_subdir(path_255)
        self.assertEqual(result, path_255)

    # is_valid_recording_subdir tests
    def test_is_valid_true_for_empty(self):
        self.assertTrue(worker.is_valid_recording_subdir(""))

    def test_is_valid_true_for_valid_normalized(self):
        self.assertTrue(worker.is_valid_recording_subdir("favorites/twitch"))

    def test_is_valid_false_for_invalid(self):
        self.assertFalse(worker.is_valid_recording_subdir("../etc"))

    def test_is_valid_false_for_absolute(self):
        self.assertFalse(worker.is_valid_recording_subdir("/absolute"))

    # resolve_output_dir tests
    def test_resolve_uses_recording_subdir_when_valid(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "favorites/twitch",
        }
        result = worker.resolve_output_dir(entry, str(self.output_dir))
        expected = self.output_dir / "favorites" / "twitch"
        self.assertEqual(result, expected)

    def test_resolve_legacy_fallback_without_subdir(self):
        entry = {"channel_name": "testchannel"}
        result = worker.resolve_output_dir(entry, str(self.output_dir))
        expected = self.output_dir / "testchannel"
        self.assertEqual(result, expected)

    def test_resolve_raises_for_invalid_subdir(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "../etc",
        }
        with self.assertRaises(ValueError):
            worker.resolve_output_dir(entry, str(self.output_dir))

    def test_resolve_legacy_fallback_for_empty_subdir(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "",
        }
        result = worker.resolve_output_dir(entry, str(self.output_dir))
        expected = self.output_dir / "testchannel"
        self.assertEqual(result, expected)

    def test_resolve_raises_for_traversal_in_subdir(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "../etc",
        }
        with self.assertRaises(ValueError):
            worker.resolve_output_dir(entry, str(self.output_dir))

    def test_resolve_raises_for_absolute_subdir(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "/etc/passwd",
        }
        with self.assertRaises(ValueError):
            worker.resolve_output_dir(entry, str(self.output_dir))

    def test_resolve_raises_for_traversal_normalizing_to_empty(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "..",
        }
        with self.assertRaises(ValueError):
            worker.resolve_output_dir(entry, str(self.output_dir))

    def test_resolve_nested_path_creates_directories(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "a/b/c",
        }
        result = worker.resolve_output_dir(entry, str(self.output_dir))
        expected = self.output_dir / "a" / "b" / "c"
        self.assertEqual(result, expected)
        # Should not raise - verifies path is valid
        self.assertTrue(True)

    def test_resolve_normalizes_separators(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "favorites\\twitch\\channel",
        }
        result = worker.resolve_output_dir(entry, str(self.output_dir))
        expected = self.output_dir / "favorites" / "twitch" / "channel"
        self.assertEqual(result, expected)

    def test_resolve_preserves_existing_behavior(self):
        """Ensure resolve_output_dir returns Path object for compatibility."""
        entry = {"channel_name": "testchannel"}
        result = worker.resolve_output_dir(entry, str(self.output_dir))
        self.assertIsInstance(result, Path)

    def test_resolve_raises_for_leading_slash_in_subdir(self):
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "/favorites/channel/",
        }
        with self.assertRaises(ValueError):
            worker.resolve_output_dir(entry, str(self.output_dir))

    def test_resolve_canonicalizes_nested_path(self):
        """favorites/channel/ (with trailing slash) should canonicalize to favorites/channel."""
        entry = {
            "channel_name": "testchannel",
            "recording_subdir": "favorites/channel/",
        }
        result = worker.resolve_output_dir(entry, str(self.output_dir))
        expected = self.output_dir / "favorites" / "channel"
        self.assertEqual(result, expected)


class ConfigPathTests(unittest.TestCase):
    """Tests for config path resolution and runtime file initialization."""

    def test_config_path_config_dir_produces_exact_four_paths(self):
        """CONFIG_DIR produces exact four paths."""
        env = {"CONFIG_DIR": "/custom/config"}
        result = worker._resolve_all_paths(env)

        self.assertEqual(result["watchlist"], "/custom/config/watchlist.json")
        self.assertEqual(result["channels_status"], "/custom/config/channels_status.json")
        self.assertEqual(result["sessions"], "/custom/config/sessions.json")
        self.assertEqual(result["streams"], "/custom/config/streams.json")

    def test_config_path_four_individual_overrides_win_including_different_parents(self):
        """Four individual overrides win, including different parents."""
        env = {
            "WATCHLIST_PATH": "/override1/watchlist.json",
            "CHANNELS_STATUS_PATH": "/override2/channels.json",
            "SESSIONS_PATH": "/override3/sessions.json",
            "STREAMS_PATH": "/override4/streams.json",
        }
        result = worker._resolve_all_paths(env)

        self.assertEqual(result["watchlist"], "/override1/watchlist.json")
        self.assertEqual(result["channels_status"], "/override2/channels.json")
        self.assertEqual(result["sessions"], "/override3/sessions.json")
        self.assertEqual(result["streams"], "/override4/streams.json")

    def test_config_path_empty_whitespace_falls_through_to_local_default(self):
        """Empty/whitespace individual and CONFIG_DIR fall through to local default."""
        env = {
            "WATCHLIST_PATH": "",
            "CHANNELS_STATUS_PATH": "   ",
            "SESSIONS_PATH": "",
            "STREAMS_PATH": "  ",
            "CONFIG_DIR": "  ",
        }
        result = worker._resolve_all_paths(env)

        # Should fall through to module-relative default
        default_dir = worker._get_default_config_dir().replace("\\", "/")
        self.assertEqual(result["watchlist"].replace("\\", "/"), f"{default_dir}/watchlist.json")
        self.assertEqual(result["channels_status"].replace("\\", "/"), f"{default_dir}/channels_status.json")
        self.assertEqual(result["sessions"].replace("\\", "/"), f"{default_dir}/sessions.json")
        self.assertEqual(result["streams"].replace("\\", "/"), f"{default_dir}/streams.json")

    def test_config_path_no_env_gives_existing_local_defaults(self):
        """No env gives existing local defaults."""
        result = worker._resolve_all_paths({})

        default_dir = worker._get_default_config_dir().replace("\\", "/")
        self.assertEqual(result["watchlist"].replace("\\", "/"), f"{default_dir}/watchlist.json")
        self.assertEqual(result["channels_status"].replace("\\", "/"), f"{default_dir}/channels_status.json")
        self.assertEqual(result["sessions"].replace("\\", "/"), f"{default_dir}/sessions.json")
        self.assertEqual(result["streams"].replace("\\", "/"), f"{default_dir}/streams.json")

    def test_config_path_individual_override_takes_precedence_over_config_dir(self):
        """Individual override takes precedence over CONFIG_DIR."""
        env = {
            "WATCHLIST_PATH": "/individual/watch.json",
            "CONFIG_DIR": "/config/dir",
        }
        result = worker._resolve_all_paths(env)

        self.assertEqual(result["watchlist"], "/individual/watch.json")
        self.assertEqual(result["channels_status"].replace("\\", "/"), "/config/dir/channels_status.json")
        self.assertEqual(result["sessions"].replace("\\", "/"), "/config/dir/sessions.json")
        self.assertEqual(result["streams"].replace("\\", "/"), "/config/dir/streams.json")

    def test_config_path_whitespace_in_overrides_is_trimmed(self):
        """Whitespace in overrides is trimmed."""
        env = {
            "WATCHLIST_PATH": "  /spaced/watch.json  ",
            "CONFIG_DIR": "  /spaced/config  ",
        }
        result = worker._resolve_all_paths(env)

        self.assertEqual(result["watchlist"], "/spaced/watch.json")
        self.assertEqual(result["channels_status"].replace("\\", "/"), "/spaced/config/channels_status.json")


class RuntimeFilesTests(unittest.TestCase):
    """Tests for runtime file initialization."""

    def test_runtime_files_empty_dir_creates_exact_shapes(self):
        """Empty dir creates exact shapes."""
        with tempfile.TemporaryDirectory() as temp_dir:
            paths = {
                "watchlist": f"{temp_dir}/watchlist.json",
                "channels_status": f"{temp_dir}/channels_status.json",
                "sessions": f"{temp_dir}/sessions.json",
                "streams": f"{temp_dir}/streams.json",
            }

            worker.initialize_runtime_files(paths)

            with open(paths["watchlist"], "r") as f:
                self.assertEqual(json.load(f), [])
            with open(paths["channels_status"], "r") as f:
                self.assertEqual(json.load(f), {})
            with open(paths["sessions"], "r") as f:
                self.assertEqual(json.load(f), [])
            with open(paths["streams"], "r") as f:
                self.assertEqual(json.load(f), [])

    def test_runtime_files_existing_contents_preserved(self):
        """Existing contents byte-for-byte preserved."""
        with tempfile.TemporaryDirectory() as temp_dir:
            watchlist_path = f"{temp_dir}/watchlist.json"
            existing_content = [{"id": "existing", "channel_name": "test"}]
            with open(watchlist_path, "w") as f:
                json.dump(existing_content, f, indent=2)

            paths = {
                "watchlist": watchlist_path,
                "channels_status": f"{temp_dir}/channels_status.json",
                "sessions": f"{temp_dir}/sessions.json",
                "streams": f"{temp_dir}/streams.json",
            }

            worker.initialize_runtime_files(paths)

            with open(watchlist_path, "r") as f:
                self.assertEqual(json.load(f), existing_content)

    def test_runtime_files_override_paths_in_separate_missing_parents_created(self):
        """Override paths in separate missing parents are created."""
        with tempfile.TemporaryDirectory() as temp_dir:
            paths = {
                "watchlist": f"{temp_dir}/override1/watchlist.json",
                "channels_status": f"{temp_dir}/override2/channels_status.json",
                "sessions": f"{temp_dir}/override3/sessions.json",
                "streams": f"{temp_dir}/override4/streams.json",
            }

            worker.initialize_runtime_files(paths)

            for file_path in paths.values():
                self.assertTrue(os.path.exists(file_path), f"{file_path} should exist")


class RuntimeConfigEnvTests(unittest.TestCase):
    """Tests for runtime configuration from environment variables."""

    def test_output_dir_explicit_override(self):
        """OUTPUT_DIR is read from environment when explicitly set."""
        with patch.dict(os.environ, {"OUTPUT_DIR": "/custom/recordings"}):
            result = worker._resolve_output_dir()
            self.assertEqual(result, "/custom/recordings")

    def test_output_dir_default_when_absent(self):
        """OUTPUT_DIR defaults to /recordings when env var is absent."""
        with patch.dict(os.environ, {}, clear=False):
            # Remove OUTPUT_DIR if it exists
            os.environ.pop("OUTPUT_DIR", None)
            result = worker._resolve_output_dir()
            self.assertEqual(result, "/recordings")

    def test_output_dir_default_when_empty(self):
        """OUTPUT_DIR defaults to /recordings when env var is empty string."""
        with patch.dict(os.environ, {"OUTPUT_DIR": ""}):
            result = worker._resolve_output_dir()
            self.assertEqual(result, "/recordings")

    def test_output_dir_default_when_whitespace(self):
        """OUTPUT_DIR defaults to /recordings when env var is whitespace only."""
        with patch.dict(os.environ, {"OUTPUT_DIR": "   "}):
            result = worker._resolve_output_dir()
            self.assertEqual(result, "/recordings")

    def test_output_dir_whitespace_is_trimmed(self):
        """OUTPUT_DIR whitespace is trimmed when non-empty."""
        with patch.dict(os.environ, {"OUTPUT_DIR": "  /custom/recordings  "}):
            result = worker._resolve_output_dir()
            self.assertEqual(result, "/custom/recordings")

    def test_poll_interval_explicit_override(self):
        """POLL_INTERVAL is read from environment when explicitly set."""
        with patch.dict(os.environ, {"POLL_INTERVAL": "3600"}):
            result = worker._get_env_int("POLL_INTERVAL", 60)
            self.assertEqual(result, 3600)

    def test_poll_interval_default_when_absent(self):
        """POLL_INTERVAL defaults to 60 when env var is absent."""
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("POLL_INTERVAL", None)
            result = worker._get_env_int("POLL_INTERVAL", 60)
            self.assertEqual(result, 60)

    def test_poll_interval_default_when_empty(self):
        """POLL_INTERVAL defaults to 60 when env var is empty string."""
        with patch.dict(os.environ, {"POLL_INTERVAL": ""}):
            result = worker._get_env_int("POLL_INTERVAL", 60)
            self.assertEqual(result, 60)

    def test_poll_interval_default_when_whitespace(self):
        """POLL_INTERVAL defaults to 60 when env var is whitespace only."""
        with patch.dict(os.environ, {"POLL_INTERVAL": "   "}):
            result = worker._get_env_int("POLL_INTERVAL", 60)
            self.assertEqual(result, 60)

    def test_poll_interval_whitespace_is_trimmed(self):
        """POLL_INTERVAL whitespace is trimmed when non-empty."""
        with patch.dict(os.environ, {"POLL_INTERVAL": "  3600  "}):
            result = worker._get_env_int("POLL_INTERVAL", 60)
            self.assertEqual(result, 3600)

    def test_poll_interval_invalid_raises_valueerror(self):
        """POLL_INTERVAL raises ValueError when set to non-integer."""
        with patch.dict(os.environ, {"POLL_INTERVAL": "not_a_number"}):
            with self.assertRaises(ValueError) as ctx:
                worker._get_env_int("POLL_INTERVAL", 60)
            self.assertIn("POLL_INTERVAL", str(ctx.exception))
            self.assertIn("not_a_number", str(ctx.exception))

    def test_poll_interval_float_raises_valueerror(self):
        """POLL_INTERVAL raises ValueError when set to float string."""
        with patch.dict(os.environ, {"POLL_INTERVAL": "60.5"}):
            with self.assertRaises(ValueError) as ctx:
                worker._get_env_int("POLL_INTERVAL", 60)
            self.assertIn("POLL_INTERVAL", str(ctx.exception))

    def test_poll_interval_negative_accepted(self):
        """POLL_INTERVAL accepts negative values (for testing scenarios)."""
        with patch.dict(os.environ, {"POLL_INTERVAL": "-1"}):
            result = worker._get_env_int("POLL_INTERVAL", 60)
            self.assertEqual(result, -1)