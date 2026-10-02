---
name: Wave 05 — Task 04 — Stream and Recording Relational Persistence
wave: 05
order: 04
depends_on:
  - 03-creator-watch-target-persistence.task.md
status: planned
---

# Wave 05 — Task 04 — Stream and Recording Relational Persistence

## Status and Preconditions

planned — execution has not started. Read the [wave specification](README.md) and complete the predecessor's independent validation/review and human acceptance gate before starting. The shared scope, security, testing, and lifecycle constraints apply to this task.

## Context / Objective

Establish Stream and Recording persistence on the API/repository side using the approved schema. Current Worker operational writes still require a dedicated bridge in 05-T05; this task must not claim that integration is complete.

## Required Changes

- Implement relational repositories for Stream creation/reuse/query/finalization and Recording attempt/lifecycle persistence with explicit transactions from 05-T01.
- Preserve IDs, session_id compatibility, watch_target_id, started_at/finished_at, output_file, and state. Keep idle/offline/recording/finished/error contracts; do not rename finished to conceptual COMPLETED.
- Persist valid stream_id for new relational Recording writes when broadcast context is known. Apply approved historical-reference policy for missing legacy links; never invent historical stream_id.
- Support multiple Recording attempts per Stream, repeated live observations retaining a Stream, and later broadcasts with new IDs.
- Enforce Recording.watch_target_id matching its referenced Stream.watch_target_id through approved DB constraints/transactional validation.
- Preserve history after WatchTarget/Creator deletion according to the approved policy, including orphan legacy scenarios and relevant immutable context. Do not cascade-delete useful history or media.
- Honor approved timestamp representation and timezone-free input handling; do not silently reinterpret local wall-clock timestamps as UTC.
- Preserve modern/legacy API reads, response/error shapes, session/channel compatibility, watchTargetId filters, and safe recording filesystem-location lookup using persisted metadata.
- Retain adapters where needed and the approved narrow repository seam; avoid generic framework or unrelated endpoint redesign.

## Authority and Checkpoint

Prove relational history behavior with repository/API test inputs in disposable DB fixtures. Existing installations keep their approved authority until 05-T06. Do not activate a Stream/Recording live authority cutover, import existing user history, or change Worker operational persistence here.

A passing repository/API suite does not prove ongoing Worker activity reaches PostgreSQL. That requirement belongs to 05-T05 and wave-level acceptance.

## Acceptance Criteria

- [ ] Stream and Recording CRUD/lifecycle repository operations persist correctly with approved transactions.
- [ ] Modern/legacy API history, filters, identifiers, local output metadata, and states remain compatible.
- [ ] New stream_id links are durable and target-consistent; invalid references/mismatches are rejected.
- [ ] Multiple attempts, Stream reuse/later broadcasts, timestamps, and restart persistence are tested.
- [ ] Unknown historical links remain unknown under explicit policy.
- [ ] Deletion/orphan handling preserves history and local files according to 05-T01.
- [ ] DB read/write failure and transactional rollback behavior are explicit at this repository boundary.
- [ ] No claim or implementation of complete Worker bridge or live-installation cutover occurs.

## Automated Tests / Verification

Use real isolated PostgreSQL tests for Stream/Recording persistence, FKs, mismatched targets, null/unknown historical links, transactions, timestamps, IDs, lifecycle transitions, retries as distinct attempts, restart persistence, and database unavailability at the repository layer.

Run API pnpm test --runInBand, pnpm exec tsc --noEmit, pnpm build; relevant modern/legacy adapters and filesystem-location regressions; selected DB integration commands; git diff --check. Fixtures contain no real user data or platform calls.

## Risks / Rollback

Risks: losing legacy session IDs, false historical joins, unsafe cascade deletion, timezone reinterpretation, and misleading claims of Worker readiness. Roll back the repository activation according to the authority ledger while preserving schema/data compatibility and history. No JSON/media deletion or normal-volume reset.

## Notes for Coordinator / Sol / Terra / Luna

Sol checks lifecycle/schema mapping; Terra implements API/repository scope. Coordinator validates relationship and API evidence before Luna reviews history integrity and checkpoint limits. Worker bridge coverage is a later independent gate.
