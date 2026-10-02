---
name: Wave 05 — Task 07 — Wave Integration QA and Documentation
wave: 05
order: 07
depends_on:
  - 06-legacy-json-migration-cutover.task.md
status: planned
---

# Wave 05 — Task 07 — Wave Integration QA and Documentation

## Status and Preconditions

planned — execution has not started. Read the [wave specification](README.md) and complete the predecessor's independent validation/review and human acceptance gate before starting. The shared scope, security, testing, and lifecycle constraints apply to this task.

## Context / Objective

Validate the complete wave after all six checkpoints have passed their own review/acceptance gates. Consolidate evidence and operational documentation; earlier component success alone does not prove a safe installation upgrade or ongoing Worker persistence.

## Scope

Integration QA and documentation for implemented Wave 05 behavior only. Repair only wave-caused integration/test/documentation gaps; substantive decision/schema/bridge/migration defects return to the owning checkpoint through Coordinator with impact review.

No new product feature, full frontend redesign, live-platform dependency, user-data manipulation, or later-wave infrastructure. The [wave-level acceptance criteria](README.md#wave-level-acceptance-criteria) must all be evidenced before declaring wave completion.

## Required QA Matrix

| Area | Required evidence |
| --- | --- |
| Clean installation | Local PostgreSQL/Compose readiness, clean migrations, expected schema, safe configuration |
| Existing installation | Opt-in dry-run/backup/import/verification with representative legacy data; malformed/conflicting inputs |
| Domain | Creator stable CRUD/name mapping; independent WatchTargets/configuration; Stream/Recording lifecycle, IDs, timestamps, valid relationships and unknown historical links |
| API/legacy | Modern/legacy adapters, errors/validation/filtering, session_id/channel_id compatibility, safe file-location metadata |
| Worker | Fresh lifecycle activity reaches PostgreSQL; configuration refresh, enabled, authoritative URL, quality preference, Stream reuse/attempts, subprocess cleanup |
| Failure/recovery | DB unavailable at startup/pre-capture, during capture, terminal write; Worker/API/PostgreSQL restarts; duplicate/replayed updates; no false durable success |
| Persistence | Domain state survives restart; schema upgrade/replay; one authority per entity; no silent fallback/stale relational history |
| Frontend/local files | Existing creation/edit/delete/polling and loading/error flows; recording browser/folder picker; valid local media retained/private |
| Migration/rollback | Idempotence, interrupted import, reconciliation, post-cutover writes, and executable rollback rehearsal |
| Infrastructure | Docker Desktop/Windows, persistent volume, health/readiness, mounts, non-root Worker, isolated test DB/project |

Assert no premature User/auth, Redis/BullMQ/jobs, Tags, SSE/heartbeat, cloud/OAuth/export, Tauri, Hosted Mode, public recordings, indexing, or streaming was introduced.

## Required Commands and Evidence

Execute these against the integrated candidate, or cite reproducible evidence tied to the exact reviewed code/environment and confirm it is not stale. Any blocked/missing required gate remains explicit and prevents claiming full acceptance.

From api:
- pnpm test --runInBand
- pnpm exec tsc --noEmit
- pnpm build

From repository root:
- python -m unittest discover -s worker -p test_worker.py
- python -m pytest worker/test_worker.py -q
- docker compose config --quiet
- pnpm test:smoke (Docker/integration smoke, extended for the approved DB/bridge path)
- git diff --check

From frontend:
- pnpm test
- pnpm typecheck
- pnpm build

Also execute the exact selected-tool clean/upgrade migrations, real isolated PostgreSQL repository/integration tests, legacy import dry-run/replay, outage/restart/reconciliation, and rollback commands established by 05-T02–05-T06. Test an empty installation and an existing installation with disposable data; a happy-path smoke alone is insufficient.

No automated test may depend on Twitch, YouTube, Kick, internet, or a live stream. Pre-fetch dependencies/images separately when needed. Use fake Streamlink/processes and owned temporary media. Fake media does not prove playable MP4, explicit FFmpeg finalization, or real-platform recovery.

Do not use normal local runtime-data, recordings, or DB volumes as fixtures. Avoid mutating lint as a read-only gate and retain exact cleanup ownership.

## Documentation Deliverables for Later Execution

Update the relevant runbooks/status/task evidence when this task is actually executed:
- Current versus target architecture and installed dependencies.
- Local startup, environment examples, PostgreSQL volume/health/readiness, and Windows paths.
- Domain authority ledger, surviving JSON roles, chosen Worker boundary, and compatibility limits.
- Clean schema setup, migrations, opt-in import/dry-run/backup, validation, restart, replay, and rollback instructions.
- DB outage/recovery behavior and how to distinguish process liveness, HTTP health, probe, capture, and playable media.
- Current local/private recording storage and future optional cloud.
- Requirement-to-test mapping, commands/results, changed-file inventory, and honest remaining limitations.

This is future QA documentation scope, not permission for the current planning reorganization to edit outside wave-05.

## Acceptance Criteria

- [ ] All predecessor checkpoints have completed review and human acceptance; code presence alone is not sufficient.
- [ ] Every wave-level acceptance criterion maps to concrete passing evidence.
- [ ] Both clean-install and existing-install upgrade paths pass.
- [ ] New Worker activity, relationships, API/legacy/frontend behavior, and local recording access pass integrated regression.
- [ ] DB outage/restarts/replay and rollback after new writes are verified without data loss/false success.
- [ ] Required API/Worker/frontend/schema/migration/Compose/Docker gates pass against the reviewed candidate.
- [ ] Documentation matches code and contains executable operational/migration/rollback commands.
- [ ] No unsupported playable-MP4/live-platform or implemented-future-feature claims appear.
- [ ] No out-of-scope feature, secret, real fixture data, or unrelated change remains.
- [ ] Final diff/scope review is ready for human approval; no automatic staging, commit, or push.

## Risks / Rollback / Workflow

Stale component evidence, hidden dual writers, incomplete rollback, or fake-media claims can create false wave completion. Coordinator consolidates the matrix and checks the final candidate before Luna's independent QA. Terra only fixes approved wave-caused gaps; substantive defects return to their owner, followed by focused and affected integration validation.

Preserve the established fixing/coordinator-review limits and user-approve -> done human gate. Rollback uses the already rehearsed checkpoint-specific runbook; QA must not invent destructive reset commands or erase valid media.
