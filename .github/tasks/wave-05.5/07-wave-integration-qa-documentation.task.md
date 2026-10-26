---
name: Wave 05.5 — Task 07 — Wave Integration QA and Operational Documentation
wave: "05.5"
order: 07
depends_on:
  - 06-frontend-authentication.task.md
status: done
---

# Wave 05.5 — Task 07 — Wave Integration QA and Operational Documentation

## Status and Preconditions

Phase A (full isolated integration, security and recovery QA across all 12 validation areas, including relational/local rollback rehearsal) and Phase C (operational documentation and repository-wide regression gates) have been executed against the accepted [wave specification](README.md), [T01 decision record](authentication-ownership-decisions.md), project/MVP instructions and accepted T01–T06 deliverables:

- Normal startup in `api/src/database/identity-mode.ts` intentionally retains the fail-closed guard (`authenticated mode not yet available`) pending separate Phase B human approval (`AUTHENTICATED_ACTIVATION_APPROVAL_REQUIRED`).
- Executed verification under Node 25.9.0, pnpm 11.20.0, Python 3.12.4 and `.venv` Python 3.13.9 / Ruff 0.15.6:
  - `pnpm lint` (`node scripts/lint-repository.mjs lint`): PASS (exit 0, 0 diagnostics across `scripts`, `api`, `frontend`, `worker`; SHA-256 tracked-file inventory identical before and after).
  - `pnpm format:check` (`node scripts/lint-repository.mjs format:check`): PASS (exit 0, Prettier and Ruff format checks clean; SHA-256 tracked-file inventory identical before and after).
  - `git diff --check`: PASS (exit 0).
  - `pnpm --dir api exec tsc --noEmit`: PASS (exit 0).
  - `pnpm --dir api test`: PASS (exit 0; 12 suites passed, 3 DB-gated skipped; 179 tests passed, 73 DB-gated skipped).
  - `pnpm --dir api run build`: PASS (exit 0).
  - `node scripts/test-db-foundation.mjs` (isolated Docker project `streamrecorder-test-db` on `127.0.0.1:55432`): PASS (exit 0; 6 suites / 81 tests passed, including `database.integration.spec.ts`, `legacy-migration.integration.spec.ts`, `auth.integration.spec.ts`, `relational-persistence.integration.spec.ts`, `domain-authorization.integration.spec.ts` with 15 tests including relational/local rollback rehearsal, `internal-events.integration.spec.ts`, and `database-persistence-check.mjs` across container stop/rm/up restart).
  - `node scripts/test-wave05-rehearsal.mjs` (isolated Docker project `streamrecorder-rehearsal-41a446b09db9`): PASS (exit 0; all 7 phases: clean migrations, dry-run, quiesced backup & SHA-256 manifest, transactional import, post-import verify, idempotent replay, pre-activation rollback and post-cutover forward-repair/rollback invariants).
  - Disposable PostgreSQL `pg_dump` / restore verification: PASS (complete User/Session/domain row snapshot restored identically into separate disposable database).
  - `pnpm --dir frontend run typecheck`: PASS (exit 0).
  - `pnpm --dir frontend run test`: PASS (exit 0; 38 tests passed, 0 failed).
  - `pnpm --dir frontend run build`: PASS (exit 0).
  - `pnpm --dir frontend run test:integration`: PASS (exit 0 against isolated temporary localhost API/frontend stack).
  - `C:\Python312\python.exe -m unittest discover -s worker -p "test_*.py"`: PASS (exit 0; 198 tests passed).
  - `C:\Python312\python.exe -m pytest worker/test_worker.py`: PASS (exit 0; 198 tests passed).
  - `docker compose -f compose.yml config --quiet`: PASS (exit 0).
  - `pnpm test:smoke` (`node scripts/docker-integration-smoke.mjs && node scripts/docker-bridge-smoke.mjs` in isolated projects `streamrecorder-smoke-*` and `streamrecorder-wave05-relational-qa-c3746edf607e`): PASS (exit 0; 18 JSON smoke gates + relational bridge E2E proxy/internal boundary, Worker restart with pending outbox replay, zero duplicates, media integrity, and DB/API restart durability).
  - Isolation and cleanup: `docker ps -a` and `docker volume ls` confirmed empty before and after; pre-existing `wave-05` image tags preserved and restored; temporary directories removed; normal `runtime-data` and `recordings` untouched.

T01's accepted authentication-ownership-decisions.md is required. If it is missing or a relevant decision is unresolved, return to Coordinator review rather than inventing a policy.

## Post-QA Worker Bridge Hotfix Evidence (2026-10-26)

The following closure evidence supplements the historical Phase A/C checkpoint
above; task status is `done` following formal QA and human acceptance.

- Commit: `3d7f115` (`fix(worker): align bridge recovery reason with API event contract`).
- Root cause: the Worker emitted `worker_restart_before_launch`, but the API event
  DTO did not include that recovery reason in its accepted values.
- Minimal correction: add the reason to the DTO's explicit allowlist, preserving
  strict validation and rejection of unknown, empty or whitespace-suffixed reasons.
- Regression coverage: isolated PostgreSQL verifies durable terminal acknowledgment,
  unchanged Recording data and identical acknowledgment on replay after an API
  restart, with one Recording, one Stream and one matching Worker event row.
- Recorded post-hotfix validation at HEAD `3d7f115`: API 291/291 passed (0 skipped,
  isolated PostgreSQL and restart probe); Worker 201/201 passed (0 skipped);
  Frontend 38/38 passed (0 skipped); disposable bridge smoke 3/3 gates passed;
  API/frontend typechecks and production builds, repository lint and format checks passed.

These results were supplied as executed post-hotfix evidence for documentary
closure; application suites were not rerun by this documentation-only change.
The wave is officially complete and accepted for merge into `master`; merge remains
unperformed. Human Docker User Stability Testing remains pending, independently
of automated smoke/restart checks. Synthetic fixtures do not establish playable
MP4 media or real-platform stability.

## Context / Objective

Validate the complete wave in isolated environments and document explicit rollout and recovery without upgrading the user's installation.

## Scope / Required Changes

- Exercise clean relational install, existing relational upgrade, legacy JSON import/cutover rehearsal, local mode and authenticated two-user mode. Verify the documented unsupported combinations fail safely.
- Run the complete ownership route matrix including legacy filters, name lookup, filesystem listings/location siblings, forged owner fields and internal service boundary.
- Exercise session expiry/revocation/restart, logout during capture, delayed frontend responses, Worker outage/restart/outbox replay and account-status changes.
- Verify migration idempotence, manifests, preserved UUIDs/timestamps/unknown links/history/media metadata, transaction rollback and mode activation ordering.
- Re-run the repository-wide read-only lint and format checks established by T05.5, covering frontend, API, Node scripts and Worker, including subsequent T06 changes. Verify no source mutation or silent scope omissions.
- Run existing JSON and bridge regressions using synthetic fixtures and fake Streamlink. Never use normal runtime-data, recordings, containers or database volumes.
- Update PROJECT-STATUS.md, root/component READMEs and applicable instructions to describe actual supported modes, safe account setup, configuration, migration, secret handling and rollback checkpoints.
- Remove obsolete partial-rollout gates only when all required protections are verified. Keep operational activation explicit and opt-in; do not deploy or migrate normal user data.
- Record commands/results as passed, failed, blocked or not run, with isolated resource identity and limitations. Fake media does not prove real platform recovery or playable MP4.

## Relevant Areas

Existing scripts/, API/database/Worker/frontend tests, compose.yml and root/component documentation.

## Explicit Exclusions and Activation Boundary

All wave-wide exclusions apply. No normal-installation cutover, real-data migration, media changes, deployment, staging, commit or push is authorized by this task file. Implement only the current checkpoint; do not advance later tasks automatically. Preserve JSON compatibility according to T01 and keep incomplete authenticated operation disabled.

## Acceptance Criteria

- [x] Repository-wide lint/format checks pass without rewriting source or suppressing new findings.
- [x] All supported install/upgrade/mode paths pass with reproducible isolated evidence.
- [x] Two-user isolation covers all modern, legacy, proxy and filesystem paths.
- [x] Capture recovery and ownership survive service restarts and human session changes.
- [x] No implicit migration, JSON fallback, public signup, public media or hosted deployment is introduced.
- [x] Docs match implemented capabilities; final Coordinator validation and independent review precede user acceptance.

## Automated Tests / Verification

Inspect current package scripts first. Run API Jest/typecheck/build, frontend tests/typecheck/build, Worker unittest/pytest, node scripts/test-db-foundation.mjs and root pnpm test:smoke in isolated resources as applicable. Validate docker compose -f compose.yml config --quiet without printing secrets, plus git diff --check. A required skipped/blocked check is not PASS.

Use current scripts/frameworks; resolve exact safe commands during planning. No live platforms or real user data as fixtures. Dependencies/images may require separate preparation. Report unavailable prerequisites honestly; do not replace required database/integration evidence with mocks.

## Risks / Recovery

Failure reopens only the affected checkpoint with an impact review. Preserve database backups, outbox and media; no destructive rollback or automatic commit/push.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator checks branch, working tree and scope before delegation. Sol plans this checkpoint against accepted decisions; Terra implements only the approved plan. Coordinator runs objective validation before Luna independently reviews acceptance, scope and compatibility. Keep planned -> implement -> review/QA -> user-approve -> done, with fixing/coordinator-review paths and existing separate diagnostic/review limits. No automatic acceptance or commit is implied.
