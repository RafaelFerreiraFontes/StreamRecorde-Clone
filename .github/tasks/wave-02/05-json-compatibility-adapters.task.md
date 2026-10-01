---
name: Wave 02.5 JSON Compatibility Adapters
description: Isolate active JSON file formats from domain and service logic without replacing JSON persistence.
wave: 02
order: 05
depends_on:
  - 02-creator-watch-target-extraction.task.md
  - 03-recording-extraction.task.md
  - 04-stream-detection-model.task.md
status: done
---

# Wave 02.5 — JSON Compatibility Adapters

## Goal

Isolate the physical JSON formats from domain/service rules after the Creator, WatchTarget, Stream, and Recording boundaries exist, while keeping JSON as the active persistence implementation.

## Why This Task Exists

The API repository and Worker currently depend directly on `watchlist.json`, `channels_status.json`, and `sessions.json` shapes. A small explicit persistence boundary will allow a future database implementation to replace JSON without requiring domain and controller logic to be rewritten. This task is isolation, not database migration.

## Current State

- NestJS repository methods directly read, merge, and write Worker JSON files.
- Worker functions directly load and save the same files.
- Runtime state, persistence shape, and API/domain output are partially coupled.
- The NestJS `async-mutex` protects concurrent operations only inside the Node process. It does not synchronize the separate Python Worker process and must not be described as an API-and-Worker lock.
- A process can read a file while another process is replacing its contents, so partial or truncated JSON remains a cross-process risk unless the relevant write path is made safe.
- Tasks 02–04 may have introduced transitional mappings; their actual implementations and tests are the source of truth.
- JSON must remain the active operational storage at the end of this task.

## Expected Compatibility Boundaries

```text
watchlist.json <-> WatchTarget
channels_status.json <-> runtime Stream compatibility
sessions.json <-> Recording
```

`channels_status.json` remains primarily current WatchTarget runtime state. Its adapter may contribute compatibility information to Stream, but the task must not assume that this file alone is a complete Stream entity or occurrence store.

Legacy `channel_id` maps to domain `watch_target_id` only at compatibility boundaries. The new domain must not carry redundant `channel_id` naming. A future platform-native identifier, if required, must use an explicit name such as `platform_channel_id` and is outside this task.

## Cross-Process Write Safety

Sol must evaluate a simple, proportional safe-write strategy for each file that has a real concurrent-read risk:

```text
serialize
  -> write temporary file in the destination directory
  -> flush and close
  -> atomic rename/replace
  -> final JSON
```

The objective is to prevent Node or Python from observing partially written, truncated, or intermediate JSON. Do not assume every file and every write path needs the same mechanism: first identify which process reads and writes each file, then harden only the justified paths. Read retry behavior may still be required for replacement timing, transient filesystem errors, or invalid pre-existing content.

## Dependencies / Preconditions

- Creator/WatchTarget, Recording, and Stream boundaries from Tasks 02–04 are implemented and reviewed.
- Transitional JSON mappings and legacy endpoint behavior are understood.
- Existing data files and lifecycle tests are available as compatibility evidence.

## In Scope

- Identify domain/service rules that still depend on physical JSON field names or file operations.
- Introduce small, specific repositories, adapters, or mappers only where immediately used.
- Centralize compatible reading/writing for `watchlist.json`, `channels_status.json`, and `sessions.json` as appropriate to the verified design.
- Document which process reads and writes each JSON file and identify the actual cross-process collision risks.
- Preserve the in-process value of `async-mutex` without claiming that it synchronizes the Python Worker.
- Use temporary-file plus atomic rename/replace for the write paths where analysis proves it is needed, keeping the implementation local and small.
- Preserve appropriate retry/error handling for missing, invalid, partial, or transiently unavailable JSON.
- Preserve active-recording behavior established in Wave 01.
- Preserve legacy API responses and Worker input/output formats through explicit mappings.
- Keep `channel_id <-> watch_target_id` translation inside adapters and remove redundant `channel_id` terminology from new domain objects.
- Define a narrow seam that a future PostgreSQL implementation could replace.
- Add deterministic mapping, repository, API, and Worker regression tests proportional to the change.

## Out of Scope

- Replacing JSON or adding PostgreSQL, Prisma, TypeORM, database schemas, migrations, or dual-write persistence.
- Redis, BullMQ, RabbitMQ, OAuth, cloud storage, WebSocket, SSE, frontend, authentication, invitations, retention, cron, public streaming, or public indexing.
- Redis locks, database locks, distributed mutexes, or complex filesystem-lock protocols.
- Official Twitch, YouTube, or Kick APIs; Streamlink remains the detector.
- A generic repository base class, internal persistence framework, unnecessary factories, excessive dependency injection, or a complete hexagonal architecture.
- Microservices, Kubernetes, event sourcing, CQRS, broad module rewrites, or unrelated optimization.

## Sol Responsibilities

- Inspect the actual results of Tasks 02–04 and all current JSON access paths in API and Worker.
- Separate real domain decisions from serialization, file location, merging, locking, and compatibility concerns.
- Propose the fewest specific boundaries with immediate consumers.
- Document old-to-new mappings, invalid/missing-file behavior, write behavior, and rollback/data compatibility.
- Build a per-file reader/writer matrix for Node and Python before selecting any safe-write changes.
- Identify concurrency and lifecycle risks, especially partial JSON reads and active Recording preservation.
- Decide which writes require temporary-file plus atomic replace and whether read retry remains necessary.
- Treat `async-mutex` only as Node-local synchronization and reject any plan that presents it as cross-process protection.
- Define tests proving existing files remain readable and outputs remain compatible.
- Escalate if safe isolation requires a broader persistence redesign.

## Terra Responsibilities

- Implement only the approved specific adapters/repositories/mappers.
- Keep JSON as the sole active persistence implementation.
- Preserve file paths, compatible shapes, locking, error handling, and lifecycle guarantees unless Sol proves a minimal compatible change.
- Implement atomic replacement only for the justified write paths, with temporary files created in the same destination directory.
- Keep retry and invalid-JSON behavior explicit and proportional.
- Avoid generic abstractions and pass-through layers without value.
- Keep controller/service/domain logic free from unnecessary physical JSON knowledge.
- Mock filesystem and subprocess/Streamlink boundaries; do not require internet.
- Run all relevant API and Worker regressions, including Wave 01 lifecycle and Tasks 02–04 tests.

## Luna Responsibilities

- Verify JSON was isolated rather than replaced or hidden behind unused abstractions.
- Confirm every new boundary has an immediate consumer and a clear responsibility.
- Test compatibility with existing JSON data, missing/invalid files, reads, writes, merges, and active recording behavior.
- Verify that tests exercise reads during or around replacement without relying on a distributed lock or external service.
- Verify no partially written final JSON is observable on the hardened write paths.
- Check that controller/service/domain behavior no longer relies unnecessarily on physical file shapes.
- Reject generic frameworks, dual persistence, data loss, endpoint changes, or lifecycle regressions.
- Review imports, naming, dead code, dependency direction, and test quality.

## Acceptance Criteria

- [ ] JSON remains the only active persistence implementation.
- [ ] Physical JSON access and mapping are isolated behind small specific boundaries where useful.
- [ ] Domain/service rules do not depend unnecessarily on physical file layout.
- [ ] Existing `watchlist.json`, `channels_status.json`, and `sessions.json` data remain readable or have an explicit safe compatibility path.
- [ ] The three explicit boundaries map WatchTarget, runtime Stream compatibility, and Recording without leaking legacy `channel_id` into the new domain.
- [ ] Writes remain compatible with the current API and Worker contract.
- [ ] The Node `async-mutex` is documented and used only as in-process protection, not as synchronization with Python.
- [ ] Reader/writer ownership and collision risk are documented for each JSON file.
- [ ] Justified write paths use a same-directory temporary file and atomic rename/replace so the final path is never partially written.
- [ ] Missing, invalid, partial, and transiently unavailable JSON behavior is deterministic and tested where relevant.
- [ ] Active recording/session preservation remains correct.
- [ ] Legacy endpoints remain compatible.
- [ ] No database, queue, cloud, or generic persistence framework is introduced.
- [ ] Deterministic mapping and regression tests pass without internet.
- [ ] The resulting seam could support a future persistence replacement without claiming to implement it now.
- [ ] Luna returns `PASS` before Coordinator reports `READY_FOR_COMMIT` to the human.

## Stop Conditions

- Stop with `BLOCKED` if current JSON formats cannot be preserved without a human-approved data migration or breaking contract.
- Stop if a proposal introduces dual writes or a database.
- Stop and simplify if the adapter design becomes a general framework or exceeds current consumers.
- Do not modify the final-review task automatically.

## Expected Result

Small, tested JSON compatibility boundaries that preserve current runtime behavior and data while separating persistence mechanics from the Wave 02 domain model.

## Next Task

`05a-domain-api-surface.task.md`
