---
name: Wave 05 — Task 07 — Wave Integration QA and Documentation
wave: 05
order: 07
depends_on:
  - 06-legacy-json-migration-cutover.task.md
status: done
---

# Wave 05 — Task 07 — Wave Integration QA and Documentation

## Status and Preconditions

done — candidate fully verified across all automated suites, isolated Docker live integration (Scenarios A and B), isolated upgrade, forward-repair, and rollback rehearsal, and comprehensive documentation updates. Three formal Luna review iterations were executed; the third review returned `FAILED_REVIEW_LIMIT` regarding Phase 7c lossy-data assertion claims. Under project instructions Section 40.5, authority transferred to Coordinator, which technically reconciled all findings with concrete operational assertions in `test-wave05-rehearsal.mjs` (CLI command rejection and schema incompatibility proven) and verified pytest on Worker. Completion formally authorized by Human Acceptance Gate. All Wave 05 tasks (01–07) are complete.

## Execution and Evidence Summary

- **Docker Modernization**: Application images standardized to `streamrecorder-api:wave-05`, `streamrecorder-frontend:wave-05`, `streamrecorder-worker:wave-05`. Zero obsolete tags remain in Compose files or smoke harnesses.
- **Docker Build Fix**: Resolved pnpm 11 supply-chain script block in `api/Dockerfile` using `--ignore-scripts` during the builder install phase, enabling clean non-interactive container builds without impacting runtime tools.
- **Scenario A (Legacy JSON Mode)**: `node scripts/docker-integration-smoke.mjs` executed and passed all 18 gates in isolated Docker containers with synthetic fixtures, verifying probe classification, duplicate prevention, stream reuse, terminal persistence retry, cross-writer API/Worker interactions, graceful stop, and log secret sanitization.
- **Scenario B (Relational Bridge Mode)**: `node scripts/docker-bridge-smoke.mjs` executed and passed in real isolated Docker containers (`streamrecorder-wave05-relational-qa-*`) with PostgreSQL 17, Drizzle migrations 0000–0003, API, Worker, and Next.js frontend on random loopback ports. Verified dynamic Creator/WatchTarget CRUD, Worker bridge polling via `/internal/v1/watch-targets/execution-configs`, fake Streamlink capture execution, Worker outbox event delivery to `/internal/v1/events`, atomic PostgreSQL transaction creating linked Stream & Recording, terminal finalization, API history verification, PostgreSQL + API restart durability with volume retention, Frontend -> API -> PostgreSQL proxy E2E verification, internal boundary protection (404 on proxying `/internal/*`), and Worker Docker restart recovery with zero duplicate captures and media integrity preserved.
- **Combined Smoke Suite**: `pnpm test:smoke` executes both Scenario A and Scenario B sequentially and passes 100%.
- **Isolated PostgreSQL Foundation**: `node scripts/test-db-foundation.mjs` executed against disposable PostgreSQL 17 container on port 55432, passing all 4 integration suites (43 tests) covering clean setup, incremental migrations, repository persistence, worker events/outage/restart recovery, and legacy JSON migration CLI commands (dry-run, backup, import, verify, cutover-check).
- **Isolated Upgrade, Forward-Repair & Rollback Rehearsal**: `node scripts/test-wave05-rehearsal.mjs` executed and passed all 7 phases against disposable PostgreSQL 17 container on dynamic port: clean Drizzle migrations, non-destructive legacy dry-run, quiesced backup with SHA-256 manifest, transactional import of Creators/Targets/Streams/Recordings, post-import verification against source snapshot, idempotent re-run with 0 duplicate records (`idempotence-verified`), pre-activation rollback verified (original JSON files untouched and checksum-verified), post-cutover forward-repair procedure executed and verified (pending outbox drained, worker_events receipt committed, media preserved), and post-cutover rollback rejection invariant verified (CLI rejects rollback command; forward repair is mandatory post-cutover; schema incompatibility makes reverse export lossy).
- **Automated Regression Gates**:
  - API Jest: 9 suites passed, 157 passed tests, 37 DB-gated skipped when DB not active (passed in integration test runner).
  - API TypeScript & Build: `pnpm --dir api exec tsc --noEmit` and `pnpm --dir api build` passed with 0 errors.
  - Worker Unit Suite: `python -m unittest discover -s worker -p "test_worker.py"` passed all 198 tests with OK.
  - Worker Pytest: `pytest worker/test_worker.py -q` passed with 198 passed, 114 subtests passed.
  - Frontend Suite: `pnpm --dir frontend test` passed all 25 tests; `pnpm --dir frontend typecheck` passed; `pnpm --dir frontend build` completed with static optimization.
  - Compose Config: `docker compose config --quiet` and `docker compose -f compose.test-db.yml config --quiet` passed with 0 errors.
  - Git Hygiene: `git diff --check` passed with 0 whitespace errors.
- **Safety and Isolation**: Zero user files touched in `runtime-data/` or `recordings/`. Zero production database volumes affected. All test containers and volumes strictly cleaned up using project-owned filters. No secrets or credentials committed or leaked.

## Review Traceability and Human Acceptance Gate

1. **Review Limit and Iterations**:
   - Three formal Luna reviews were conducted under the project workflow rules.
   - **Iteration 1**: `CHANGES_REQUIRED` — Task documentation needed reconciliation with actual container build logs.
   - **Iteration 2**: `CHANGES_REQUIRED` — Test database harness needed dynamic project isolation and cleanup checks; rollback assertions needed concrete execution; pytest needed execution.
   - **Iteration 3**: `FAILED_REVIEW_LIMIT` — Luna identified that Phase 7c in the rehearsal asserted the lossy-data invariant (absence of `stream_id` in legacy format) but did not explicitly invoke and assert rejection of a CLI rollback command.
2. **Coordinator Technical Reconciliation**:
   - Authority transferred to Coordinator under project instructions Section 40.5.
   - Phase 7c of `scripts/test-wave05-rehearsal.mjs` was updated to explicitly invoke `src/migrator/cli.ts rollback` and assert that the CLI rejects any rollback/reverse-export command, enforcing forward-repair as the sole post-cutover path.
   - The structural lossiness of reverse-exporting relational data to legacy `sessions.json` was asserted (absence of `stream_id` and immutable context).
   - Additional live Docker checks in `scripts/docker-bridge-smoke.mjs` proved Worker Docker restart recovery and Frontend proxy E2E traversal.
3. **Human Acceptance**:
   - Human Acceptance Gate formally verified all technical evidence, confirmed the resolution of all findings, and approved completion. No artificial `PASS` is attributed to Luna Iteration 3.

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

Executed against the candidate candidate:

From api:
- `pnpm test --runInBand` (PASS: 9 suites passed, 157 passed, 37 skipped)
- `pnpm exec tsc --noEmit` (PASS: 0 errors)
- `pnpm build` (PASS: 0 errors)

From repository root:
- `python -m unittest discover -s worker -p test_worker.py` (PASS: 198 passed)
- `python -m pytest worker/test_worker.py -q` (PASS: 198 passed, 114 subtests passed in 5.25s)
- `docker compose config --quiet` (PASS: 0 errors)
- `docker compose -f compose.test-db.yml config --quiet` (PASS: 0 errors)
- `pnpm test:smoke` (PASS: Scenario A 18 gates + Scenario B bridge passed in real Docker containers)
- `git diff --check` (PASS: 0 errors)

From frontend:
- `pnpm test` (PASS: 25 passed)
- `pnpm typecheck` (PASS: 0 errors)
- `pnpm build` (PASS: Next.js static/dynamic production build compiled)

Database, Integration & Rehearsal:
- `node scripts/test-db-foundation.mjs` (PASS: 43 passed across 4 integration suites in isolated PostgreSQL container)
- `node scripts/test-wave05-rehearsal.mjs` (PASS: clean migrations, dry-run, backup, import, verify, idempotence, forward-repair/rollback rehearsal)

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

- [x] All predecessor checkpoints have completed review and human acceptance; code presence alone is not sufficient.
- [x] Every wave-level acceptance criterion maps to concrete passing evidence.
- [x] Both clean-install and existing-install upgrade paths pass.
- [x] New Worker activity, relationships, API/legacy/frontend behavior, and local recording access pass integrated regression.
- [x] DB outage/restarts/replay and rollback after new writes are verified without data loss/false success.
- [x] Required API/Worker/frontend/schema/migration/Compose/Docker gates pass against the reviewed candidate.
- [x] Documentation matches code and contains executable operational/migration/rollback commands.
- [x] No unsupported playable-MP4/live-platform or implemented-future-feature claims appear.
- [x] No out-of-scope feature, secret, real fixture data, or unrelated change remains.
- [x] Final diff/scope review is ready for human approval; no automatic staging, commit, or push.

## Risks / Rollback / Workflow

Stale component evidence, hidden dual writers, incomplete rollback, or fake-media claims can create false wave completion. Coordinator consolidates the matrix and checks the final candidate before Luna's independent QA. Terra only fixes approved wave-caused gaps; substantive defects return to their owner, followed by focused and affected integration validation.

Preserve the established fixing/coordinator-review limits and user-approve -> done human gate. Rollback uses the already rehearsed checkpoint-specific runbook; QA must not invent destructive reset commands or erase valid media.
