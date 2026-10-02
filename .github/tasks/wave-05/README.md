# Wave 05 — PostgreSQL + Definitive Domain Persistence

## Status and Objective

Planning only: all seven tasks are planned. No PostgreSQL code, dependency, schema, migration, or Compose change is implemented by this reorganization.

Progressively replace shared JSON as primary domain persistence for Creator, WatchTarget, Stream, and Recording while preserving the functional Wave 04.75 local baseline. Local Recording Storage remains primary; no cloud account or hosted service is required.

This README is the umbrella specification. The former monolithic task is replaced by seven independently reviewable checkpoints, not an eighth executable task.

## Verified Starting Point

NestJS StreamsRepository and JSON adapters expose modern/legacy contracts. Creator is inferred from display_name/channel_name, without independently persisted identity/CRUD. Worker polls watchlist.json and writes streams.json, sessions.json, and channels_status.json. Both sessions adapters omit stream_id. Recording uses session_id and current idle/offline/recording/finished/error states. There is no queue or PostgreSQL.

| File | Baseline role |
| --- | --- |
| watchlist.json | WatchTarget configuration and name-derived Creator identity |
| streams.json | Stream history and active-stream reload |
| sessions.json | Legacy Recording history; channel_id compatibility |
| channels_status.json | Operational/runtime snapshot merged into API reads |

Domain persistence and runtime communication must be investigated separately. channels_status.json is operational by default; preserving a backup does not make it domain import input.

## Tasks and Dependency Graph

| Order | Task | Dependency | Status |
| --- | --- | --- | --- |
| 01 | [Persistence Architecture and Cutover Decisions](01-persistence-architecture-decisions.task.md) | [Wave 04.75 integration QA](../wave-04.75/05-wave-integration-qa-documentation.task.md) | planned |
| 02 | [PostgreSQL Foundation and Schema](02-postgresql-foundation-schema.task.md) | 05-T01 | planned |
| 03 | [Creator and WatchTarget Relational Persistence](03-creator-watch-target-persistence.task.md) | 05-T02 | planned |
| 04 | [Stream and Recording Relational Persistence](04-stream-recording-persistence.task.md) | 05-T03 | planned |
| 05 | [Worker Persistence Bridge](05-worker-persistence-bridge.task.md) | 05-T04 | planned |
| 06 | [Legacy JSON Migration and Authority Cutover](06-legacy-json-migration-cutover.task.md) | 05-T05 | planned |
| 07 | [Wave Integration QA and Documentation](07-wave-integration-qa-documentation.task.md) | 05-T06 | planned |

```text
05-T01 Decisions -> 05-T02 Foundation -> 05-T03 Creator/WatchTarget
 -> 05-T04 Stream/Recording -> 05-T05 Worker Bridge
 -> 05-T06 Migration/Cutover -> 05-T07 Integration QA
```

Within this directory, 05-T05 means task order 05 of Wave 05 (Worker Bridge). The separate future **Wave 05.5 — User/authentication/ownership** remains out of scope.

Each task owns one concern, an implementation/documentation checkpoint, and an independent validation/review gate. Producing code is not approval of a dependency. Later execution must wait for its predecessor's validation, review, and human acceptance under the existing lifecycle.

## Authority and Rollout Boundaries

05-T01 must freeze an authority ledger for every stage and entity: primary authority, readers, writers, compatibility projection, activation conditions, and rollback checkpoint. No ORM or Worker strategy is chosen by this reorganization.

- 05-T02 adds the DB/schema and minimal seam without changing live authority.
- 05-T03/05-T04 establish relational behavior behind the approved boundary and prove it in isolated fixtures. Existing installations retain their approved authority until opt-in migration/cutover in 05-T06.
- 05-T03 includes only the configuration compatibility needed to keep the existing Worker functional; it does not perform Stream/Recording cutover.
- 05-T04 proves API/repository persistence, not operational Worker integration.
- 05-T05 proves ongoing Worker writes against relational authority in disposable integration environments. It must not silently activate an unmigrated installation.
- 05-T06 migrates existing data and activates only the authority switches approved in 05-T01, with verification and rollback evidence.
- 05-T07 validates the complete clean-install and upgraded-install paths.

The exact activation mechanism must be decided in 05-T01; do not invent a generic backend framework or uncontrolled independently writable dual primaries. No flag-day migration, silent fallback that leaves PostgreSQL stale, or static-only import that stops receiving Worker activity is acceptable.

## Shared Constraints and Out of Scope

Preserve stable IDs/legacy mappings, current enum/API contracts, quality preference, enabled, authoritative URL, recording_subdir, local output metadata, and sibling independence. New Recording/Stream links must be valid; never infer missing historical stream_id without reliable provenance. History-safe deletion, timezone-free timestamp policy, and transaction boundaries must be explicit.

Use existing repository/adapters where justified. Future ownership and Tags must remain feasible without fictitious user_id, placeholder ownership, or premature tables. PostgreSQL stores metadata, not media. Preserve current read-only API recording mount, frontend proxy, non-root Worker, filesystem containment, and secret-safe diagnostics.

Out of scope: User persistence, authentication, password hashing, JWT, ownership, Redis, BullMQ, Recording Jobs, Tags, SSE, WebSocket, Worker heartbeat, Google Drive, Dropbox, OneDrive, OAuth, CloudStorageConnection, CloudExport/upload, Tauri, Hosted Mode/deployment, public recordings/indexing/streaming, retention implementation, media pipeline rewrite, and full frontend Creator-management redesign.

## Requirements Distribution

| Requirement family | Decision / implementation / final evidence |
| --- | --- |
| JSON readers/writers, ORM comparison, Worker A/B/C choice, authority ledger | 05-T01; implemented by 05-T02–05-T06 |
| Local PostgreSQL, schema/FKs/indexes/timestamps, migration tooling, isolated DB | 05-T02 |
| Stable Creator IDs/CRUD, legacy name collisions/rename, target configuration and siblings | 05-T03 |
| Stream/Recording repository, lifecycle, valid new links, historical unknowns, history-safe relations | 05-T04 |
| Ongoing Worker writes, runtime/config compatibility, outage/restart/replay recovery | 05-T05 |
| Opt-in dry-run/backup/import, malformed data, idempotence, reconciliation, cutover and rollback | 05-T06 |
| Full regressions, local Compose, clean/upgrade paths, documentation and evidence audit | 05-T07 |

## Wave-Level Acceptance Criteria

These criteria require the complete wave, not task 05-T01 alone:

- [ ] PostgreSQL is primary for Creator, WatchTarget, Stream, and Recording; the four concepts remain separate.
- [ ] New Worker lifecycle activity reaches PostgreSQL with valid durable relationships, not only imported snapshots.
- [ ] Stable Creator identity, independent WatchTargets, compatible IDs/configuration, and history-safe deletion are verified.
- [ ] Current modern/legacy API behavior is compatible where required, including filtering, validation, filesystem locations, and frontend use.
- [ ] New stream_id links are durable and historical unknown links/timestamps are handled according to explicit policy.
- [ ] Existing local installations migrate through opt-in dry-run, backup, verification, restart, idempotent replay, and rollback rehearsal.
- [ ] Schema/migrations are reproducible for clean and existing installations; DB/service restarts preserve domain state and valid local media.
- [ ] One primary authority per entity is explicit; no uncontrolled dual primary or silent stale-DB fallback remains.
- [ ] DB outage before/during capture and terminal write, plus service restart/replay, has tested failure/recovery behavior without false durable success or blind duplicate capture.
- [ ] Docker Desktop/Windows local Compose, persistent volume, health/readiness, configuration, and isolated test DB work without real committed secrets.
- [ ] Local recordings remain primary/private and valid media is not discarded by persistence/export failures; no cloud is required.
- [ ] No out-of-scope future feature is introduced.
- [ ] Final API, Worker, frontend, database, migration, Docker/integration, and documentation QA passes with reproducible evidence.

## Validation and Workflow

Use [project instructions](../../instructions/project.instructions.md) and [MVP instructions](../../instructions/mvp.instructions.md). Each task follows Coordinator -> Sol -> Terra -> Coordinator validation -> Luna -> Coordinator, with user acceptance before done. For 05-T01, the deliverable through this workflow is decisions/documentation only; no running DB is required.

Keep planned -> implement -> review/QA -> user-approve -> done and the existing fixing/coordinator-review paths. Coordinator validates before Luna; preserve the separate three-attempt diagnostic and three-review-cycle limits. A later task cannot bypass an unresolved predecessor gate. Later failures reopen only the affected checkpoint with explicit impact review, not silently erase earlier evidence.

No automatic staging/commit/push. This planning execution leaves all seven statuses planned. Every later task reports commands as passed, failed, blocked, or not run, and records its checkpoint/rollback evidence.

Use current frameworks, isolated local PostgreSQL/storage, and fake Streamlink/process behavior. Automated tests must not depend on Twitch, YouTube, Kick, internet, or a live stream. Dependency/image downloads are setup, separate from offline test execution. Fake media is not evidence of playable MP4. Never use real user runtime-data/media as fixtures or remove normal local volumes for testing.

See [Project Status](../../../PROJECT-STATUS.md) for the broader roadmap. Future numbering may evolve.
