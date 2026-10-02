# Wave 05 — PostgreSQL + Definitive Domain Persistence

## Status

Planning only. The task starts as planned; no PostgreSQL code, dependency, schema, migration, or Compose change is implemented by this document.

## Objective

Progressively replace shared JSON as primary persistence for Creator, WatchTarget, Stream, and Recording, preserving the functional Wave 04.75 local baseline. Local recordings remain the primary output; no cloud account or hosted service is required.

## Verified Starting Point

NestJS StreamsRepository and JSON compatibility adapters expose modern and legacy routes. Creator identity is inferred from names; WatchTarget configuration lives in watchlist.json. Worker writes streams.json, legacy sessions.json, and operational channels_status.json. Both sessions adapters drop stream_id. Worker polling initiates captures directly; there is no queue.

## Task

| Order | Task | Dependency | Status |
| --- | --- | --- | --- |
| 01 | [PostgreSQL Domain Persistence](01-postgresql-domain-persistence.task.md) | Integrated Wave 04.75 baseline | planned |

The single formal task contains investigation, decision, staged implementation, migration, and QA checkpoints. Split further only if later planning demonstrates a need; do not implement this wave during the architectural documentation execution.

## Sequence and Boundaries

1. Inventory domain versus operational state and current API/Worker contracts.
2. Record ORM/query-layer and relational schema decisions.
3. Introduce local PostgreSQL and a minimal persistence seam.
4. Deliver stable Creator persistence/CRUD and migrate target configuration.
5. Migrate Stream/Recording history and ongoing writes with an explicit Worker bridge.
6. Import existing local data safely, then validate restart, failure, and regressions.
7. Retire only superseded domain authorities; keep operational JSON if needed.

Every step needs one declared primary source per entity and a rollback checkpoint. JSON compatibility must not leave PostgreSQL as only a static historical mirror.

## Dependencies / Risks

Depends on current repository/adapters/tests and later local PostgreSQL tooling for implementation QA. Main risks: name-based Creator IDs, orphan history after target deletion, missing persisted stream_id, timezone-free timestamps, cross-writer races, and divergence during staged migration.

Auth/User/ownership, Redis/BullMQ/jobs, Tags, SSE/heartbeat, cloud/OAuth/export, Tauri, and Hosted Mode belong to later waves. PostgreSQL domain persistence does not imply media file migration.

## Workflow and Evidence

Follow project task lifecycle: planned -> implement -> validated review/QA -> user-approve -> done, including correction/coordinator-review rules. Planning does not authorize lifecycle advancement, commit, or push.

Implementation must report decisions, migration/rollback runbook, changed files, and commands actually executed. Offline deterministic tests use local database/fixtures and fake platform tools; dependency downloads/build preparation are separate from test network requirements.

See [Project Status](../../../PROJECT-STATUS.md) for the roadmap; future numbering can evolve.
