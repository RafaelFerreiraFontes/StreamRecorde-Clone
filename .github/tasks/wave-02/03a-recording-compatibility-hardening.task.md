---
name: Wave 02.3a Recording Compatibility Hardening
description: Harden the Recording and legacy Session compatibility boundary without introducing new architecture.
wave: 02
order: 03a
depends_on:
  - 03-recording-extraction.task.md
status: done
---

# Wave 02.3a - Recording Compatibility Hardening

## Purpose

Harden the boundary introduced during Wave 02.3 between the internal `Recording` lifecycle and the legacy `Session` persistence and API contract.

This is a focused cleanup and regression-hardening task. It must not introduce new architecture.

## Current Architecture

The intended boundary is:

```text
Worker runtime
    -> Recording
    -> legacy serialization adapter
    -> sessions.json
```

On the API side:

```text
sessions.json
    -> legacy persistence shape
    -> Recording
    -> SessionDto compatibility
    -> /session endpoints
```

`sessions.json` remains the active physical persistence format.

## Scope

- Inspect and harden `deserialize_session()` and `serialize_recording()`.
- Preserve `session_id` as the sole Recording identity.
- Map legacy `channel_id` to internal `watch_target_id` only at the compatibility boundary.
- Restore `channel_id` when serializing to `sessions.json`.
- Remove narrow stale naming, such as variables that describe a Recording as a Stream, when this improves correctness without broad cosmetic renaming.
- Remove unreachable duplicate statements if present.
- Add focused adapter round-trip regression tests.
- Preserve all existing Worker lifecycle behavior and API compatibility.

## Compatibility Requirements

The legacy persisted record remains:

```json
{
  "session_id": "...",
  "channel_id": "...",
  "started_at": "...",
  "finished_at": null,
  "output_file": "...",
  "state": "recording"
}
```

The internal Recording representation is:

```json
{
  "session_id": "...",
  "watch_target_id": "...",
  "started_at": "...",
  "finished_at": null,
  "output_file": "...",
  "state": "recording"
}
```

`watch_target_id` must not leak into `sessions.json`. Do not add `recording_id` or `stream_id` to the persisted format.

## Acceptance Criteria

- [ ] Serialization and deserialization are symmetric.
- [ ] `deserialize_session()` removes internal legacy `channel_id` and creates `watch_target_id`.
- [ ] `serialize_recording(deserialize_session(legacy_session))` preserves the legacy shape and values.
- [ ] `channel_id` remains the disk field and `watch_target_id` does not leak to `sessions.json`.
- [ ] `session_id` remains unchanged and is the sole lifecycle identity.
- [ ] Timestamps, output file, and state survive round-trip conversion.
- [ ] Immediate persistence, reload protection, successful completion, process failure, missing output, shutdown, `finished_at`, and active status behavior remain unchanged.
- [ ] `GET /session`, `GET /session/:id`, and `GET /session/channel/:id` remain compatible.
- [ ] No new Recording routes or architecture are introduced.
- [ ] No Wave 02.4 or Wave 02.5 implementation is included.

## Test Requirements

Add focused Worker tests covering:

- legacy `channel_id` to internal `watch_target_id` mapping;
- internal `watch_target_id` to legacy `channel_id` mapping;
- complete adapter round-trip preservation;
- persisted `sessions.json` containing `channel_id` and excluding `watch_target_id`.

Run the full Worker suite and API regression checks without requiring internet, Streamlink, FFmpeg, or live channels.

## Out Of Scope

Do not implement Stream lifecycle or detection, JSON persistence abstraction, PostgreSQL, Redis, BullMQ, OAuth, cloud storage, frontend, WebSocket, SSE, retention, new API routes, Wave 02.4, or Wave 02.5.

## Branch

```text
refactor/wave-02-recording-compatibility-hardening
```

The branch must be created from the committed Wave 02.3 branch. If Wave 02.3 is not committed or the working tree is unsafe, stop with `BLOCKED`.

## Expected Final Result

The internal Worker/API concept remains `Recording`, the external persistence/API compatibility terminology remains `Session`, and the legacy `sessions.json` contract is unchanged and regression-tested.
