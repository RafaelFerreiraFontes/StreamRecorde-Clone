"""Small compatibility boundaries for the active shared JSON files."""

import json
import os
import tempfile
import time


_READ_ATTEMPTS = 3


def _read_json(path, empty_value, expected_type):
    for attempt in range(_READ_ATTEMPTS):
        try:
            with open(path, "r", encoding="utf-8") as file_handle:
                value = json.load(file_handle)
            if not isinstance(value, expected_type):
                raise ValueError("JSON file has an invalid shape: {}".format(path))
            return value
        except FileNotFoundError:
            return empty_value
        except (json.JSONDecodeError, OSError) as error:
            if attempt == _READ_ATTEMPTS - 1:
                raise error
            time.sleep(0.001)


def write_json_atomically(path, value):
    directory = os.path.dirname(os.path.abspath(path))
    file_descriptor = None
    temporary_path = None
    try:
        file_descriptor, temporary_path = tempfile.mkstemp(
            prefix=".{}.".format(os.path.basename(path)), suffix=".tmp", dir=directory
        )
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as file_handle:
            file_descriptor = None
            json.dump(value, file_handle, ensure_ascii=False, indent=2, default=str)
            file_handle.flush()
            os.fsync(file_handle.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if file_descriptor is not None:
            os.close(file_descriptor)
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass


class WatchTargetJsonAdapter:
    @staticmethod
    def read(path):
        return _read_json(path, [], list)


class RuntimeStatusJsonAdapter:
    @staticmethod
    def read(path):
        return _read_json(path, {}, dict)

    @staticmethod
    def write(path, statuses):
        write_json_atomically(path, statuses)


class RecordingJsonAdapter:
    @staticmethod
    def read(path):
        return [RecordingJsonAdapter.to_domain(session) for session in _read_json(path, [], list)]

    @staticmethod
    def write(path, recordings):
        write_json_atomically(
            path, [RecordingJsonAdapter.from_domain(recording) for recording in recordings]
        )

    @staticmethod
    def to_domain(session):
        recording = dict(session)
        recording["watch_target_id"] = recording.pop("channel_id")
        recording.pop("stream_id", None)
        return recording

    @staticmethod
    def from_domain(recording):
        session = dict(recording)
        session["channel_id"] = session.pop("watch_target_id")
        session.pop("stream_id", None)
        return session


class StreamJsonAdapter:
    @staticmethod
    def read(path):
        return _read_json(path, [], list)

    @staticmethod
    def write(path, streams):
        write_json_atomically(path, streams)