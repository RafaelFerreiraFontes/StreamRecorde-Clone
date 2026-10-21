---
name: Wave 05.5 — Task 01 — Identity, Authentication and Ownership Decisions
wave: "05.5"
order: 01
depends_on:
  - ../wave-05/07-wave-integration-qa-documentation.task.md
status: planned
---

# Wave 05.5 — Task 01 — Identity, Authentication and Ownership Decisions

## Status and Preconditions

Planned only; implementation has not started. Read the [wave specification](README.md), project/MVP instructions and the accepted predecessor deliverables. Wait for predecessor validation, independent review and human acceptance under the existing lifecycle. Creating this task does not authorize its execution.

## Context / Objective

Freeze the decisions required by T02-T07 in authentication-ownership-decisions.md. This task delivers documentation only.

## Scope / Required Changes

- Inspect current schema, modern/legacy controllers, repositories, proxy, dashboard provider, filesystem browser, migrator and internal Worker bridge. Record actual baseline and an impact map.
- Define a supported-mode matrix separating persistence (legacy JSON / relational) from identity (local / authenticated). Preserve local-first use without mandatory interactive login. Specify configuration validation, activation and rollback; authenticated failure must never fall back to the local user. JSON must not claim multi-user isolation.
- Define stable User identity, local-account bootstrap, optional versus required email/password, email normalization/uniqueness, account status, credential enrollment and controlled provisioning of additional test accounts. Decide whether registration exists; public signup is not implicitly required.
- Choose password hashing and session/token design with dependency/container implications. Specify transport, expiry, revocation, logout, restart persistence, brute-force controls, CSRF/origin policy, direct API access and secret-safe errors. No shared default password.
- Define ownership for Creator, WatchTarget, Stream and Recording, explicit versus inherited owner fields, database constraints, query boundaries, archived history and same-name Creator resolution. Legacy Recording.stream_id may be NULL; authorization must still work through its target.
- Define all route classes: public health, local principal, authenticated user and internal service. Inventory modern, legacy, filesystem and proxy routes; define consistent unauthorized/not-found behavior.
- Define the Worker service trust boundary, server-derived ownership, pending-event compatibility, account disablement and in-flight capture policy. Human logout must not invalidate Worker persistence.
- Choose filesystem isolation or explicit restrictions, including sibling filenames returned by location responses. Define treatment of existing shared directories without moving real media.
- Define fresh install, populated relational upgrade and JSON import paths, ownership assignment, manifest/version compatibility, replay, failure recovery and rollback checkpoints. Decide owner transfer/deletion policy without inventing an admin system.
- Define safe intermediate checkpoints: no partially protected authenticated mode may be enabled before domain, Worker/filesystem and frontend gates pass.

## Relevant Areas

Inspect all areas listed in the wave README.

## Explicit Exclusions and Activation Boundary

All wave-wide exclusions apply. No normal-installation cutover, real-data migration, media changes, deployment, staging, commit or push is authorized by this task file. Implement only the current checkpoint; do not advance later tasks automatically. Preserve JSON compatibility according to T01 and keep incomplete authenticated operation disabled.

## Acceptance Criteria

- [ ] Decision record includes mode/route/ownership matrices and an unambiguous choice for each downstream dependency.
- [ ] Migration and rollback plans cover both existing storage modes without automatic cutover.
- [ ] Each security and compatibility requirement maps to an implementation task and a validation case.
- [ ] No application code, schema, dependencies, runtime settings or user data changed.

## Automated Tests / Verification

Review documentation links, evidence references, requirement coverage and git diff --check. No application tests or running database are needed.

Use current scripts/frameworks; resolve exact safe commands during planning. No live platforms or real user data as fixtures. Dependencies/images may require separate preparation. Report unavailable prerequisites honestly; do not replace required database/integration evidence with mocks.

## Risks / Recovery

Accidental scope expansion or unresolved design choices must return to Coordinator review; do not let downstream agents invent conflicting policies.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator checks branch, working tree and scope before delegation. Sol plans this checkpoint against accepted decisions; Terra implements only the approved plan. Coordinator runs objective validation before Luna independently reviews acceptance, scope and compatibility. Keep planned -> implement -> review/QA -> user-approve -> done, with fixing/coordinator-review paths and existing separate diagnostic/review limits. No automatic acceptance or commit is implied.
