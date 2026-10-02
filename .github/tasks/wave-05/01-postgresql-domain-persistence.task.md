---
name: Wave 05.1 PostgreSQL Domain Persistence
wave: 05
order: 01
depends_on:
  - ../wave-04.75/05-wave-integration-qa-documentation.task.md
status: planned
---

# Wave 05.1 — PostgreSQL Domain Persistence

## Status

planned — implementation has not started. This task is the formal plan for a later execution.

## Context / Problem

Current NestJS uses StreamsRepository plus JSON adapters. Worker polls watchlist.json and writes channels_status.json, streams.json, and sessions.json. Creator is derived from display_name/channel_name, not independently persisted. Recording uses session_id; both sessions adapters omit stream_id. API exposes modern and legacy contracts and filesystem browsing; local recordings already exist.

Shared JSON combines domain storage and operational communication. Replacing all files at once would break the working local slice, existing installations, and Worker coordination. PostgreSQL must become primary domain persistence, not merely an imported copy that stops receiving new activity.

## Objective

Incrementally make PostgreSQL the definitive primary store for Creator, WatchTarget, Stream, and Recording while preserving current functional behavior, local media storage, and separate domain concepts.

## Scope

### In Scope

- Repository/adapter and writer inventory; ORM/query-layer decision.
- Local PostgreSQL schema, reproducible migrations, constraints, indexes, transactions, environment configuration, and Compose persistence.
- Independently persisted Creator identity and CRUD; compatible WatchTarget configuration.
- Durable Stream/Recording history and ongoing lifecycle updates.
- Minimal persistence seam and explicit API/Worker compatibility bridge.
- Existing local data import policy, backup/idempotence/rollback, regression tests and runbook.

### Out of Scope

User persistence; authentication; password hashing; JWT; User ownership; Redis; BullMQ; Recording Jobs; Tags; SSE; WebSocket; Worker heartbeat; Google Drive; Dropbox; OneDrive; OAuth; CloudStorageConnection; CloudExport; cloud upload; Tauri; Hosted deployment; public recordings; public indexing; public streaming.
No media pipeline rewrite, retention implementation, or unrelated frontend redesign.

## Required Investigation Before Implementation

Inspect actual Controllers/Services/StreamsRepository, both languages' adapters, Worker load/save/reload/poll/lifecycle paths, filesystem service, modern/legacy API tests, frontend proxy/types, Compose, and smoke fixtures. Update this plan if code has evolved.

Produce a responsibility matrix for each file with readers, writers, write timing, identifiers, authoritative fields, restart behavior, and proposed transition:

| File | Current role to investigate |
| --- | --- |
| watchlist.json | Configuration/domain storage plus name-derived Creator identity |
| streams.json | Domain broadcast history and active-stream reload |
| sessions.json | Legacy Recording history and restart/lifecycle compatibility |
| channels_status.json | Operational/runtime snapshot merged into API reads |

Do not assume operational channels_status.json must vanish with domain migration. Decide what remains transient, what belongs in PostgreSQL, and how runtime snapshots combine with durable queries. Distinguish Stream lifecycle from probe state and process liveness.

Record current API response/status/validation contracts, including read-only Creator routes, PATCH omission/empty-subdirectory semantics, filter names, session_id, enabled legacy default, quality preference, URL, and legacy channel_id. No arbitrary ORM choice or inferred historical FK is acceptable.

## Database / Query-Layer Decision

No ORM/query layer is selected in current project instructions or API dependencies. Before adding one, compare Prisma, Drizzle, TypeORM, and direct SQL/query builder in a short decision record.

Evaluate solo maintenance, migration ergonomics/reproducibility, type safety, NestJS dependency injection, PostgreSQL capabilities, overhead, test isolation, transactions, future ownership, and future Tags. Choose the smallest maintainable fit with concrete reasons and rejected alternatives. Recheck existing explicit decisions if repository instructions have changed; document inconsistencies rather than silently overruling them.

## Relational Model Requirements

Plan at least these concepts:

```text
Creator -> WatchTarget
WatchTarget -> Stream
WatchTarget -> Recording
Stream -> Recording
```

Validate cardinalities from current behavior: one Creator can have multiple targets; each detected Stream currently references a target; one Stream can have multiple capture attempts. Decide whether future broadcast identity across multiple targets is relevant now without inventing a new domain.

- Define stable Creator IDs independent of mutable names; provide an explicit mapping for legacy name IDs and duplicate/ambiguous names.
- Preserve existing WatchTarget, Stream, and session_id values during import where valid. Document ID/API compatibility rather than silently replacing identifiers.
- Persist new Recording-to-Stream links with enforced integrity. Imported links absent from sessions.json remain explicitly unknown unless reliable provenance proves them.
- Account for history whose target was removed. Specify archive/soft-delete/restrict or another justified policy; do not cascade-delete recordings/history by convenience.
- Validate consistency of Recording target and referenced Stream target, using appropriate constraints or transactional validation.
- Preserve quality, enabled, URL, recording_subdir, timestamps, lifecycle, and local output metadata. Historical snapshot requirements must be explicit.
- Decide timestamp representation and interpretation of timezone-free legacy values. Do not silently reinterpret local wall-clock as UTC.
- Preserve current idle/offline/recording/finished/error contracts; conceptual COMPLETED is not authorization for a state rename.
- Define necessary indexes, uniqueness constraints, nullability, transaction boundaries, and conflict behavior.
- Future ownership/Tags must be feasible, but do not add User, fictitious user_id, placeholder ownership, or Tag tables now.

## Incremental Compatibility Strategy

Reuse current StreamsRepository/adapters as seams. A small domain repository interface with JSON/PostgreSQL implementations is an option, not a requirement for a generic framework.

Before each stage, specify primary source, secondary compatibility projection, readers/writers, checkpoint, and rollback. Suggested checkpoints:

1. Preserve JSON behavior behind the chosen narrow seam; run contract tests.
2. Add local DB/migrations and repository integration in isolated fixtures.
3. Establish Creator persistence/CRUD and migrate target configuration with explicit name-ID translation.
4. Switch durable Stream/Recording writes and reads, including ongoing Worker activity.
5. Import/verify retained history, then retire superseded domain reads/writes only after acceptance.

Evaluate Worker integration through API-mediated persistence, a bounded JSON ingestion/projection bridge, or a justified direct DB adapter. Record the selected approach and consistency guarantees. Do not introduce Redis/jobs just to connect Worker to persistence.

If JSON remains a runtime transport, PostgreSQL is the domain authority and projections/ingestion need deterministic reconciliation, stable IDs, replay/idempotence, deletion handling, bounded retries, and recovery. Define configuration propagation and event ordering. Avoid independently writable dual primaries, silent JSON fallback when DB is down, and stale database history.

Preserve pre-launch refreshed configuration guards, disabled behavior, adaptive preference semantics, child-process cleanup, terminal persistence recovery, and independently restartable Worker behavior. Define DB failure behavior before capture launch and during terminal updates: no false durable success, discarded valid local media, or blind duplicate capture.

Existing legacy routes/adapters and frontend views must continue to work. Creator CRUD is new within these domain persistence requirements; route semantics/deletion behavior must be documented without breaking existing Creator GET/name references. Extend the proxy only if necessary; no UI redesign.

## Local Data Migration Policy

Default plan: explicit opt-in local migration command/script, not destructive automatic startup import. Reconsider only with documented evidence and equivalent safety.

Require:
- Dry-run validation/report and backup of all four input JSONs before import; preserve originals and recording files.
- Quiesce API/Worker writers or use a documented consistent snapshot procedure; never import a moving, partial snapshot.
- Stable ID/name mapping and import order (Creator, WatchTarget, Stream, Recording), conflict/orphan policy, and missing stream_id handling.
- Treat channels_status.json as operational data unless investigation justifies specific durable fields; do not blindly import it as domain history.
- Idempotent re-execution with an import manifest/checkpoint and duplicate detection; deterministic collision handling.
- Missing files/valid empty collections as defined inputs; malformed, zero-byte, invalid shape, invalid fields, duplicate IDs, and unresolved references produce actionable reports without silently replacing data with empty state.
- Transactional batches or another explicit partial-failure recovery policy; no completion marker until verification succeeds.
- Before/after counts, field/relationship verification, documented restart procedure, and interrupted-import retry.
- Rollback runbook covering DB backup/schema compatibility, restoring JSON authority, reconciling any writes since cutover, and safe service order. A pre-cutover backup alone cannot roll back post-cutover history without loss.
- Keep backups/import manifests private and outside version control. Do not commit user data or credentials.

No migrator is implemented in this planning execution.

## Local Docker and Configuration

Later implementation should add a local postgres service to compose.yml with:
- Persistent local volume surviving ordinary restarts/recreation.
- Healthcheck and deliberate startup/readiness handling.
- Environment-based connection settings; .env.example if needed.
- No real committed credentials; clearly documented safe development defaults.
- Local-only exposure where possible and Docker Desktop/Windows compatibility.
- Reproducible schema setup without wiping local volumes.
- Isolated test database/project and conservative cleanup limited to owned fixtures.

Keep existing local recording mounts, API read-only access, frontend proxy, and non-root Worker behavior. PostgreSQL stores metadata, not recording media. No cloud service is needed.

## Acceptance Criteria

- [ ] Responsibility matrix and ORM/query-layer decision are recorded before implementation.
- [ ] PostgreSQL is primary for all four selected entities, including new Worker lifecycle writes after cutover.
- [ ] Creator has independent stable persistence/CRUD; legacy identity mapping is explicit and tested.
- [ ] Creator, WatchTarget, Stream, Recording remain separate with validated relationships, history-safe deletion, and integrity enforcement.
- [ ] Relevant modern/legacy route responses, validation, filtering, and configuration semantics remain compatible.
- [ ] Known absent historical stream_id is handled honestly; new links are durable.
- [ ] Durable domain state and local media survive service/database restart.
- [ ] Schema/migrations are reproducible for clean and existing local installations.
- [ ] Existing local data can migrate with backup, opt-in dry-run, idempotence, malformed-data reporting, and executable rollback instructions.
- [ ] Transitional JSON adapters/runtime bridge preserve Worker operation without uncontrolled dual primaries or flag-day replacement.
- [ ] Local Compose/healthcheck/configuration works on Docker Desktop/Windows with persistent storage and no real secrets.
- [ ] Database unavailability has explicit tested failure/recovery behavior without false completion or lost valid local files.
- [ ] No cloud account/service is necessary; recordings remain local.
- [ ] Offline automated regression/integration tests pass with isolated local PostgreSQL and fake media tools.
- [ ] No out-of-scope future feature is introduced.

## Automated Tests

Use current frameworks and add real PostgreSQL integration tests, not only mocked repositories:
- Creator CRUD, stable IDs, rename/grouping and legacy name mapping.
- WatchTarget CRUD/configuration, sibling independence, enabled/defaults, preferred quality, URL, recording_subdir and PATCH semantics.
- Stream/Recording persistence, FKs, repeated attempts, lifecycle, timestamps, IDs, output metadata, historical missing references.
- Restart persistence, clean/upgrade migrations, migration replay/import idempotence, malformed data and interrupted import.
- API modern/legacy regression and filesystem location reads.
- Worker compatibility, configuration propagation, retries, terminal writes, subprocess shutdown, and runtime/domain reconciliation.
- DB unavailable at startup, read/write, launch and completion stages; recovery without duplicates.
- Current deterministic frontend/component/proxy and Docker smoke gates as affected.

No test may depend on Twitch, YouTube, Kick, internet, or a real live stream. Prepare images/dependencies separately when downloads are necessary; tests use local DB and isolated fixtures. Fake output never proves playable media.

## Manual Verification

With disposable data, dry-run/import representative legacy JSON, start the local stack, create/edit independent targets, simulate broadcasts using fake Streamlink, inspect relational history, restart services/database, verify local file locations, exercise DB outage/recovery, and rehearse rollback. Never use real user runtime-data/media as fixtures.

## Verification Commands

Existing regression commands for the later execution:
- API: pnpm test --runInBand; pnpm exec tsc --noEmit; pnpm build.
- Frontend: pnpm test; pnpm typecheck; pnpm build.
- Worker: python -m unittest discover -s worker -p test_worker.py; python -m pytest worker/test_worker.py -q.
- Root: docker compose config --quiet; pnpm test:smoke; git diff --check.

The implementer must add exact selected-tool migration, import dry-run/replay, DB integration, restart/outage, and rollback commands to the runbook before declaring acceptance. Avoid destructive commands against normal local volumes.

## Dependencies / Risks / Rollback

Depends on integrated Wave 04.75, current contracts/adapters/tests, and available local PostgreSQL tooling during implementation. No later-wave auth, queue, cloud, or desktop dependency.

Highest risks are Creator-name collisions, orphan history, lost Recording/Stream provenance, timezone reinterpretation, API/Worker divergence, partially persisted lifecycle, and post-cutover rollback loss. Mitigate with documented decisions, isolated migration rehearsal, staged authority changes, and verified backups/reconciliation.

Rollback must be checkpoint-specific and account for writes after each switch. Do not delete JSONs or DB volumes as cleanup until retention/recovery policy explicitly authorizes it.

## Notes for Coordinator / Sol / Terra / Luna

For later implementation, Sol investigates and records decisions/seams before Terra changes runtime. Coordinator validates contract/data gates before Luna reviews migration safety and evidence. Keep status planned in this documentation-only execution; no commit/push or implementation acceptance is implied.
