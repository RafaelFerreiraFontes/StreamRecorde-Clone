---
name: Wave 01 MVP Stabilization
description: Stabilize the API-to-Worker JSON contract and recording lifecycle before domain separation.
wave: 01
order: 01
depends_on: []
status: done
---

# Wave 01 — MVP Stabilization

## Goal

Stabilize the current API-to-Worker contract and recording lifecycle before any future separation of the `Creator`, `Stream`, and `Recording` entities.

This wave must preserve the current JSON-based MVP and its existing behavior. It addresses only concrete defects in the current NestJS streams module and Python Worker.

## Required Project Context

Before working on this task, read:

- `.github/instructions/project.instructions.md`;
- `.github/instructions/mvp.instructions.md`;
- this task in full;
- the relevant agent instructions under `.github/agents/`.

If instructions conflict, the existing project and MVP instruction files take precedence.

## Current State

The backend is a NestJS API with the current stream-related behavior concentrated in `api/src/streams/`.

The module currently uses concepts named `Streamer` and `Session`. Its repository reads and writes JSON files shared with the Python Worker as temporary MVP persistence:

- `worker/config/watchlist.json` stores monitored channel configuration;
- `worker/config/channels_status.json` stores current channel state;
- `worker/config/sessions.json` stores recording sessions.

The Worker in `worker/worker.py` uses Streamlink to probe whether a channel is live, starts a recording process, creates a session, monitors the process, and updates recording state. The Worker is packaged through `worker/Dockerfile` and `worker/docker-compose.yml`.

JSON persistence must remain in this wave.

## Current Contracts

Valid platforms:

```text
twitch
youtube
kick
```

Valid current states:

```text
idle
offline
recording
finished
error
```

`offline` is a state, not a platform.

Existing endpoints that must remain available:

```text
GET    /streamer
GET    /streamer/:id
POST   /streamer
DELETE /streamer/:id

GET    /session
GET    /session/:id
GET    /session/channel/:id
```

## Known Issues

### Issue A — Route Parameter

`GET /session/channel/:id` currently declares `:id`, while the controller reads a differently named parameter through `@Param`.

The route value must be passed unchanged to:

```text
findSessionsByChannel(id)
```

Required outcome:

- make the route and `@Param` name consistent;
- add a focused test proving the value of `:id` reaches the service call.

### Issue B — Session Lifecycle

`start_recording()` creates a session with approximately these fields:

```text
session_id
channel_id
started_at
finished_at
output_file
state
```

The session is appended to the in-memory Python list, but it is not persisted immediately to `sessions.json`. Meanwhile, `poll_loop()` periodically replaces the in-memory sessions list with data reloaded from `sessions.json`.

This permits the following failure:

1. A live stream is detected.
2. `start_recording()` creates a session.
3. The session exists only in memory.
4. A later poll reloads `sessions.json`.
5. The in-memory session disappears.
6. `monitor_recording()` searches for an open session.
7. The active session is not found and cannot be finalized correctly.

Required outcome:

- persist the session as soon as recording starts;
- make a `recording` session visible through `GET /session` before the live stream ends;
- ensure later polls do not remove active sessions;
- update that same session to `finished` or `error` when the recording process ends;
- do not create a second session to represent completion;
- keep `channels_status.json` and `sessions.json` consistent for the lifecycle being updated.

### Issue C — Platform Contract

The DTOs are inconsistent: some accept `kick`, some omit it, and some include `offline` as if it were a platform.

Required outcome:

- normalize platform validation to `twitch | youtube | kick`;
- keep state validation as `idle | offline | recording | finished | error`;
- ensure `offline` is never accepted as a platform;
- do not add any other platform or state.

## Scope

Wave 01 includes only:

- correcting the parameter contract for `GET /session/channel/:id`;
- adding or adjusting a focused route test;
- persisting a new session immediately when recording begins;
- preserving active recording sessions across later polls;
- updating the same session when recording finishes or fails;
- normalizing the current platform validation contract;
- adding or adjusting focused API and Worker tests for these behaviors;
- preserving all current streamer and session endpoints;
- using mocks for subprocess and Streamlink behavior in automated tests;
- keeping the smallest reasonable diff.

## Out of Scope

Do not introduce, implement, model, or prepare abstractions for:

- PostgreSQL;
- Prisma;
- TypeORM;
- Redis;
- BullMQ;
- RabbitMQ;
- OAuth;
- Google Drive;
- Dropbox;
- OneDrive;
- WebSocket;
- SSE;
- authentication;
- frontend;
- tag system;
- `Creator` entity;
- `Stream` entity;
- `Recording` entity;
- microservices.

Do not replace JSON persistence, rename the current domain, reorganize modules, change the stack, or refactor unrelated code in this wave.

## Sol — Investigation and Plan

Sol must inspect:

- `api/src/streams/streams.controller.ts`;
- `api/src/streams/streams.service.ts`;
- `api/src/streams/streams.repository.ts`;
- `api/src/streams/dto/*`;
- `api/src/streams/test/*`;
- `worker/worker.py`.

Sol must:

1. confirm the root cause of each known issue against the current implementation;
2. look for other bugs directly related to the current session lifecycle;
3. describe the minimum change required in each affected file;
4. identify the focused tests required;
5. preserve current endpoints and JSON persistence;
6. avoid designing or implementing future architecture.

Expected Sol deliverable:

- diagnosis;
- affected files;
- behavior before and after;
- risks;
- minimal implementation plan;
- refined acceptance criteria.

Any unrelated finding must be recorded separately and must not expand Wave 01.

## Terra — Implementation

Terra must implement only after reading:

- `.github/instructions/project.instructions.md`;
- `.github/instructions/mvp.instructions.md`;
- this Wave 01 task;
- Sol's analysis, when available.

Terra must:

1. correct `GET /session/channel/:id` so `:id` reaches `findSessionsByChannel(id)`;
2. persist `sessions.json` as soon as recording starts;
3. ensure `poll_loop()` does not remove active recording sessions;
4. ensure `monitor_recording()` updates the same session created by `start_recording()`;
5. normalize the platform contract to `twitch | youtube | kick`;
6. preserve every endpoint listed under Current Contracts;
7. add or adjust focused tests for the affected behavior;
8. avoid tests that require a real Twitch, YouTube, or Kick channel to be online;
9. mock subprocess and Streamlink behavior where appropriate;
10. keep the smallest reasonable diff.

Terra must not perform unrelated cleanup, broad refactoring, file moves, domain migration, or architecture preparation.

## Luna — Review and Debugging

Luna acts as reviewer and debugger.

Review the API changes in:

- controller;
- service;
- repository;
- DTOs;
- tests.

Review the Worker behavior around:

- `poll_loop()`;
- `is_live()`;
- `start_recording()`;
- `monitor_recording()`;
- `handle_shutdown()` and active recording shutdown behavior.

Conceptually simulate and, where practical, cover with deterministic tests:

### Case 1 — Channel Is Offline

The channel state becomes `offline`; no recording process or session is created.

### Case 2 — Live Starts and Remains Active Across Multiple Polls

One recording process and one session are created. The session remains persisted with state `recording`, and later polls do not remove or duplicate it.

### Case 3 — Live Ends Normally

The existing session is updated to `finished`, receives `finished_at`, and remains the only session for that recording lifecycle.

### Case 4 — Streamlink Exits With an Error

The existing session is updated to `error`, receives `finished_at`, and is not duplicated.

### Case 5 — Worker Receives SIGTERM During an Active Recording

Review whether the child process, active recording state, session state, and persisted JSON remain consistent. Report any directly related lifecycle defect without expanding the wave.

Luna must look for:

- lost sessions;
- duplicated sessions;
- sessions that never finish;
- improper replacement of the sessions list;
- obvious race conditions;
- inconsistencies between `channels_status.json` and `sessions.json`;
- endpoint regressions;
- invalid or corrupted JSON caused by introduced behavior.

Luna's result must be exactly one of:

```text
PASS
CHANGES REQUIRED
```

If the result is `CHANGES REQUIRED`, report each finding with:

- file;
- behavior;
- impact;
- recommended correction.

Luna may fix small bugs directly caused by the Wave 01 implementation. Luna must not expand scope.

## Acceptance Criteria

- [ ] `GET /streamer` continues to work.
- [ ] `GET /streamer/:id` continues to work.
- [ ] `POST /streamer` continues to work.
- [ ] `DELETE /streamer/:id` continues to work.
- [ ] `GET /session` continues to work.
- [ ] `GET /session/:id` continues to work.
- [ ] `GET /session/channel/:id` uses `:id` correctly.
- [ ] Twitch is a valid platform.
- [ ] YouTube is a valid platform.
- [ ] Kick is a valid platform.
- [ ] Offline is not a platform.
- [ ] A session is persisted as soon as recording starts.
- [ ] A `recording` session remains available during later polls.
- [ ] The same session is updated when recording finishes.
- [ ] The same session is updated when recording fails.
- [ ] No second session is created for the same recording lifecycle.
- [ ] Relevant tests pass.
- [ ] Automated tests do not require a real live stream.
- [ ] PostgreSQL was not introduced.
- [ ] Redis or BullMQ was not introduced.
- [ ] Cloud storage was not introduced.
- [ ] `Creator`/`Stream`/`Recording` separation was not introduced.
- [ ] The scope and behavior of the current MVP were preserved.

## Validation Evidence

Before Wave 01 is considered complete, record:

- the tests executed;
- their results;
- the files changed;
- the observed behavior for each lifecycle case;
- Luna's final verdict;
- any out-of-scope observations deferred to future work.

## Future Context — Not Part of This Wave

After Wave 01 is complete, the planned next architectural study may evaluate the conceptual separation of:

```text
Creator
Stream
Recording
```

This note is context only. Do not create Wave 02, model these entities, add files for them, modify code to prepare for them, or introduce anticipatory abstractions during Wave 01.
