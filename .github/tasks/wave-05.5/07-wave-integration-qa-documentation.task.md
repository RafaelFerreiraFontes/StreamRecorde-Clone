---
name: Wave 05.5 — Task 07 — Wave Integration QA and Operational Documentation
wave: "05.5"
order: 07
depends_on:
  - 06-frontend-authentication.task.md
status: planned
---

# Wave 05.5 — Task 07 — Wave Integration QA and Operational Documentation

## Status and Preconditions

Planned only; implementation has not started. Read the [wave specification](README.md), project/MVP instructions and the accepted predecessor deliverables. Wait for predecessor validation, independent review and human acceptance under the existing lifecycle. Creating this task does not authorize its execution.

T01's accepted authentication-ownership-decisions.md is required. If it is missing or a relevant decision is unresolved, return to Coordinator review rather than inventing a policy.

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

- [ ] Repository-wide lint/format checks pass without rewriting source or suppressing new findings.
- [ ] All supported install/upgrade/mode paths pass with reproducible isolated evidence.
- [ ] Two-user isolation covers all modern, legacy, proxy and filesystem paths.
- [ ] Capture recovery and ownership survive service restarts and human session changes.
- [ ] No implicit migration, JSON fallback, public signup, public media or hosted deployment is introduced.
- [ ] Docs match implemented capabilities; final Coordinator validation and independent review precede user acceptance.

## Automated Tests / Verification

Inspect current package scripts first. Run API Jest/typecheck/build, frontend tests/typecheck/build, Worker unittest/pytest, node scripts/test-db-foundation.mjs and root pnpm test:smoke in isolated resources as applicable. Validate docker compose -f compose.yml config --quiet without printing secrets, plus git diff --check. A required skipped/blocked check is not PASS.

Use current scripts/frameworks; resolve exact safe commands during planning. No live platforms or real user data as fixtures. Dependencies/images may require separate preparation. Report unavailable prerequisites honestly; do not replace required database/integration evidence with mocks.

## Risks / Recovery

Failure reopens only the affected checkpoint with an impact review. Preserve database backups, outbox and media; no destructive rollback or automatic commit/push.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator checks branch, working tree and scope before delegation. Sol plans this checkpoint against accepted decisions; Terra implements only the approved plan. Coordinator runs objective validation before Luna independently reviews acceptance, scope and compatibility. Keep planned -> implement -> review/QA -> user-approve -> done, with fixing/coordinator-review paths and existing separate diagnostic/review limits. No automatic acceptance or commit is implied.
