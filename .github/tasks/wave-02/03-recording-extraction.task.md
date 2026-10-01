---
name: Wave 02.3 Recording Extraction
description: Separate the capture lifecycle into Recording while preserving the legacy Session contract and Wave 01 guarantees.
wave: 02
order: 03
depends_on:
  - 01-domain-model-definition.task.md
status: done
---

# Wave 02.3 — Recording Extraction

## Goal

Separate the recording/capture lifecycle from the legacy `Session` concept without performing a blind global rename or breaking existing API, Worker, and JSON behavior.

## Why This Task Exists

`Session` is currently close to a Recording but its actual responsibilities and public contracts must be verified. A controlled extraction makes the capture lifecycle explicit while preserving the stable behavior established in Wave 01.

## Current State

- `SessionDto` exposes session ID, channel ID, timestamps, output file, state, and platform enrichment.
- `sessions.json` is the active recording-history persistence.
- The Worker creates a session immediately when capture starts, preserves it across polls, and updates that same session on completion, error, or shutdown.
- Legacy `/session` endpoints are current client contracts.
- Task 02 may have changed how a monitored channel maps to Creator/WatchTarget; its actual result must be inspected.

## Dependencies / Preconditions

- Task 01's model is approved.
- Task 02's actual result is reviewed, especially ID and WatchTarget relationships.
- Wave 01 lifecycle tests and guarantees are understood and preserved as regression coverage.

## In Scope

- Determine whether current Session is exactly Recording or includes other responsibilities.
- Introduce the minimum Recording representation for the capture execution lifecycle.
- Preserve only currently justified states, including `recording`, `finished`, and `error`; retain `pending` only if current behavior genuinely needs it.
- Preserve immediate persistence, stable identity across the lifecycle, `started_at`, `finished_at`, output file, error handling, and shutdown behavior.
- Relate Recording to the verified WatchTarget and/or Stream boundary without inventing unavailable data.
- Keep `sessions.json` active through explicit compatibility mapping when needed.
- Preserve legacy session endpoints when feasible:
  - `GET /session`
  - `GET /session/:id`
  - `GET /session/channel/:id`
- Add focused deterministic tests and preserve Worker lifecycle tests.

## Out of Scope

- A blind `Session` to `Recording` global rename.
- Full Stream detection modeling, replacement persistence, queues, uploads, or new lifecycle stages without current use.
- PostgreSQL, Prisma, TypeORM, Redis, BullMQ, RabbitMQ, OAuth, cloud storage, WebSocket, SSE, frontend, authentication, invitations, retention, cron, public streaming, or public indexing.
- Official Twitch, YouTube, or Kick APIs; Streamlink remains the detector.
- Microservices, Kubernetes, event sourcing, CQRS, generic repository frameworks, or broad refactoring.

## Sol Responsibilities

- Re-inspect current API, Worker, tests, JSON data, and Tasks 01–02 results.
- Trace Session creation, persistence, lookup, state transitions, finalization, failure, and shutdown.
- Identify any Session responsibility that should not move to Recording.
- Define the smallest compatibility boundary for `/session` and `sessions.json`.
- Define the exact relationship to the current WatchTarget and the future/minimal Stream concept without anticipating Task 04 unnecessarily.
- Plan focused tests for identity continuity and every current lifecycle outcome.
- Escalate any breaking lifecycle or endpoint decision to Coordinator.

## Terra Responsibilities

- Implement the approved Recording boundary incrementally and keep the diff small.
- Preserve the same recording/session ID from capture start through final state.
- Preserve immediate JSON persistence and active-recording protection across polling.
- Preserve output and timestamps, including shutdown and failure behavior.
- Keep legacy session endpoints and JSON mapping explicit rather than duplicating lifecycle logic.
- Mock Streamlink, subprocess, filesystem, and time where appropriate; do not require internet or a live channel.
- Run all relevant Wave 01 lifecycle tests and focused API/Worker tests.

## Luna Responsibilities

- Verify the change represents a real responsibility boundary, not a cosmetic rename.
- Check that Session and Recording do not duplicate the same lifecycle without a documented temporary adapter.
- Simulate normal finish, process error, repeated polling, missing/invalid data, and shutdown.
- Confirm one lifecycle produces one stable Recording and one compatible legacy session representation.
- Review API compatibility, JSON data compatibility, imports, naming, and dead code.
- Reject new speculative states, behavior regressions, or changes outside the approved extraction.

## Acceptance Criteria

- [ ] Session responsibilities are investigated before migration.
- [ ] Recording owns the current capture lifecycle clearly.
- [ ] The same identity is used from recording start through finish/error.
- [ ] Recording is persisted immediately when capture starts.
- [ ] Active Recording data survives later Worker polls.
- [ ] `started_at`, `finished_at`, output, error, and shutdown behavior remain correct.
- [ ] No duplicate Recording/Session lifecycle exists except an explicit justified compatibility adapter.
- [ ] Legacy `/session` endpoints remain compatible or a required break is blocked for human decision.
- [ ] `sessions.json` remains the active compatible persistence format or has an explicit minimal compatible mapping.
- [ ] Wave 01 lifecycle tests and focused new tests pass without internet.
- [ ] Luna returns `PASS` before Coordinator reports `READY_FOR_COMMIT` to the human.

## Stop Conditions

- Stop with `BLOCKED` if Session carries a product meaning that cannot safely map to Recording without human input.
- Stop if the extraction would lose history, duplicate active captures, or break lifecycle identity.
- Stop and refine if the work requires Task 04's full Stream model or Task 05's generalized persistence isolation.
- Do not edit later task files automatically.

## Expected Result

An explicit Recording lifecycle integrated with current behavior, while `/session` and `sessions.json` remain justified compatibility surfaces and all Wave 01 lifecycle guarantees continue to hold.

## Next Task

`04-stream-detection-model.task.md`
