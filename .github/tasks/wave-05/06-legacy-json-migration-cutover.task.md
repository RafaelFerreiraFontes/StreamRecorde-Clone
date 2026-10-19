---
name: Wave 05 — Task 06 — Legacy JSON Migration and Authority Cutover
wave: 05
order: 06
depends_on:
  - 05-worker-persistence-bridge.task.md
status: done
---

# Wave 05 — Task 06 — Legacy JSON Migration and Authority Cutover

## Status and Preconditions

done — Legacy JSON migration CLI and controlled cutover implemented, validated, independently reviewed, and accepted by human gate for downstream Wave 05 work. Explicit dry-run, backup with SHA-256 manifest, transactional import, idempotent replay, verify, and fail-closed cutover-check verified in isolated environments without modifying real user data. Read the [wave specification](README.md) and complete the predecessor's independent validation/review and human acceptance gate before starting. The shared scope, security, testing, and lifecycle constraints apply to this task.

## Context / Objective

Deliver the explicit opt-in migrator and activate only the authority switches approved in 05-T01 after the Worker bridge has passed its independent gate. Existing installations must migrate without a flag-day replacement or loss of local recordings/history.

Implement an explicit, safe, auditable, reproducible, and idempotent migration CLI tool and controlled cutover procedure to transition installations from legacy JSON persistence to relational PostgreSQL authority, using synthetic fixtures in isolated test environments.

## Input and Backup Policy

Domain sources are watchlist.json, streams.json, and sessions.json according to the approved responsibility matrix. channels_status.json stays operational by default; any imported durable subset requires an explicit prior documented decision.

Back up all relevant JSON files (including the operational snapshot when present), schema/DB state as needed, and mapping/manifest metadata before writes. Backing up a file does not mean importing it as domain history. Preserve original files and recording media.

The default policy is an explicit opt-in local command/script, not destructive automatic startup import. Require dry-run validation/report before mutation. Quiesce API/Worker writers or use a documented consistent snapshot procedure; never import a moving, partial snapshot.

Record origin paths, file sizes, SHA-256 checksums, capture timestamps, tool versions, destination schema, and configuration in a verifiable migration manifest. Keep backups and manifests private; never commit real user data or snapshots.

## Required Changes

- Implement a non-destructive dry-run command that validates JSON syntax, entity shapes, IDs, references, duplicate keys, Creator name collisions, orphan records, conflicting active Streams, and invalid states, producing an actionable report.
- Quiesce domain writes: document and enforce pausing Worker capture launches, draining pending outbox events, and stopping API/Worker writers before snapshot capture.
- Implement transactional and idempotent import in dependency order: Creators, WatchTargets, Streams, Recordings.
- Map Creator identity deterministically to stable UUIDs; resolve legacy name IDs using canonical normalization (trim/lowercase); detect ambiguous duplicate names and report conflicts rather than guessing or merging Creators.
- Preserve existing WatchTarget UUIDs, creator relationships, channel names, platforms, URLs, qualities, enabled states (missing defaults to true), and recording subdirectories.
- Preserve Stream UUIDs, states, and timestamps. An active Stream requires both finished_at and legacy_finished_at_raw to be NULL; report conflicting multiple open Streams for a target before activation.
- Preserve Recording session_id as the primary key. Map channel_id to watch_target_id. Set legacy recordings.stream_id to NULL; never infer historical links from timestamp or channel proximity.
- Preserve legacy timezone-free wall-clock timestamps verbatim in legacy_started_at_raw and legacy_finished_at_raw; leave typed timestamp columns NULL in the absence of verified timezone provenance.
- Enforce idempotence: re-running with the same snapshot and manifest is a no-op; conflicting data under the same identifier fails explicitly.
- Implement the controlled cutover procedure: verify post-import counts and integrity, activate RELATIONAL_STORAGE=true on the API and PERSISTENCE_MODE=bridge on the Worker, and ensure Worker reads configuration from GET /internal/v1/watch-targets/execution-configs while retiring direct JSON domain writes.
- Define rollback and forward repair: before activation, restore JSON configuration; after post-cutover writes, preserve PostgreSQL state, outbox events, and media files, using forward repair rather than lossy reverse export to legacy JSON.

## Authority and Checkpoint

PostgreSQL becomes the primary authority for Creator, WatchTarget, Stream, and Recording only for explicitly opted-in, verified installations. Default startup remains JSON-authoritative until operator activation.

The Worker persistence bridge (05-T05) must be verified before this task. Test all migration, cutover, and rollback procedures exclusively against synthetic fixtures in isolated test environments. Do not execute migration or cutover on real user runtime-data, recordings, or normal persistent volumes.

## Acceptance Criteria

- [x] Non-destructive dry-run validates source JSON files, checks constraints, detects collisions/orphans/conflicts, and outputs an actionable report.
- [x] Quiesced snapshot and backup procedure captures consistent JSON files with verified SHA-256 manifest.
- [x] Explicit opt-in import populates PostgreSQL transactionally in dependency order (Creators, WatchTargets, Streams, Recordings).
- [x] Creator stable UUID mapping, normalized keys, collision detection, and ambiguous-name conflict handling are verified.
- [x] WatchTarget fields, legacy enabled default, and sibling independence are preserved.
- [x] Stream IDs, states, timestamps, and active Stream invariants are preserved without duplicate open Stream conflicts.
- [x] Recording session_id, channel_id mapping, and nullable legacy stream_id (NULL) are preserved without fabricated links.
- [x] Timezone-free timestamps are preserved in raw columns without silent UTC reinterpretation.
- [x] Idempotent re-run produces no duplicate records or state corruption; conflicting input fails visibly.
- [x] Controlled authority cutover activates relational API and Worker bridge without independently writable dual primaries.
- [x] Checkpoint-specific rollback and post-cutover forward repair preserve domain state, outbox events, and local media.
- [x] All procedures tested against synthetic fixtures in isolated environments without modifying real user data or recordings.

## Automated Tests / Verification Commands

Use synthetic legacy JSON fixtures, temporary directories, and isolated PostgreSQL containers (e.g. compose.test-db.yml on port 55432).

Test:
- Dry-run validation on valid, legacy, malformed, and conflicting fixtures.
- Backup creation and manifest SHA-256 verification.
- Clean transactional import and entity count verification.
- Idempotent re-run with identical snapshot (zero duplicate inserts).
- Conflict rejection with modified snapshot under existing manifest.
- Creator name collision and ambiguous-name handling.
- Missing historical stream_id remaining NULL.
- Preserved raw legacy timestamps without UTC conversion.
- Controlled cutover: API relational mode + Worker bridge mode active together.
- Rollback before activation (clean return to JSON mode).
- Forward repair after post-cutover writes without media or history loss.

Run API typecheck, build, and tests; run Worker test suite; run isolated DB migration tests; run git diff --check. No platform network calls or real user data.

## Risks / Rollback

Risks: partial import left uncommitted, ambiguous Creator grouping, fabricated historical links, lossy reverse export after cutover, or accidental cutover of unmigrated installations.

Rollback before activation: drop disposable database resources and revert environment configuration to JSON mode. Original files remain untouched.
Rollback after post-cutover writes: do not perform lossy reverse export to JSON; freeze new launches, retain PostgreSQL, outbox events, and media, and apply forward repair or restore full database backup with outbox replay.

## Notes for Coordinator / Sol / Terra / Luna

Sol analyzes legacy formats, entity mapping, and transactional import boundaries. Terra implements the CLI migrator, manifest, and isolated test harness. Coordinator validates dry-run, import, cutover, and rollback against synthetic fixtures before Luna independently reviews migration integrity and safety. Task 07 handles whole-wave QA.
