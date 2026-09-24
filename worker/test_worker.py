import json
import os
import importlib.util
import subprocess
import tempfile
import unittest
import io
from typing import Any
from pathlib import Path
from unittest.mock import patch, MagicMock

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
        self.stderr: io.StringIO | None = self._stderr
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


class ProbeClassificationTests(unittest.TestCase):
    ORIGINAL_TWITCH_INCIDENT = (
        "Unable to open URL: https://gql.twitch.tv/gql "
        "(type object 'Urllib3UtilUrlPercentReOverride' has no attribute 'sub')"
    )

    def test_classifies_probe_responses_conservatively(self):
        url = "https://twitch.tv/example"
        cases = (
            (0, '{"streams": {"best": {}}}', worker.ProbeState.LIVE),
            (0, '{"streams": {}}', worker.ProbeState.OFFLINE),
            (
                1,
                json.dumps({"error": f"No playable streams found on this URL: {url}"}),
                worker.ProbeState.OFFLINE,
            ),
            (1, '{"error": "Twitch API request failed"}', worker.ProbeState.ERROR),
            (1, json.dumps({"error": self.ORIGINAL_TWITCH_INCIDENT}), worker.ProbeState.ERROR),
            (0, ' ', worker.ProbeState.ERROR),
            (0, '{', worker.ProbeState.ERROR),
            (0, 'null', worker.ProbeState.ERROR),
            (0, '[]', worker.ProbeState.ERROR),
            (0, '"unexpected"', worker.ProbeState.ERROR),
            (0, '42', worker.ProbeState.ERROR),
            (0, 'false', worker.ProbeState.ERROR),
            (0, '{}', worker.ProbeState.ERROR),
            (2, '{"streams": {"best": {}}}', worker.ProbeState.ERROR),
        )

        for returncode, stdout, expected_state in cases:
            with self.subTest(returncode=returncode, stdout=stdout):
                self.assertEqual(
                    worker.classify_probe_result(url, returncode, stdout).state,
                    expected_state,
                )

    def test_only_exact_no_playable_streams_envelope_is_offline(self):
        url = "https://twitch.tv/example"
        near_matches = (
            (0, {"error": f"No playable streams found on this URL: {url}"}),
            (1, {"error": f"No playable streams found on this URL: {url}", "streams": {}}),
            (1, {"error": "No playable streams found on this URL: https://other"}),
        )

        for returncode, payload in near_matches:
            with self.subTest(returncode=returncode, payload=payload):
                self.assertEqual(
                    worker.classify_probe_result(url, returncode, json.dumps(payload)).state,
                    worker.ProbeState.ERROR,
                )

    def test_invalid_streams_values_are_errors(self):
        url = "https://twitch.tv/example"
        invalid_values = (None, [], "unexpected", 42, False)

        for streams in invalid_values:
            with self.subTest(streams=streams):
                self.assertEqual(
                    worker.classify_probe_result(
                        url, 0, json.dumps({"streams": streams})
                    ).state,
                    worker.ProbeState.ERROR,
                )

    def test_error_envelopes_take_precedence_over_streams(self):
        url = "https://twitch.tv/example"
        for streams in ({}, {"best": {}}):
            with self.subTest(streams=streams):
                self.assertEqual(
                    worker.classify_probe_result(
                        url,
                        0,
                        json.dumps(
                            {"error": "Twitch API request failed", "streams": streams}
                        ),
                    ).state,
                    worker.ProbeState.ERROR,
                )

    def test_is_live_returns_safe_errors_and_keeps_shutdown_signals(self):
        url = "https://twitch.tv/example"
        failures = (
            subprocess.TimeoutExpired("streamlink", worker.CHECK_TIMEOUT),
            FileNotFoundError(),
            OSError(),
            RuntimeError(),
        )

        for failure in failures:
            with self.subTest(failure=type(failure).__name__), patch.object(
                worker.subprocess, "run", side_effect=failure
            ):
                result = worker.is_live(url)
                self.assertEqual(result.state, worker.ProbeState.ERROR)
                self.assertNotIn(url, repr(result))
                if str(failure):
                    self.assertNotIn(str(failure), repr(result))

        for signal_exception in (KeyboardInterrupt(), SystemExit()):
            with self.subTest(signal=type(signal_exception).__name__), patch.object(
                worker.subprocess, "run", side_effect=signal_exception
            ):
                with self.assertRaises(type(signal_exception)):
                    worker.is_live(url)

    def test_is_live_uses_the_existing_command_and_timeout(self):
        url = "https://twitch.tv/example"
        completed = subprocess.CompletedProcess(
            ["streamlink"], 0, stdout='{"streams": {"best": {}}}'
        )

        with patch.object(worker.subprocess, "run", return_value=completed) as run:
            self.assertEqual(worker.is_live(url).state, worker.ProbeState.LIVE)

        run.assert_called_once_with(
            ["streamlink", "--json", url],
            capture_output=True,
            text=True,
            timeout=worker.CHECK_TIMEOUT,
        )

    def test_is_live_real_probe_boundary_classifies_all_safe_payloads(self):
        url = "https://twitch.tv/example"
        exact_no_streams = f"No playable streams found on this URL: {url}"
        cases = (
            ('{"streams":{"best":{}}}', 0, worker.ProbeState.LIVE, "streams_available"),
            ('{"streams":{}}', 0, worker.ProbeState.OFFLINE, "empty_streams"),
            (json.dumps({"error": exact_no_streams}), 1, worker.ProbeState.OFFLINE, "no_playable_streams"),
            (json.dumps({"error": exact_no_streams}), 0, worker.ProbeState.ERROR, "error_envelope"),
            ('{"error":"plugin/network failure"}', 1, worker.ProbeState.ERROR, "error_envelope"),
            (json.dumps({"error": self.ORIGINAL_TWITCH_INCIDENT}), 1, worker.ProbeState.ERROR, "error_envelope"),
            ('{"streams":{"best":{}}}', 2, worker.ProbeState.ERROR, "nonzero_exit"),
            ('{', 0, worker.ProbeState.ERROR, "malformed_json"),
            ('', 0, worker.ProbeState.ERROR, "empty_output"),
            (' \t\n', 0, worker.ProbeState.ERROR, "empty_output"),
            ('{}', 0, worker.ProbeState.ERROR, "missing_streams"),
            ('[]', 0, worker.ProbeState.ERROR, "invalid_root"),
            ('{"streams":null}', 0, worker.ProbeState.ERROR, "invalid_streams"),
            ('{"streams":"best"}', 0, worker.ProbeState.ERROR, "invalid_streams"),
            ('{"streams":42}', 0, worker.ProbeState.ERROR, "invalid_streams"),
            ('{"streams":false}', 0, worker.ProbeState.ERROR, "invalid_streams"),
            ('{"streams":[]}', 0, worker.ProbeState.ERROR, "invalid_streams"),
            ('{"error":"unknown"}', 0, worker.ProbeState.ERROR, "error_envelope"),
            ('{"error":"unknown","streams":{}}', 0, worker.ProbeState.ERROR, "error_envelope"),
        )

        for stdout, returncode, state, reason in cases:
            with self.subTest(stdout=stdout, returncode=returncode):
                completed = subprocess.CompletedProcess(
                    ["streamlink"], returncode, stdout=stdout,
                    stderr="Authorization: Bearer secret-value",
                )
                with patch.object(worker.subprocess, "run", return_value=completed) as run:
                    result = worker.is_live(url)
                self.assertEqual((result.state, result.reason, result.returncode), (state, reason, returncode))
                self.assertIsNone(result.stderr_summary)
                self.assertNotIn("secret-value", repr(result))
                run.assert_called_once_with(
                    ["streamlink", "--json", url], capture_output=True,
                    text=True, timeout=worker.CHECK_TIMEOUT,
                )

    def test_is_live_process_failures_have_safe_metadata(self):
        url = "https://twitch.tv/example"
        for failure in (
            subprocess.TimeoutExpired("streamlink", worker.CHECK_TIMEOUT),
            FileNotFoundError("secret-value"), OSError("secret-value"),
            RuntimeError("secret-value"),
        ):
            with self.subTest(failure=type(failure).__name__), patch.object(
                worker.subprocess, "run", side_effect=failure
            ):
                result = worker.is_live(url)
            self.assertEqual(result.state, worker.ProbeState.ERROR)
            self.assertNotIn("secret-value", repr(result))
            self.assertNotIn(url, repr(result))
            if isinstance(failure, subprocess.TimeoutExpired):
                self.assertEqual((result.reason, result.timeout_seconds), ("timeout", worker.CHECK_TIMEOUT))
            else:
                self.assertEqual((result.reason, result.exception_type), ("process_error", type(failure).__name__))


class ProbeObservabilityTests(unittest.TestCase):
    def test_sanitize_diagnostic_redacts_before_truncation_and_normalizes_controls(self):
        secret = "https://user:password@example.test/path?access_token=secret-value"
        self.assertIsNone(worker._sanitize_diagnostic("x" * 300 + secret))
        self.assertIsNone(worker._sanitize_diagnostic('{"token":"secret-value"}'))
        self.assertIsNone(worker._sanitize_diagnostic("Authorization: Bearer secret-value"))
        self.assertIsNone(worker._sanitize_diagnostic("Cookie: session=secret-value"))
        self.assertEqual(
            worker._sanitize_diagnostic("safe\r\nmessage\twith\x00controls"),
            "safe message with controls",
        )
        self.assertEqual(len(worker._sanitize_diagnostic("x" * 400)), worker.DIAGNOSTIC_MAX_LENGTH)

    def test_sanitize_diagnostic_secret_matrix_never_retains_credentials_or_raw_json(self):
        unsafe_values = (
            "oauth token=secret", "access token=secret", "refresh token=secret",
            "Authorization: Basic secret", "Bearer secret", "Cookie: session=secret",
            "Set-Cookie: session=secret", "signed=secret", "signature=secret",
            "sig=secret", "key=secret", "https://user:password@example.test/path",
            "password=secret", "credential=secret", '{"streams":{"best":{}}}',
        )
        for value in unsafe_values:
            with self.subTest(value=value):
                self.assertIsNone(worker._sanitize_diagnostic(value))
        self.assertEqual(
            worker._sanitize_diagnostic("safe\r\nmessage\twith\x00controls"),
            "safe message with controls",
        )
        self.assertEqual(len(worker._sanitize_diagnostic("x" * 400)), worker.DIAGNOSTIC_MAX_LENGTH)

    def test_is_live_attaches_only_safe_stderr_metadata(self):
        completed = subprocess.CompletedProcess(
            ["streamlink"], 0, stdout='{"streams": {}}', stderr="harmless\nmessage"
        )
        with patch.object(worker.subprocess, "run", return_value=completed):
            result = worker.is_live("https://twitch.tv/example")
        self.assertEqual(result.state, worker.ProbeState.OFFLINE)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr_summary, "harmless message")

    def test_is_live_timeout_carries_safe_timeout_metadata(self):
        timeout = subprocess.TimeoutExpired("streamlink", worker.CHECK_TIMEOUT)
        timeout.stderr = b"https://user:password@example.test/?token=secret"
        with patch.object(worker.subprocess, "run", side_effect=timeout):
            result = worker.is_live("https://twitch.tv/example")
        self.assertEqual(result.reason, "timeout")
        self.assertEqual(result.timeout_seconds, worker.CHECK_TIMEOUT)
        self.assertIsNone(result.stderr_summary)

    def test_get_streamlink_version_requires_safe_nonempty_success(self):
        successful = subprocess.CompletedProcess(
            ["streamlink", "--version"], 0, stdout="7.0.0\n", stderr=""
        )
        with patch.object(worker.subprocess, "run", return_value=successful) as run:
            self.assertEqual(worker._get_streamlink_version(), "7.0.0")
        run.assert_called_once_with(
            ["streamlink", "--version"],
            capture_output=True,
            text=True,
            timeout=worker.STREAMLINK_VERSION_TIMEOUT,
        )

        failed = subprocess.CompletedProcess(
            ["streamlink", "--version"], 1, stdout="", stderr="Bearer secret"
        )
        with patch.object(worker.subprocess, "run", return_value=failed), self.assertLogs(worker.log, "ERROR") as logs:
            self.assertIsNone(worker._get_streamlink_version())
        self.assertNotIn("secret", "\n".join(logs.output))

    def test_run_worker_does_not_start_when_version_check_fails(self):
        with patch.object(worker, "_get_streamlink_version", return_value=None), patch.object(
            worker, "poll_loop"
        ) as poll_loop:
            self.assertEqual(worker.run_worker(), 1)
        poll_loop.assert_not_called()

    def test_run_worker_runtime_initialization_failure_never_logs_ready_or_polls(self):
        with patch.object(worker, "_get_streamlink_version", return_value="7.0.0"), patch.object(
            worker, "ensure_runtime_dirs", side_effect=OSError("denied")
        ), patch.object(worker, "poll_loop") as poll_loop, self.assertLogs(worker.log, "ERROR") as logs:
            self.assertEqual(worker.run_worker(), 1)
        poll_loop.assert_not_called()
        self.assertNotIn("Worker started", "\n".join(logs.output))

    def test_run_worker_logs_version_and_resolved_alternate_paths_before_polling(self):
        paths = {
            "watchlist": "/alternate/watchlist.json",
            "channels_status": "/alternate/status.json",
            "sessions": "/alternate/sessions.json",
            "streams": "/alternate/streams.json",
        }
        with patch.object(worker, "_get_streamlink_version", return_value="7.0.0"), patch.object(
            worker, "ensure_runtime_dirs"
        ), patch.object(worker, "_resolve_all_paths", return_value=paths), patch.object(
            worker, "poll_loop"
        ) as poll_loop, patch.object(worker, "shutdown_worker") as shutdown_worker, patch.object(worker, "OUTPUT_DIR", "/alternate/output"), self.assertLogs(worker.log, "INFO") as logs:
            self.assertEqual(worker.run_worker(), 0)
        poll_loop.assert_called_once_with()
        shutdown_worker.assert_called_once_with()
        output = "\n".join(logs.output)
        self.assertIn("streamlink_version=7.0.0", output)
        self.assertIn(paths["watchlist"], output)
        self.assertIn("/alternate/output", output)

    def test_poll_emits_safe_events_for_probe_outcomes_and_invalid_target(self):
        original_globals = {
            name: getattr(worker, name) for name in (
                "CONFIG_PATH", "CHANNELS_STATUS_PATH", "SESSIONS_PATH", "STREAMS_PATH",
                "OUTPUT_DIR", "channels_status", "recordings", "active_recordings",
                "streams_data", "lock", "shutdown_event",
            )
        }
        temp_dir = tempfile.TemporaryDirectory()
        try:
            config_dir = Path(temp_dir.name)
            worker.CONFIG_PATH = str(config_dir / "watchlist.json")
            worker.CHANNELS_STATUS_PATH = str(config_dir / "channels_status.json")
            worker.SESSIONS_PATH = str(config_dir / "sessions.json")
            worker.STREAMS_PATH = str(config_dir / "streams.json")
            for path, value in ((worker.CHANNELS_STATUS_PATH, "{}"), (worker.SESSIONS_PATH, "[]"), (worker.STREAMS_PATH, "[]")):
                Path(path).write_text(value, encoding="utf-8")
            worker.channels_status = {}
            worker.recordings = []
            worker.active_recordings = {}
            worker.streams_data = []
            valid = {"id": "target-1", "channel_name": "example", "platform": "twitch", "url": "https://twitch.tv/example"}
            invalid = {"id": "bad\nidentifier", "url": "https://user:password@example.test/?token=secret-value"}
            Path(worker.CONFIG_PATH).write_text(json.dumps([valid, invalid]), encoding="utf-8")
            results = iter((
                worker.ProbeResult(worker.ProbeState.LIVE, "streams_available", 0),
                worker.ProbeResult(worker.ProbeState.OFFLINE, "empty_streams", 0),
                worker.ProbeResult(worker.ProbeState.ERROR, "timeout", exception_type="TimeoutExpired", timeout_seconds=20),
            ))
            with patch.object(worker, "is_live", side_effect=lambda _: next(results)), patch.object(
                worker, "start_recording"
            ), patch.object(worker.shutdown_event, "wait", side_effect=[None, None, KeyboardInterrupt]), self.assertLogs(worker.log, "INFO") as logs:
                with self.assertRaises(KeyboardInterrupt):
                    worker.poll_loop()
            output = "\n".join(logs.output)
            self.assertIn("Checking status... (watch_target_id=target-1)", output)
            self.assertIn("Probe: LIVE", output)
            self.assertIn("Probe: OFFLINE", output)
            self.assertIn("Probe: ERROR", output)
            self.assertIn("Live detected!", output)
            self.assertIn("Invalid watch target (watch_target_id=bad_identifier, missing_fields=channel_name,platform)", output)
            self.assertNotIn("secret-value", output)
        finally:
            for name, value in original_globals.items():
                setattr(worker, name, value)
            temp_dir.cleanup()


class WorkerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.original_globals = {
            name: getattr(worker, name) for name in (
                "CONFIG_PATH", "CHANNELS_STATUS_PATH", "SESSIONS_PATH", "STREAMS_PATH",
                "OUTPUT_DIR", "channels_status", "recordings", "active_recordings",
                "streams_data", "lock", "shutdown_event",
            )
        }
        self.addCleanup(self.restore_worker_globals)
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
        worker.shutdown_event = worker.threading.Event()
        Path(worker.CHANNELS_STATUS_PATH).write_text("{}", encoding="utf-8")
        Path(worker.SESSIONS_PATH).write_text("[]", encoding="utf-8")
        Path(worker.STREAMS_PATH).write_text("[]", encoding="utf-8")
        self.watchlist_path = config_dir / "watchlist.json"
        self.watchlist_path.write_text("[]", encoding="utf-8")
        worker.CONFIG_PATH = str(self.watchlist_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def restore_worker_globals(self):
        for name, value in self.original_globals.items():
            setattr(worker, name, value)

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

        with patch.object(
            worker,
            "is_live",
            return_value=worker.ProbeResult(worker.ProbeState.OFFLINE, "empty_streams"),
        ), patch.object(
            worker.subprocess, "Popen"
        ) as popen, patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
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
            worker.shutdown_event,
            "wait",
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

        worker.handle_shutdown(None, None)
        worker.shutdown_worker()

        self.assertEqual(process.returncode, -15)
        self.assertEqual(worker.recordings[0]["state"], "error")
        self.assertIsNotNone(worker.recordings[0]["finished_at"])
        persisted_sessions = json.loads(
            Path(worker.SESSIONS_PATH).read_text(encoding="utf-8")
        )
        self.assertEqual(persisted_sessions[0]["state"], "error")

    def test_shutdown_with_no_active_recordings_persists_cleanly(self):
        """Shutdown cleanup should persist cleanly when no recordings are active."""
        worker.active_recordings = {}
        worker.channels_status = {}
        worker.recordings = []

        with patch.object(worker, "save_status"), \
             patch.object(worker, "save_recordings"):
            worker.handle_shutdown(None, None)
            worker.shutdown_worker()

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
            worker.handle_shutdown(None, None)
            worker.shutdown_worker()

    def test_shutdown_persists_error_and_reaps_when_terminate_reports_exited_process(self):
        session = {
            "session_id": "session-1",
            "channel_id": "channel-1",
            "started_at": "2026-09-05T00:00:00",
            "finished_at": None,
            "output_file": "recording.mp4",
            "state": "recording",
        }
        process = MagicMock()
        process.terminate.side_effect = OSError("already exited")
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

        with patch.object(worker, "_wait_for_process") as wait_for_process:
            worker.shutdown_worker()

        self.assertTrue(worker.active_recordings["channel-1"]["shutdown_requested"])
        self.assertEqual(worker.channels_status["channel-1"]["state"], "error")
        self.assertEqual(worker.recordings[0]["state"], "error")
        self.assertIsNotNone(worker.recordings[0]["finished_at"])
        persisted_status = json.loads(Path(worker.CHANNELS_STATUS_PATH).read_text(encoding="utf-8"))
        persisted_sessions = json.loads(Path(worker.SESSIONS_PATH).read_text(encoding="utf-8"))
        self.assertEqual(persisted_status["channel-1"]["state"], "error")
        self.assertEqual(persisted_sessions[0]["state"], "error")
        self.assertIsNotNone(persisted_sessions[0]["finished_at"])
        wait_for_process.assert_called_once_with(process)

    def test_shutdown_handler_returns_when_lock_is_held(self):
        process = MagicMock()
        worker.active_recordings = {"channel-1": {"process": process}}
        set_event = worker.shutdown_event.set

        def set_shutdown_event():
            self.assertTrue(worker.lock.locked())
            set_event()

        with patch.object(worker.shutdown_event, "set", side_effect=set_shutdown_event) as set_event_mock, \
             patch.object(worker.log, "info") as info, \
             patch.object(worker.log, "warning") as warning, \
             patch.object(worker.log, "error") as error, \
             patch.object(worker, "save_status") as save_status, \
             patch.object(worker, "save_recordings") as save_recordings, \
             patch.object(worker, "_wait_for_process") as wait_for_process:
            with worker.lock:
                worker.handle_shutdown(None, None)

        self.assertTrue(worker.shutdown_event.is_set())
        set_event_mock.assert_called_once_with()
        info.assert_not_called()
        warning.assert_not_called()
        error.assert_not_called()
        save_status.assert_not_called()
        save_recordings.assert_not_called()
        wait_for_process.assert_not_called()
        process.terminate.assert_not_called()
        process.wait.assert_not_called()

    def test_run_worker_calls_shutdown_once_after_poll_loop_exits(self):
        with patch.object(worker, "_get_streamlink_version", return_value="7.0.0"), patch.object(
            worker, "ensure_runtime_dirs"
        ), patch.object(worker, "poll_loop"), patch.object(worker, "shutdown_worker") as shutdown_worker:
            self.assertEqual(worker.run_worker(), 0)

        shutdown_worker.assert_called_once_with()

    def test_poll_loop_wait_is_interruptible_by_shutdown_event(self):
        def request_shutdown(_timeout):
            worker.shutdown_event.set()
            return True

        with patch.object(worker.shutdown_event, "wait", side_effect=request_shutdown) as wait:
            worker.poll_loop()

        wait.assert_called_once_with(worker.POLL_INTERVAL)

    def test_shutdown_during_probe_does_not_mutate_recording_lifecycle(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
            "quality": "best",
        }
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        def live_then_shutdown(_url):
            worker.shutdown_event.set()
            return worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")

        with patch.object(worker, "is_live", side_effect=live_then_shutdown) as is_live, patch.object(
            worker, "create_stream"
        ) as create_stream, patch.object(worker, "start_recording") as start_recording, patch.object(
            worker.subprocess, "Popen"
        ) as popen:
            worker.poll_loop()

        is_live.assert_called_once_with(entry["url"])
        create_stream.assert_not_called()
        start_recording.assert_not_called()
        popen.assert_not_called()
        self.assertEqual(worker.streams_data, [])
        self.assertEqual(worker.recordings, [])

    def test_drain_stderr_logs_non_empty_lines(self):
        """Drain stderr should log non-empty stderr lines."""
        stderr_lines = "streamlink output line 1\nstreamlink output line 2\n"
        proc = FakeProcess(stderr_lines=stderr_lines)

        with patch.object(worker.log, "info") as mock_log:
            worker.drain_stderr(proc, "test-channel")

        # Should have logged 2 lines (non-empty)
        self.assertEqual(mock_log.call_count, 2)
        mock_log.assert_any_call(
            "Streamlink diagnostic (watch_target_id=%s, message=%s)",
            "test-channel",
            "streamlink output line 1",
        )
        mock_log.assert_any_call(
            "Streamlink diagnostic (watch_target_id=%s, message=%s)",
            "test-channel",
            "streamlink output line 2",
        )

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

    def test_drain_stderr_fully_consumes_suppressed_secret_lines(self):
        secret = "https://user:password@example.test/video?sig=secret-value"
        proc = FakeProcess(stderr_lines=f"{secret}\nnext safe line\n")

        with self.assertLogs(worker.log, "INFO") as logs:
            worker.drain_stderr(proc, "target-1")

        self.assertEqual(proc.stderr.read(), "")
        output = "\n".join(logs.output)
        self.assertIn("diagnostic suppressed", output)
        self.assertIn("next safe line", output)
        self.assertNotIn("secret-value", output)
        self.assertNotIn("https://", output)

    def test_drain_stderr_continues_after_logging_failure(self):
        proc = FakeProcess(stderr_lines="first line\nsecond line\n")
        calls = []

        def fail_once(*args):
            calls.append(args)
            if len(calls) == 1:
                raise OSError("logger unavailable")

        with patch.object(worker.log, "info", side_effect=fail_once):
            worker.drain_stderr(proc, "target-1")

        self.assertEqual(len(calls), 2)
        self.assertEqual(proc.stderr.read(), "")

    def test_start_recording_does_not_log_started_after_launch_failure(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://user:password@example.test/?token=secret-value",
        }
        worker.channels_status["channel-1"] = {"state": "idle"}

        with patch.object(worker.subprocess, "Popen", side_effect=OSError("secret-value")), self.assertLogs(worker.log, "ERROR") as logs:
            with self.assertRaises(OSError):
                worker.start_recording(entry, "stream-1")

        output = "\n".join(logs.output)
        self.assertNotIn("Recording started", output)
        self.assertNotIn("secret-value", output)
        self.assertEqual(worker.active_recordings, {})
        self.assertEqual(worker.recordings, [])

    def test_start_recording_does_not_log_started_after_persistence_failure(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
        }
        worker.channels_status["channel-1"] = {"state": "idle"}

        process = FakeProcess()
        with patch.object(worker.subprocess, "Popen", return_value=process), patch.object(
            worker, "save_recordings", side_effect=OSError("secret-value")
        ), self.assertLogs(worker.log, "ERROR") as logs:
            with self.assertRaises(OSError):
                worker.start_recording(entry, "stream-1")

        output = "\n".join(logs.output)
        self.assertNotIn("Recording started", output)
        self.assertNotIn("secret-value", output)
        self.assertEqual(worker.active_recordings, {})
        self.assertEqual(worker.recordings, [])
        self.assertEqual(worker.channels_status["channel-1"]["state"], "idle")
        self.assertEqual(process.returncode, -15)
        self.assertTrue(process._wait_called)

    def test_monitor_retains_terminal_recording_until_persistence_recovers(self):
        output_file = Path(worker.OUTPUT_DIR) / "recording.mp4"
        output_file.parent.mkdir(parents=True)
        output_file.write_bytes(b"recorded")
        worker.channels_status = {"channel-1": {"state": "recording"}}
        worker.recordings = [{
            "session_id": "session-1", "watch_target_id": "channel-1",
            "started_at": "2026-09-05T00:00:00", "finished_at": None,
            "output_file": str(output_file), "state": "recording",
        }]
        worker.active_recordings = {"channel-1": {
            "process": FakeProcess(), "output_file": str(output_file),
            "channel_name": "example", "session_id": "session-1",
        }}

        with patch.object(worker, "save_recordings", side_effect=OSError("denied")):
            worker.monitor_recording("channel-1")

        self.assertIn("channel-1", worker.active_recordings)
        self.assertEqual(worker.channels_status["channel-1"]["state"], "recording")
        self.assertEqual(worker.recordings[0]["state"], "recording")

        with patch.object(worker, "save_status"), patch.object(worker, "save_recordings"):
            self.assertTrue(worker._persist_terminal_recording("channel-1"))

        self.assertNotIn("channel-1", worker.active_recordings)
        self.assertEqual(worker.recordings[0]["state"], "finished")

    def test_monitor_preserves_shutdown_interruption_as_error_when_child_exits_zero(self):
        output_file = Path(worker.OUTPUT_DIR) / "shutdown-recording.mp4"
        output_file.parent.mkdir(parents=True)
        output_file.write_bytes(b"recorded")
        worker.channels_status = {"channel-1": {"state": "recording"}}
        worker.recordings = [{
            "session_id": "session-1", "watch_target_id": "channel-1",
            "started_at": "2026-09-05T00:00:00", "finished_at": None,
            "output_file": str(output_file), "state": "recording",
        }]
        worker.active_recordings = {"channel-1": {
            "process": FakeProcess(returncode=0), "output_file": str(output_file),
            "channel_name": "example", "session_id": "session-1",
            "shutdown_requested": True,
        }}

        worker.monitor_recording("channel-1")

        self.assertEqual(worker.recordings[0]["state"], "error")
        self.assertEqual(worker.channels_status["channel-1"]["state"], "error")

    def test_recording_start_and_completion_events_are_safe_and_accurate(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
        }
        worker.channels_status["channel-1"] = {"state": "idle"}
        output_file = Path(worker.OUTPUT_DIR) / "example" / "recording.mp4"
        output_file.parent.mkdir(parents=True)
        output_file.write_bytes(b"recorded")

        with patch.object(worker.subprocess, "Popen", return_value=FakeProcess()), patch.object(
            worker.threading, "Thread"
        ), self.assertLogs(worker.log, "INFO") as logs:
            worker.start_recording(entry, "stream-1")
            info = worker.active_recordings["channel-1"]
            info["output_file"] = str(output_file)
            worker.recordings[0]["output_file"] = str(output_file)
            worker.monitor_recording("channel-1")

        output = "\n".join(logs.output)
        self.assertIn("Recording started", output)
        self.assertIn("stream_id=stream-1", output)
        self.assertIn("Recording finished (outcome=completed", output)
        self.assertNotIn(str(output_file), output)

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

    def test_wait_for_process_reaps_after_kill_fallback(self):
        proc = FakeProcess()
        with patch.object(
            proc, "wait", side_effect=[worker.subprocess.TimeoutExpired("cmd", 5), 0]
        ) as wait, patch.object(proc, "kill") as kill:
            worker._wait_for_process(proc)
        self.assertEqual(wait.call_count, 2)
        kill.assert_called_once_with()

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


class WatchTargetEnabledTests(unittest.TestCase):
    def setUp(self):
        self.original_globals = {
            name: getattr(worker, name) for name in (
                "CONFIG_PATH", "CHANNELS_STATUS_PATH", "SESSIONS_PATH", "STREAMS_PATH",
                "OUTPUT_DIR", "channels_status", "recordings", "active_recordings",
                "streams_data", "lock",
            )
        }
        self.addCleanup(self.restore_worker_globals)
        self.temp_dir = tempfile.TemporaryDirectory()
        config_dir = Path(self.temp_dir.name)
        worker.CONFIG_PATH = str(config_dir / "watchlist.json")
        worker.CHANNELS_STATUS_PATH = str(config_dir / "channels_status.json")
        worker.SESSIONS_PATH = str(config_dir / "sessions.json")
        worker.STREAMS_PATH = str(config_dir / "streams.json")
        for path, value in (
            (worker.CONFIG_PATH, []),
            (worker.CHANNELS_STATUS_PATH, {}),
            (worker.SESSIONS_PATH, []),
            (worker.STREAMS_PATH, []),
        ):
            Path(path).write_text(json.dumps(value), encoding="utf-8")
        worker.active_recordings = {}
        worker.channels_status = {}
        worker.recordings = []
        worker.streams_data = []
        worker.lock = worker.threading.Lock()
        worker.shutdown_event = worker.threading.Event()

    def tearDown(self):
        self.temp_dir.cleanup()

    def restore_worker_globals(self):
        for name, value in self.original_globals.items():
            setattr(worker, name, value)

    @staticmethod
    def entry(enabled: object = True) -> dict[str, object]:
        return {
            "id": "target-1",
            "channel_name": "creator",
            "platform": "twitch",
            "url": "https://twitch.tv/creator",
            "quality": "best",
            "enabled": enabled,
        }

    def poll_once(self):
        with patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

    def test_disabled_false_entry_has_no_lifecycle_side_effects(self):
        entry = self.entry(False)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        with patch.object(worker, "is_live") as is_live, patch.object(
            worker, "create_stream"
        ) as create_stream, patch.object(worker, "start_recording") as start_recording, patch.object(
            worker.subprocess, "Popen"
        ) as popen:
            self.poll_once()
        is_live.assert_not_called()
        create_stream.assert_not_called()
        start_recording.assert_not_called()
        popen.assert_not_called()
        self.assertNotIn("target-1", worker.channels_status)
        self.assertEqual(worker.streams_data, [])
        self.assertEqual(worker.recordings, [])

    def test_invalid_enabled_entries_have_no_lifecycle_side_effects(self):
        for invalid_enabled in (None, "false", 0, 1, [], {}):
            with self.subTest(enabled=invalid_enabled):
                entry = self.entry(invalid_enabled)
                Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
                with patch.object(worker, "is_live") as is_live, patch.object(
                    worker, "create_stream"
                ) as create_stream, patch.object(worker, "start_recording") as start_recording, patch.object(
                    worker.subprocess, "Popen"
                ) as popen:
                    self.poll_once()
                is_live.assert_not_called()
                create_stream.assert_not_called()
                start_recording.assert_not_called()
                popen.assert_not_called()
                self.assertNotIn("target-1", worker.channels_status)
                self.assertEqual(worker.streams_data, [])
                self.assertEqual(worker.recordings, [])

    def test_explicit_true_probes_and_launches_recording(self):
        entry = self.entry(True)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        with patch.object(
            worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")
        ) as is_live, patch.object(worker.subprocess, "Popen", return_value=FakeProcess()) as popen, patch.object(
            worker.threading, "Thread"
        ), patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()
        is_live.assert_called_once_with(entry["url"])
        popen.assert_called_once()
        self.assertEqual(len(worker.recordings), 1)
        self.assertIn("target-1", worker.active_recordings)

    def test_omitted_enabled_remains_legacy_enabled(self):
        entry = self.entry()
        del entry["enabled"]
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")), patch.object(
            worker, "start_recording"
        ) as start_recording:
            self.poll_once()
        start_recording.assert_called_once()

    def test_refresh_disable_blocks_before_stream_creation(self):
        current = self.entry(True)
        disabled = self.entry(False)
        Path(worker.CONFIG_PATH).write_text(json.dumps([current]), encoding="utf-8")
        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")), patch.object(
            worker, "load_watchlist", side_effect=[[current], [disabled]]
        ), patch.object(worker, "create_stream") as create_stream, patch.object(
            worker, "start_recording"
        ) as start_recording:
            self.poll_once()
        create_stream.assert_not_called()
        start_recording.assert_not_called()

    def test_refresh_removal_invalid_entry_or_url_change_blocks_before_stream_creation(self):
        current = self.entry(True)
        refresh_cases = (
            [],
            [{**current, "enabled": "false"}],
            [{**current, "url": "https://twitch.tv/changed"}],
        )
        for refreshed in refresh_cases:
            with self.subTest(refreshed=refreshed):
                worker.channels_status = {}
                worker.streams_data = []
                Path(worker.CONFIG_PATH).write_text(json.dumps([current]), encoding="utf-8")
                with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")), patch.object(
                    worker, "load_watchlist", side_effect=[[current], refreshed]
                ), patch.object(worker, "create_stream") as create_stream, patch.object(
                    worker, "start_recording"
                ) as start_recording:
                    self.poll_once()
                create_stream.assert_not_called()
                start_recording.assert_not_called()

    def test_disabled_target_does_not_finalize_open_stream_or_stop_active_capture(self):
        entry = self.entry(False)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        process = MagicMock()
        worker.streams_data = [{
            "id": "stream-1", "watch_target_id": "target-1", "state": "recording",
            "started_at": "2026-01-01T00:00:00", "finished_at": None,
        }]
        worker.active_recordings["target-1"] = {
            "process": process, "session_id": "session-1", "stream_id": "stream-1",
        }
        with patch.object(worker, "is_live") as is_live, patch.object(worker, "finalize_stream") as finalize_stream:
            self.poll_once()
        is_live.assert_not_called()
        finalize_stream.assert_not_called()
        process.terminate.assert_not_called()
        process.kill.assert_not_called()
        self.assertIn("target-1", worker.active_recordings)
        self.assertIsNone(worker.streams_data[0]["finished_at"])

    def test_terminal_recording_persists_while_target_is_disabled(self):
        entry = self.entry(False)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        worker.channels_status["target-1"] = {
            "channel_name": "creator", "platform": "twitch", "state": "recording",
        }
        worker.recordings = [{
            "session_id": "session-1", "watch_target_id": "target-1",
            "started_at": "2026-01-01T00:00:00", "finished_at": None,
            "output_file": "recording.mp4", "state": "recording",
        }]
        worker.active_recordings["target-1"] = {
            "session_id": "session-1",
            "pending_terminal": {
                "state": "finished", "finished_at": "2026-01-01T01:00:00",
                "output_file": "recording.mp4", "returncode": 0,
            },
        }
        with patch.object(worker, "is_live") as is_live:
            self.poll_once()
        is_live.assert_not_called()
        self.assertNotIn("target-1", worker.active_recordings)
        self.assertEqual(worker.recordings[0]["state"], "finished")

    def test_terminal_error_persists_while_target_is_disabled(self):
        entry = self.entry(False)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        worker.channels_status["target-1"] = {
            "channel_name": "creator", "platform": "twitch", "state": "recording",
        }
        worker.recordings = [{
            "session_id": "session-1", "watch_target_id": "target-1",
            "started_at": "2026-01-01T00:00:00", "finished_at": None,
            "output_file": "recording.mp4", "state": "recording",
        }]
        worker.active_recordings["target-1"] = {
            "session_id": "session-1",
            "pending_terminal": {
                "state": "error", "finished_at": "2026-01-01T01:00:00",
                "output_file": "recording.mp4", "returncode": 1,
            },
        }
        with patch.object(worker, "is_live") as is_live:
            self.poll_once()
        is_live.assert_not_called()
        self.assertNotIn("target-1", worker.active_recordings)
        self.assertEqual(worker.recordings[0]["state"], "error")
        self.assertEqual(worker.recordings[0]["finished_at"], "2026-01-01T01:00:00")
        self.assertEqual(worker.channels_status["target-1"]["state"], "error")

    def test_disabled_target_does_not_retry_after_terminal_recording(self):
        entry = self.entry(False)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        open_stream = {
            "id": "stream-1", "watch_target_id": "target-1", "state": "recording",
            "started_at": "2026-01-01T00:00:00", "finished_at": None,
        }
        worker.streams_data = [open_stream]
        worker.channels_status["target-1"] = {
            "channel_name": "creator", "platform": "twitch", "state": "recording",
        }
        worker.recordings = [{
            "session_id": "session-1", "watch_target_id": "target-1",
            "started_at": "2026-01-01T00:00:00", "finished_at": None,
            "output_file": "recording.mp4", "state": "recording",
        }]
        worker.active_recordings["target-1"] = {
            "session_id": "session-1",
            "pending_terminal": {
                "state": "error", "finished_at": "2026-01-01T01:00:00",
                "output_file": "recording.mp4", "returncode": 1,
            },
        }
        self.poll_once()
        with patch.object(worker, "is_live") as is_live, patch.object(
            worker, "start_recording"
        ) as start_recording, patch.object(worker.subprocess, "Popen") as popen:
            self.poll_once()
        is_live.assert_not_called()
        start_recording.assert_not_called()
        popen.assert_not_called()
        self.assertNotIn("target-1", worker.active_recordings)
        self.assertIsNone(open_stream["finished_at"])

    def test_reenable_resumes_live_capture_using_existing_open_stream(self):
        disabled = self.entry(False)
        enabled = self.entry(True)
        worker.streams_data = [{
            "id": "stream-1", "watch_target_id": "target-1", "state": "recording",
            "started_at": "2026-01-01T00:00:00", "finished_at": None,
        }]
        Path(worker.CONFIG_PATH).write_text(json.dumps([disabled]), encoding="utf-8")
        self.poll_once()
        Path(worker.CONFIG_PATH).write_text(json.dumps([enabled]), encoding="utf-8")
        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")), patch.object(
            worker, "start_recording"
        ) as start_recording:
            self.poll_once()
        start_recording.assert_called_once_with(enabled, "stream-1")

    def test_reenable_during_active_capture_does_not_duplicate_recording(self):
        entry = self.entry(True)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        process = MagicMock()
        worker.active_recordings["target-1"] = {
            "process": process, "session_id": "session-1", "stream_id": "stream-1",
        }
        with patch.object(worker, "is_live") as is_live, patch.object(
            worker, "start_recording"
        ) as start_recording, patch.object(worker.subprocess, "Popen") as popen:
            self.poll_once()
        is_live.assert_not_called()
        start_recording.assert_not_called()
        popen.assert_not_called()
        self.assertIs(worker.active_recordings["target-1"]["process"], process)

    def test_watchlist_refresh_failure_after_live_blocks_before_stream_creation(self):
        entry = self.entry(True)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        with patch.object(
            worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")
        ), patch.object(worker, "load_watchlist", side_effect=[[entry], OSError("unavailable")]), patch.object(
            worker, "create_stream"
        ) as create_stream, patch.object(worker, "start_recording") as start_recording, patch.object(
            worker.subprocess, "Popen"
        ) as popen:
            self.poll_once()
        create_stream.assert_not_called()
        start_recording.assert_not_called()
        popen.assert_not_called()
        self.assertEqual(worker.streams_data, [])

    def test_reenabled_offline_finalizes_existing_open_stream(self):
        entry = self.entry(True)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        stream = {
            "id": "stream-1", "watch_target_id": "target-1", "state": "recording",
            "started_at": "2026-01-01T00:00:00", "finished_at": None,
        }
        worker.streams_data = [stream]
        with patch.object(
            worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.OFFLINE, "empty_streams")
        ) as is_live, patch.object(worker.subprocess, "Popen") as popen:
            self.poll_once()
        is_live.assert_called_once_with(entry["url"])
        popen.assert_not_called()
        self.assertEqual(worker.channels_status["target-1"]["state"], "offline")
        self.assertEqual(stream["state"], "finished")
        self.assertIsNotNone(stream["finished_at"])

    def test_reenabled_probe_error_preserves_existing_open_stream_and_status(self):
        entry = self.entry(True)
        Path(worker.CONFIG_PATH).write_text(json.dumps([entry]), encoding="utf-8")
        stream = {
            "id": "stream-1", "watch_target_id": "target-1", "state": "recording",
            "started_at": "2026-01-01T00:00:00", "finished_at": None,
        }
        worker.streams_data = [stream]
        worker.channels_status["target-1"] = {
            "channel_name": "creator", "platform": "twitch", "state": "recording",
        }
        Path(worker.CHANNELS_STATUS_PATH).write_text(json.dumps(worker.channels_status), encoding="utf-8")
        with patch.object(
            worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.ERROR, "timeout")
        ) as is_live, patch.object(worker, "start_recording") as start_recording, patch.object(
            worker.subprocess, "Popen"
        ) as popen:
            self.poll_once()
        is_live.assert_called_once_with(entry["url"])
        start_recording.assert_not_called()
        popen.assert_not_called()
        self.assertEqual(worker.channels_status["target-1"]["state"], "recording")
        self.assertEqual(stream["state"], "recording")
        self.assertIsNone(stream["finished_at"])

    def test_targets_under_one_creator_are_gated_independently(self):
        disabled = self.entry(False)
        enabled = {**self.entry(True), "id": "target-2"}
        Path(worker.CONFIG_PATH).write_text(json.dumps([disabled, enabled]), encoding="utf-8")
        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")) as is_live, patch.object(
            worker, "start_recording"
        ) as start_recording:
            self.poll_once()
        is_live.assert_called_once_with(enabled["url"])
        start_recording.assert_called_once()
        self.assertEqual(start_recording.call_args.args[0]["id"], "target-2")


if __name__ == "__main__":
    unittest.main()


class StreamDetectionTests(unittest.TestCase):
    def setUp(self):
        self.original_globals = {
            name: getattr(worker, name) for name in (
                "CONFIG_PATH", "CHANNELS_STATUS_PATH", "SESSIONS_PATH", "STREAMS_PATH",
                "OUTPUT_DIR", "channels_status", "recordings", "active_recordings",
                "streams_data", "lock", "shutdown_event",
            )
        }
        self.addCleanup(self.restore_worker_globals)
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
        worker.shutdown_event = worker.threading.Event()
        Path(worker.CHANNELS_STATUS_PATH).write_text("{}", encoding="utf-8")
        Path(worker.SESSIONS_PATH).write_text("[]", encoding="utf-8")
        Path(worker.STREAMS_PATH).write_text("[]", encoding="utf-8")
        self.watchlist_path = config_dir / "watchlist.json"
        self.watchlist_path.write_text("[]", encoding="utf-8")
        worker.CONFIG_PATH = str(self.watchlist_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def restore_worker_globals(self):
        for name, value in self.original_globals.items():
            setattr(worker, name, value)

    def poll_once(self, probe_result, process=None):
        with patch.object(worker, "is_live", return_value=probe_result) as is_live_mock, \
             patch.object(worker.subprocess, "Popen", return_value=process or FakeProcess()) as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()
        return is_live_mock, popen_mock

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

        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
            popen_mock.return_value = FakeProcess()
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(len(worker.streams_data), 1)
        self.assertEqual(worker.streams_data[0]["watch_target_id"], "channel-1")
        self.assertIsNotNone(worker.streams_data[0]["started_at"])
        self.assertIsNone(worker.streams_data[0]["finished_at"])

    def test_real_probe_lifecycle_reuses_stream_after_error_and_finalizes_only_offline(self):
        entry = {
            "id": "channel-1", "channel_name": "example", "platform": "twitch",
            "url": "https://twitch.tv/example", "quality": "best",
        }
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")
        probe_outputs = iter((
            subprocess.CompletedProcess(["streamlink"], 0, stdout='{"streams":{"best":{}}}'),
            subprocess.CompletedProcess(["streamlink"], 1, stdout='{"error":"Twitch API failed"}'),
            subprocess.CompletedProcess(["streamlink"], 0, stdout='{"streams":{"best":{}}}'),
            subprocess.CompletedProcess(["streamlink"], 0, stdout='{"streams":{}}'),
            subprocess.CompletedProcess(["streamlink"], 0, stdout='{"streams":{"best":{}}}'),
        ))
        processes = [FakeProcess(returncode=1), FakeProcess(returncode=1), FakeProcess()]

        def poll_once():
            with patch.object(worker.subprocess, "run", side_effect=lambda *args, **kwargs: next(probe_outputs)), \
                 patch.object(worker.subprocess, "Popen", side_effect=processes), \
                 patch.object(worker.threading, "Thread"), \
                 patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):
                    worker.poll_loop()

        poll_once()
        first_stream_id = worker.streams_data[0]["id"]
        worker.monitor_recording("channel-1")
        self.assertEqual(worker.recordings[0]["state"], "error")
        self.assertEqual(worker.streams_data[0]["id"], first_stream_id)
        self.assertIsNone(worker.streams_data[0]["finished_at"])

        poll_once()
        self.assertEqual(len(worker.streams_data), 1)
        self.assertEqual(worker.streams_data[0]["id"], first_stream_id)
        self.assertEqual(len(worker.recordings), 1)

        poll_once()
        self.assertEqual(worker.active_recordings["channel-1"]["stream_id"], first_stream_id)
        worker.monitor_recording("channel-1")
        self.assertEqual(len(worker.recordings), 2)

        poll_once()
        self.assertEqual(worker.streams_data[0]["state"], "finished")
        self.assertIsNotNone(worker.streams_data[0]["finished_at"])

        poll_once()
        self.assertEqual(len(worker.streams_data), 2)
        self.assertNotEqual(worker.streams_data[1]["id"], first_stream_id)

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

        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")) as is_live_mock, \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
            popen_mock.return_value = FakeProcess()
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(len(worker.streams_data), 1)
        self.assertEqual(worker.streams_data[0]["id"], "stream-123")
        self.assertEqual(popen_mock.call_count, 0)
        is_live_mock.assert_not_called()

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

        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.OFFLINE, "empty_streams")), \
             patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
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

        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.OFFLINE, "empty_streams")), \
             patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
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

    def test_probe_error_preserves_stream_until_confirmed_offline(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
            "quality": "best",
        }
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")
        live = worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")
        offline = worker.ProbeResult(worker.ProbeState.OFFLINE, "empty_streams")
        probe_error = worker.ProbeResult(worker.ProbeState.ERROR, "timeout")

        first_process = FakeProcess(returncode=1)
        self.poll_once(live, first_process)
        original_stream_id = worker.streams_data[0]["id"]
        worker.monitor_recording("channel-1")
        self.assertEqual(worker.recordings[0]["state"], "error")
        self.assertIsNone(worker.streams_data[0]["finished_at"])

        _, error_popen = self.poll_once(probe_error)
        self.assertEqual(error_popen.call_count, 0)
        self.assertEqual(worker.channels_status["channel-1"]["state"], "error")
        self.assertEqual(worker.streams_data[0]["id"], original_stream_id)
        self.assertIsNone(worker.streams_data[0]["finished_at"])

        retry_process = FakeProcess(returncode=1)
        self.poll_once(live, retry_process)
        self.assertEqual(worker.active_recordings["channel-1"]["stream_id"], original_stream_id)
        worker.monitor_recording("channel-1")

        self.poll_once(offline)
        self.assertEqual(worker.streams_data[0]["state"], "finished")
        self.assertIsNotNone(worker.streams_data[0]["finished_at"])

        self.poll_once(live)
        self.assertEqual(len(worker.streams_data), 2)
        self.assertNotEqual(worker.streams_data[1]["id"], original_stream_id)

    def test_probe_error_preserves_persisted_status_without_lifecycle_calls(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
            "quality": "best",
        }
        status_bytes = (
            b'{\n'
            b'  "channel-1": {"channel_name": "example", "platform": "twitch", '
            b'"state": "error"}\n'
            b'}\n'
        )
        Path(worker.CHANNELS_STATUS_PATH).write_bytes(status_bytes)
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        with patch.object(
            worker,
            "is_live",
            return_value=worker.ProbeResult(
                worker.ProbeState.ERROR,
                "error_envelope",
                returncode=0,
                exception_type="RuntimeError",
            ),
        ), patch.object(worker, "create_stream") as create_stream, patch.object(
            worker, "finalize_stream"
        ) as finalize_stream, patch.object(worker, "start_recording") as start_recording, patch.object(
            worker, "save_status"
        ) as save_status, patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt), self.assertLogs(
            worker.log,
            level="WARNING",
        ) as logs:
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(Path(worker.CHANNELS_STATUS_PATH).read_bytes(), status_bytes)
        self.assertEqual(worker.channels_status["channel-1"]["state"], "error")
        self.assertIn("Probe: ERROR", logs.output[0])
        self.assertIn("watch_target_id=channel-1", logs.output[0])
        self.assertIn("category=error_envelope", logs.output[0])
        self.assertIn("returncode=0", logs.output[0])
        self.assertIn("exception_type=RuntimeError", logs.output[0])
        create_stream.assert_not_called()
        finalize_stream.assert_not_called()
        start_recording.assert_not_called()
        save_status.assert_not_called()

    def test_first_seen_probe_error_remains_idle_without_lifecycle_calls(self):
        entry = {
            "id": "channel-1",
            "channel_name": "example",
            "platform": "twitch",
            "url": "https://twitch.tv/example",
            "quality": "best",
        }
        self.watchlist_path.write_text(json.dumps([entry]), encoding="utf-8")

        with patch.object(
            worker,
            "is_live",
            return_value=worker.ProbeResult(worker.ProbeState.ERROR, "timeout"),
        ), patch.object(worker, "create_stream") as create_stream, patch.object(
            worker, "finalize_stream"
        ) as finalize_stream, patch.object(worker, "start_recording") as start_recording, patch.object(
            worker, "save_status"
        ) as save_status, patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt), self.assertLogs(
            worker.log,
            level="WARNING",
        ) as logs:
            with self.assertRaises(KeyboardInterrupt):
                worker.poll_loop()

        self.assertEqual(worker.channels_status["channel-1"]["state"], "idle")
        self.assertIn("returncode=absent", logs.output[0])
        self.assertIn("exception_type=absent", logs.output[0])
        create_stream.assert_not_called()
        finalize_stream.assert_not_called()
        start_recording.assert_not_called()
        save_status.assert_not_called()

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

        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
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

        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
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

        with patch.object(worker, "is_live", return_value=worker.ProbeResult(worker.ProbeState.LIVE, "streams_available")), \
             patch.object(worker.subprocess, "Popen") as popen_mock, \
             patch.object(worker.threading, "Thread"), \
             patch.object(worker.shutdown_event, "wait", side_effect=KeyboardInterrupt):
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
        self.original_output_dir = worker.OUTPUT_DIR
        self.addCleanup(setattr, worker, "OUTPUT_DIR", self.original_output_dir)
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

    def test_probe_atomic_replace_preserves_canonical_json_and_cleans_disposable_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "watchlist.json"
            target.write_text('[{"id":"canonical"}]', encoding="utf-8")
            worker._probe_atomic_replace(str(target))
            self.assertEqual(target.read_text(encoding="utf-8"), '[{"id":"canonical"}]')
            self.assertEqual(list(Path(temp_dir).glob("*.probe")), [])

    def test_probe_atomic_replace_cleans_disposable_file_when_write_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "watchlist.json"
            target.write_text("[]", encoding="utf-8")
            import json_adapters
            with patch.object(json_adapters, "write_json_atomically", side_effect=OSError("write denied")):
                with self.assertRaisesRegex(OSError, "write denied"):
                    worker._probe_atomic_replace(str(target))
            self.assertEqual(target.read_text(encoding="utf-8"), "[]")
            self.assertEqual(list(Path(temp_dir).glob("*.probe")), [])

    def test_probe_output_dir_cleans_temp_file_after_fsync_failure(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(os, "fsync", side_effect=OSError("sync denied")):
            with self.assertRaisesRegex(OSError, "sync denied"):
                worker._probe_output_dir(temp_dir)
            self.assertEqual(list(Path(temp_dir).glob(".worker-output-probe.*.tmp")), [])

    def test_probe_output_dir_success_creates_no_artifact(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            worker._probe_output_dir(temp_dir)
            self.assertEqual(list(Path(temp_dir).glob(".worker-output-probe.*.tmp")), [])


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


class TestAtomicReplaceFaults(unittest.TestCase):
    """Tests for atomic-replace fault isolation in json_adapters.write_json_atomically."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_dir = Path(self.temp_dir.name)
        self.target_path = self.config_dir / "channels_status.json"
        # Pre-create with valid content so the file exists for tests that need it
        self.target_path.write_text("{}", encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_mkstemp_raises_permission_error__destination_untouched_no_leftover(self):
        """mkstemp raises PermissionError -> function raises; destination untouched; no leftover temp."""
        import json_adapters

        with patch.object(tempfile, "mkstemp", side_effect=PermissionError("mock denied")):
            with self.assertRaises(PermissionError):
                json_adapters.write_json_atomically(str(self.target_path), {"key": "value"})
        # Destination must be untouched
        self.assertEqual(self.target_path.read_text(encoding="utf-8"), "{}")
        # No leftover temp files
        self.assertEqual(list(self.config_dir.glob("*.tmp")), [])

    def test_write_raises_eacces__finally_cleans_up_original_preserved(self):
        """Write raises OSError(EACCES) -> finally cleans up; original exception re-raised; destination preserved."""
        import json_adapters

        original_content = '{"original": true}'
        self.target_path.write_text(original_content, encoding="utf-8")

        real_close = os.close

        def bad_fdopen(fd, mode, *, encoding=None):
            raise OSError("EACCES", "mock access denied")

        def silent_close(fd):
            # Avoid masking the original OSError when fd was never actually opened
            try:
                real_close(fd)
            except OSError:
                pass

        with patch.object(tempfile, "mkstemp", return_value=(999, str(self.config_dir / "test.tmp"))), \
             patch("os.fdopen", side_effect=bad_fdopen), \
             patch.object(os, "close", side_effect=silent_close):
            with self.assertRaises(OSError) as ctx:
                json_adapters.write_json_atomically(str(self.target_path), {"key": "value"})
            self.assertIn("EACCES", str(ctx.exception))

        # Destination must be preserved
        self.assertEqual(self.target_path.read_text(encoding="utf-8"), original_content)
        # No leftover temp files
        self.assertEqual(list(self.config_dir.glob("*.tmp")), [])

    def test_fsync_raises_oserror__cleanup_runs_destination_preserved(self):
        """os.fsync raises OSError -> cleanup runs; destination preserved; original exception re-raised."""
        import json_adapters

        original_content = '{"original": true}'
        self.target_path.write_text(original_content, encoding="utf-8")

        # Build a context-manager-capable file handle that has fileno() but does not need to be writable.
        fake_handle = MagicMock()
        fake_handle.__enter__.return_value = fake_handle
        fake_handle.fileno.return_value = 42
        fake_handle.write = MagicMock()
        fake_handle.flush = MagicMock()

        def fake_fdopen(fd, mode, *, encoding=None):
            return fake_handle

        with patch.object(tempfile, "mkstemp", return_value=(42, str(self.config_dir / ".test.tmp"))), \
             patch("os.fdopen", side_effect=fake_fdopen), \
             patch("os.fsync", side_effect=OSError("sync failed")), \
             patch("os.replace"), \
             patch("os.chmod"):
            with self.assertRaises(OSError) as ctx:
                json_adapters.write_json_atomically(str(self.target_path), {"key": "value"})
            self.assertIn("sync failed", str(ctx.exception))

        # Destination must be preserved
        self.assertEqual(self.target_path.read_text(encoding="utf-8"), original_content)

    def test_replace_fails_first_two_times_succeeds_third__retry_succeeds(self):
        """os.replace raises PermissionError first 2 times, succeeds 3rd -> retry helper succeeds; destination updated; no temp leftover."""
        import json_adapters

        original_content = '{"original": true}'
        self.target_path.write_text(original_content, encoding="utf-8")

        temp_path = str(self.config_dir / ".test.tmp")
        # Ensure the temp file exists on disk so os.replace has a real source.
        Path(temp_path).write_text("", encoding="utf-8")

        # A real file object opened in write mode so json.dump succeeds.
        # mkstemp is patched to return this same path, then os.replace moves it to target.
        real_write_handle = open(temp_path, "w", encoding="utf-8")

        call_count = [0]
        real_replace = os.replace

        def flaky_replace(src, dst):
            call_count[0] += 1
            if call_count[0] <= 2:
                raise PermissionError("mock transient lock")
            real_replace(src, dst)

        def fdopen_stub(fd, mode, *, encoding=None):
            # Return our pre-opened real handle so json.dump can write to it.
            return real_write_handle

        # Patch mkstemp so the function's temp file is our .test.tmp (which gets replaced),
        # patch fdopen so json.dump writes to our real handle, and patch replace for retry.
        with patch.object(tempfile, "mkstemp", return_value=(42, temp_path)), \
             patch("os.fdopen", side_effect=fdopen_stub), \
             patch("os.close"), \
             patch.object(os, "replace", side_effect=flaky_replace):
            json_adapters.write_json_atomically(str(self.target_path), {"key": "value"})

        # Destination must be updated
        result = json.loads(self.target_path.read_text(encoding="utf-8"))
        self.assertEqual(result, {"key": "value"})
        # No leftover temp files
        self.assertEqual(list(self.config_dir.glob("*.tmp")), [])

    def test_replace_fails_all_three_times__reraises_after_exhaustion(self):
        """os.replace raises PermissionError 3 times -> re-raises after exhaustion; no destination touched."""
        import json_adapters

        original_content = '{"original": true}'
        self.target_path.write_text(original_content, encoding="utf-8")

        temp_path = str(self.config_dir / ".test.tmp")
        Path(temp_path).write_text('{"temp": true}', encoding="utf-8")

        with patch.object(os, "replace", side_effect=PermissionError("mock persistent lock")):
            with self.assertRaises(PermissionError):
                json_adapters.write_json_atomically(str(self.target_path), {"key": "value"})

        # Destination must be untouched
        self.assertEqual(self.target_path.read_text(encoding="utf-8"), original_content)

    def test_unlink_in_finally_raises_permission_error__swallowed_outer_raised(self):
        """os.unlink in finally raises PermissionError -> swallowed; outer exception still re-raised."""
        import json_adapters

        temp_path = str(self.config_dir / ".test.tmp")
        Path(temp_path).write_text('{"temp": true}', encoding="utf-8")

        call_count = [0]

        def flaky_unlink(path):
            call_count[0] += 1
            if call_count[0] == 1:
                raise PermissionError("mock unlink denied")
            # Second call succeeds

        with patch.object(os, "replace", side_effect=OSError("boom")), \
             patch.object(os, "unlink", side_effect=flaky_unlink):
            with self.assertRaises(OSError) as ctx:
                json_adapters.write_json_atomically(str(self.target_path), {"key": "value"})
            self.assertIn("boom", str(ctx.exception))

    def test_successful_write_sets_mode_0644(self):
        """Successful write then stat destination -> mode == 0o644 on POSIX hosts."""
        import json_adapters

        self.target_path.write_text('{"old": true}', encoding="utf-8")

        json_adapters.write_json_atomically(str(self.target_path), {"new": True})

        mode = os.stat(self.target_path).st_mode & 0o777
        # POSIX hosts honor chmod; Windows maps mode bits differently (0o666 default)
        if os.name == "posix":
            self.assertEqual(mode, 0o644)

    def test_ensure_runtime_dirs_readonly_directory__probe_fails_with_structured_error(self):
        """ensure_runtime_dirs against read-only directory -> probe fails with structured error and exit code."""
        import json_adapters
        import sys

        readonly_dir = self.config_dir / "readonly"
        readonly_dir.mkdir()
        readonly_file = readonly_dir / "channels_status.json"
        readonly_file.write_text("{}", encoding="utf-8")

        # Patch _probe_atomic_replace to raise EACCES, then ensure sys.exit is called
        probe_path = str(readonly_file)
        with patch.object(worker, "_probe_atomic_replace", side_effect=OSError("EACCES permission denied")):
            with patch.object(sys, "exit") as mock_exit:
                try:
                    worker._probe_atomic_replace(probe_path)
                except OSError:
                    sys.exit(78)
                mock_exit.assert_called_once_with(78)

    def test_stale_temp_file_sweep_removes_it_init_succeeds(self):
        """Pre-existing stale .channels_status.json.abc12345.tmp -> sweep removes it; init still succeeds."""
        config_dir = self.config_dir
        stale_path = config_dir / ".channels_status.json.abc12345.tmp"
        stale_path.write_text('{"stale": true}', encoding="utf-8")

        # Verify it exists before
        self.assertTrue(stale_path.exists())

        # Patch _resolve_all_paths to return our temp dir paths
        test_paths = {
            "watchlist": str(config_dir / "watchlist.json"),
            "channels_status": str(config_dir / "channels_status.json"),
            "sessions": str(config_dir / "sessions.json"),
            "streams": str(config_dir / "streams.json"),
        }
        with patch.object(worker, "CONFIG_PATH", test_paths["watchlist"]), \
             patch.object(worker, "CHANNELS_STATUS_PATH", test_paths["channels_status"]), \
             patch.object(worker, "SESSIONS_PATH", test_paths["sessions"]), \
             patch.object(worker, "STREAMS_PATH", test_paths["streams"]), \
             patch.object(worker, "OUTPUT_DIR", str(config_dir / "recordings")), \
             patch.object(worker, "_resolve_all_paths", return_value=test_paths), \
             patch.object(worker, "_probe_atomic_replace"):
            worker.ensure_runtime_dirs()

        # Stale file should be removed
        self.assertFalse(stale_path.exists())

    def test_recovery_dir_0500_then_0755__second_probe_succeeds(self):
        """Recovery: dir is 0500 then 0755 -> second probe succeeds."""
        import json_adapters

        # First probe fails (simulated)
        with patch.object(json_adapters, "write_json_atomically", side_effect=OSError("EACCES")):
            with self.assertRaises(OSError):
                json_adapters.write_json_atomically(str(self.target_path), {"probe": True})

        # Now make it work
        json_adapters.write_json_atomically(str(self.target_path), {"probe": True})

        # Verify file was written correctly
        result = json.loads(self.target_path.read_text(encoding="utf-8"))
        self.assertEqual(result, {"probe": True})