---
name: Wave 05.5 — Task 05 — Worker Ownership and Filesystem Access Boundaries
wave: "05.5"
order: 05
depends_on:
  - 04-domain-authorization.task.md
status: done
---

# Wave 05.5 — Task 05 — Worker Ownership and Filesystem Access Boundaries

## Status and Preconditions

Task 05 implementation is complete and formally approved.
- Worker ownership derivation and event authorization implemented.
- Filesystem metadata isolation and shared-directory sibling non-disclosure enforced (`/recordings/filesystem` 404 in authenticated mode; `/recordings/:id/location` returns owner-scoped metadata only).
- Account-disablement concurrency defect corrected via PostgreSQL `FOR SHARE` row locking on owner lookup within `handleWorkerEvent`, verified with two-connection concurrency tests.
- All validation gates passed (API typecheck and build, Jest suite, isolated PostgreSQL 17 test harness with restart durability, Python Worker tests, synthetic bridge Docker smoke, and git diff check).
- Luna Review 2 returned PASS.
- Human acceptance explicitly granted.

T01's accepted authentication-ownership-decisions.md is required. If it is missing or a relevant decision is unresolved, return to Coordinator review rather than inventing a policy.

## Context / Objective

Integrate ownership with the service bridge and close metadata disclosure paths while preserving capture recovery.

## Scope / Required Changes

- Keep INTERNAL_API_TOKEN as service authentication, distinct from human credentials. Resolve ownership from persisted target/recording relationships; do not trust a client-supplied owner.
- Apply the accepted Worker scope and account-status policy to execution configs and new launches. Logout must not cancel captures or block terminal persistence.
- Preserve event IDs, fingerprints, transactional acknowledgment, outbox/checkpoint replay and existing pending-event compatibility. Version payload changes only with an explicit compatibility path.
- Test record start/terminal/offline relationships and account disablement, archived targets and DB outages, preserving finalization of already accepted work.
- Authorize /recordings/:id/location and /recordings/filesystem. Prevent directory and sibling filename leakage, not just foreign Recording ID access.
- Implement the T01 directory boundary/filtering/restriction choice without moving, deleting or exposing existing media. Reject user-selected paths outside their allowed boundary.
- Retain traversal/symlink protection, read-only API mount, private media and existing missing-file/unavailable-directory semantics. Keep internal routes inaccessible through the frontend proxy.

## Relevant Areas

api/src/streams/internal-streams.controller.ts, internal-events.service.ts, relational-streams.repository.ts, recordings-filesystem.controller.ts, recordings-filesystem.service.ts, worker/worker.py, worker/outbox.py and bridge/filesystem tests.

## Explicit Exclusions and Activation Boundary

All wave-wide exclusions apply. No normal-installation cutover, real-data migration, media changes, deployment, staging, commit or push is authorized by this task file. Implement only the current checkpoint; do not advance later tasks automatically. Preserve JSON compatibility according to T01 and keep incomplete authenticated operation disabled.

## Acceptance Criteria

- [x] Service events persist correct ownership and reject inconsistent relationships.
- [x] Old pending events/checkpoints replay without owner reassignment, duplication or lost acknowledgments.
- [x] Human session expiry/logout does not break in-flight capture recovery.
- [x] Two users cannot enumerate each other's filenames through listing or location responses.
- [x] Traversal/symlink and shared-directory fixtures remain safe; no real media is moved or deleted.

## Automated Tests / Verification

Run focused API bridge/filesystem and Worker tests, real isolated DB replay/outage tests, affected suites and synthetic bridge smoke. Include two-user directory fixtures and inspect responses for sibling disclosure. Run git diff --check.

Use current scripts/frameworks; resolve exact safe commands during planning. No live platforms or real user data as fixtures. Dependencies/images may require separate preparation. Report unavailable prerequisites honestly; do not replace required database/integration evidence with mocks.

## Risks / Recovery

Preserve outbox/checkpoints and media during failures. Do not clear pending work to pass a gate or expand into general file-management/retention features.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator checks branch, working tree and scope before delegation. Sol plans this checkpoint against accepted decisions; Terra implements only the approved plan. Coordinator runs objective validation before Luna independently reviews acceptance, scope and compatibility. Keep planned -> implement -> review/QA -> user-approve -> done, with fixing/coordinator-review paths and existing separate diagnostic/review limits. No automatic acceptance or commit is implied.
