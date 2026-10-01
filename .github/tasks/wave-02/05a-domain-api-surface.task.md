---
name: Wave 02.5a Domain API Surface
description: Expose the Wave 02 domain through a thin REST API while preserving legacy compatibility endpoints and JSON persistence.
wave: 02
order: 05a
depends_on:
  - 04-stream-detection-model.task.md
  - 05-json-compatibility-adapters.task.md
status: done
---

# Wave 02.5a — Domain API Surface

## Goal

Expose the Creator, WatchTarget, Stream, and Recording concepts established in Wave 02 through the minimum REST surface required by a future diagnostic frontend, without removing or duplicating legacy compatibility behavior.

## Dependencies / Preconditions

- Task 04 has implemented and reviewed Stream identity, lifecycle, and relationships.
- Task 05 has implemented and reviewed the JSON compatibility boundaries.
- The domain model uses `Stream.watch_target_id`; redundant domain `Stream.channel_id` has been removed.
- Legacy `channel_id` remains confined to formats and endpoints where it is an existing compatibility contract.

## Required Domain Endpoints

### Creator

```http
GET /creators
GET /creators/:id
GET /creators/:id/watch-targets
```

### WatchTarget

```http
GET    /watch-targets
GET    /watch-targets/:id
POST   /watch-targets
DELETE /watch-targets/:id
```

### Stream

```http
GET /streams
GET /streams/:id
```

### Recording

```http
GET /recordings
GET /recordings/:id
GET /recordings?watchTargetId=<id>
```

## Architecture Rule

The endpoints must remain a thin boundary:

```text
Controller
  -> Service
  -> Repository / Domain
  -> Legacy JSON Adapter
  -> JSON persistence
```

Controllers must not read or write `watchlist.json`, `channels_status.json`, or `sessions.json` directly. They must not reimplement or bypass adapters produced by Task 05.

## Legacy Compatibility Endpoints

These routes remain supported and are explicitly classified as legacy compatibility endpoints:

```http
GET    /streamer
GET    /streamer/:id
POST   /streamer
DELETE /streamer/:id

GET /session
GET /session/:id
GET /session/channel/:id
```

The new domain routes must share the same underlying domain/repository/adapter behavior rather than create a second source of truth.

## In Scope

- Add the required domain endpoints.
- Add only the DTOs needed for request validation and stable domain responses.
- Add missing repository and service methods required by these endpoints.
- Support listing, retrieving, creating, and deleting WatchTargets within the approved route set.
- Support filtering Recordings by `watchTargetId`.
- Reuse the Stream model and lifecycle established by Task 04.
- Reuse the Recording model and adapters established by Tasks 03 and 05.
- Add deterministic controller/service/repository tests for the new endpoints.
- Run regression tests for all legacy compatibility endpoints.

## Out of Scope

- Frontend implementation.
- Authentication or user ownership.
- PostgreSQL, Prisma, TypeORM, Redis, BullMQ, RabbitMQ, or another persistence system.
- WebSocket, SSE, cloud storage, upload, or retention.
- Full Creator CRUD.
- Removing, renaming, or deprecating legacy routes beyond documenting their compatibility role.
- Duplicating JSON adapters or moving file I/O into controllers.
- New Stream lifecycle rules outside the Task 04 result.

## Sol Responsibilities

- Inspect the completed Tasks 04 and 05 implementation before designing routes.
- Map each route to an existing or minimally required service/repository method.
- Define the smallest request/response DTO set without duplicating domain types unnecessarily.
- Define `POST /watch-targets` mapping through the Task 05 adapter so the persisted watchlist remains Worker-compatible.
- Define `DELETE /watch-targets/:id` behavior so only the requested target is removed.
- Define Recording query validation and filtering by `watchTargetId`.
- Identify regression tests proving the legacy and domain routes use one underlying source of truth.

## Terra Responsibilities

- Implement only Sol's approved thin route/service/repository changes.
- Keep controllers free of filesystem access, legacy serialization, and domain lifecycle decisions.
- Reuse Task 05 adapters and Task 04 Stream behavior.
- Preserve all legacy routes and response behavior.
- Add deterministic tests that use fixtures or temporary files rather than internet or a real live stream.

## Luna Responsibilities

- Verify every required route exists and delegates through the approved layers.
- Reject controller-level JSON access or duplicated compatibility mapping.
- Verify WatchTarget creation persists Worker-compatible JSON.
- Verify WatchTarget deletion cannot remove sibling targets.
- Verify Stream endpoints expose Task 04 identities and lifecycle rather than WatchTarget status relabeled as Stream.
- Verify Recording endpoints use the Task 03/05 model and filter correctly by WatchTarget.
- Run legacy route regressions and reject hidden breaking changes.

## Acceptance Criteria

- [ ] `GET /creators` returns domain Creators.
- [ ] `GET /creators/:id` returns one Creator or the established not-found response.
- [ ] `GET /creators/:id/watch-targets` returns only that Creator's WatchTargets.
- [ ] `GET /watch-targets` and `GET /watch-targets/:id` return domain WatchTargets.
- [ ] `POST /watch-targets` persists a `watchlist.json` entry fully compatible with the Worker through the existing adapter boundary.
- [ ] `DELETE /watch-targets/:id` removes only the requested WatchTarget and preserves sibling targets.
- [ ] `GET /streams` and `GET /streams/:id` use the Stream identity and lifecycle defined by Task 04.
- [ ] `GET /recordings` and `GET /recordings/:id` use the Recording model defined by Tasks 03 and 05.
- [ ] `GET /recordings?watchTargetId=<id>` filters by domain WatchTarget identity.
- [ ] Controllers contain no direct JSON file access and no duplicate legacy mapping logic.
- [ ] Domain and legacy routes use the same repository/domain/adapter source of truth.
- [ ] All existing `/streamer` and `/session` endpoint tests continue to pass.
- [ ] New tests are deterministic and require no internet or real Twitch, YouTube, or Kick live stream.
- [ ] No frontend, authentication, database, queue, real-time channel, cloud, upload, or retention work is introduced.
- [ ] Luna returns `PASS` before Coordinator reports `READY_FOR_COMMIT` to the human.

## Stop Conditions

- Stop with `BLOCKED` if a route requires bypassing or duplicating the Task 05 adapters.
- Stop if the Stream API cannot use a completed Task 04 identity/lifecycle.
- Stop for human direction if preserving legacy behavior requires a breaking API decision.
- Stop and simplify if implementation expands into full Creator CRUD, authentication, persistence replacement, or frontend work.

## Expected Result

A small domain REST surface ready for a polling-based diagnostic frontend, backed by the same domain and legacy JSON adapters as the existing compatibility routes.

## Next Task

`06-wave-02-final-review.task.md`
