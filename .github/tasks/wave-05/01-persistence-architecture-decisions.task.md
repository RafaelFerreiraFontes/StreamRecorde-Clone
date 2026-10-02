---
name: Wave 05 — Task 01 — Persistence Architecture and Cutover Decisions
wave: 05
order: 01
depends_on:
  - ../wave-04.75/05-wave-integration-qa-documentation.task.md
status: planned
---

# Wave 05 — Task 01 — Persistence Architecture and Cutover Decisions

## Status and Preconditions

planned — execution has not started. Read the [wave specification](README.md) and complete the predecessor's independent validation/review and human acceptance gate before starting. The shared scope, security, testing, and lifecycle constraints apply to this task.

## Context / Objective

Freeze the persistence decisions needed before runtime changes. Current JSON files mix configuration, history, and operational communication; name-derived Creator identity and missing legacy stream_id make an unplanned replacement unsafe.

This checkpoint produces only decisions/documentation. No PostgreSQL service, dependency, schema execution, migration implementation, Worker change, or runtime test is required.

## Required Investigation

Inspect the actual Controllers/Services/StreamsRepository, API and Python JSON adapters, Worker load/save/reload/poll/lifecycle paths, filesystem service, DTOs, frontend proxy/types, Compose, and current API/Worker/component/smoke tests. Code wins over historical claims.

Produce an inventory for every JSON reader/writer, including startup, normal mutation, reload, shutdown, terminal retry, and test/legacy access. For each file record readers, writers, write timing, IDs, authoritative fields, failure behavior, and restart behavior:

| File | Starting responsibility |
| --- | --- |
| watchlist.json | Configuration/domain storage and derived Creator identity |
| streams.json | Broadcast history and active-stream reload |
| sessions.json | Legacy Recording history/reload; channel_id mapping |
| channels_status.json | Operational/runtime snapshot, not domain history by default |

Separate durable domain state, derived projections, operational snapshots, and process liveness. Decide whether any channels_status.json fields need durable storage; document exceptions explicitly.

Inventory API response/status/validation contracts, read-only Creator routes, session_id, watchTargetId filters, legacy channel_id, PATCH omission/empty-folder semantics, enabled legacy default, quality, URL, and recording_subdir.

## Required Decisions

### ORM / Query Layer

Compare Prisma, Drizzle, TypeORM, and direct SQL/query builder. No choice is made by this plan. Evaluate solo maintenance, migrations/reproducibility, type safety, NestJS/PostgreSQL fit, runtime/tooling overhead, transactions, test isolation, future ownership, and Tags. Record selection, rejected alternatives, and reasons; reconcile any newer explicit repository decision.

### Relational Model and Historical Policy

Propose Creator, WatchTarget, Stream, Recording with validated cardinalities:
Creator -> WatchTarget; WatchTarget -> Stream and Recording; Stream -> multiple Recording attempts.

Define stable Creator IDs independent of names; legacy name mapping, duplicate/ambiguous names and rename behavior; preservation of valid target/Stream/session_id values; nullability, uniqueness, indexes, FKs, and conflict rules.

Specify new valid Recording.stream_id relationships and consistency with Recording.watch_target_id versus Stream.watch_target_id. Missing historical stream_id remains unknown unless reliable provenance proves the link. Do not infer links from rough timestamp/name matching.

Decide history-safe target/Creator deletion and orphan handling (archive/soft-delete/restrict or justified alternative), immutable historical context, timestamp representation, and treatment of timezone-free legacy wall-clock values. No silent reinterpretation as UTC.

Preserve idle/offline/recording/finished/error contracts; conceptual COMPLETED is not a state rename request. Define transaction boundaries for entity writes, lifecycle, projections, and partial failures. Do not add User, fictitious user_id, ownership placeholders, or Tag/cloud tables.

### Worker Persistence Strategy

Explicitly compare all three options before selecting:

- A. Worker -> internal/API persistence boundary.
- B. Worker -> bounded JSON event/projection bridge -> API/PostgreSQL.
- C. Worker -> direct PostgreSQL adapter.

Evaluate changes to both languages, schema coupling, trust/local exposure, API availability, DB failure behavior, restart/replay/idempotence, ordering, durability, reconciliation, configuration propagation, testability, and solo operational cost. Keep Worker polling and media execution; no Redis/BullMQ/Recording Jobs.

Record the chosen boundary, acknowledgment/durability semantics, configuration path, ongoing Stream/Recording writes, and operational channels_status.json handling. Design a narrow seam using existing repositories/adapters, not an arbitrary generic framework.

### Authority and Cutover Ledger

For each stage 05-T02–05-T07 and each entity/file, record:

| Stage/entity | Primary authority | Readers | Writers | Compatibility projection | Activation condition | Rollback checkpoint |
| --- | --- | --- | --- | --- | --- | --- |

Define how 05-T03/05-T04 relational paths and 05-T05 Worker integration can be exercised in disposable environments without switching an unmigrated existing installation. Live installation import/cutover belongs to 05-T06.

Specify a single authority, projection direction, deletion propagation, bounded retries, duplicate/replayed updates, ordering and reconciliation. No flag-day migration, independently writable dual primaries, or silent fallback leaving PostgreSQL stale.

Define policy for DB unavailability before/during capture and terminal writes, Worker/API/PostgreSQL restarts, and recovery. Do not report false durable success, blindly duplicate capture, or discard valid local media.

Plan explicit opt-in import with dry-run/backup/idempotence, consistent snapshots, and checkpoint-specific rollback accounting for writes after cutover. The exact migrator is 05-T06.

## Deliverables / Checkpoint

Record the responsibility matrix, API compatibility inventory, ORM decision, schema proposal, Worker comparison/decision, authority ledger, failure policy, and migration/rollback design in reviewable decision documents under this wave (or an existing canonical architecture location explicitly agreed during execution).

Unresolved blocking decisions return to Coordinator; they are not delegated as guesses to later implementers. A revised decision needs impact review before dependent runtime work changes.

## Acceptance Criteria

- [ ] Complete JSON readers/writers and domain/runtime responsibility inventory is tied to actual code.
- [ ] ORM comparison and justified decision are recorded without popularity-based selection.
- [ ] Schema/IDs, legacy mapping, timestamps, historical references/deletion, constraints/indexes, and transaction policy are explicit.
- [ ] Worker options A/B/C are evaluated and one justified integration strategy is documented.
- [ ] Each stage has authority/readers/writers/projection/activation/rollback entries; no unresolved dual-primary design.
- [ ] Outage/restart/replay, migration, and post-cutover rollback requirements are assigned to dependent checkpoints.
- [ ] Decisions preserve local output and all shared exclusions.
- [ ] Only decisions/documentation changed; no PostgreSQL execution/runtime implementation is required or claimed.

## Verification / Risks / Rollback

Review decisions against source and representative existing fixtures without modifying user data. Validate document links/frontmatter/dependencies and run git diff --check. No PostgreSQL-running or runtime-suite acceptance gate applies to this task.

Risks: freezing assumptions without tracing all writers; conflating operational snapshots with history; recovering nonexistent provenance. Rollback is revision of decisions before dependent implementation, with explicit impact tracking if revisited later.

## Notes for Coordinator / Sol / Terra / Luna

Sol investigates and proposes; Terra's scoped deliverable is the decision documentation; Coordinator validates completeness/consistency; Luna reviews the architectural contracts independently. Do not advance dependent work merely because the documents were drafted.
