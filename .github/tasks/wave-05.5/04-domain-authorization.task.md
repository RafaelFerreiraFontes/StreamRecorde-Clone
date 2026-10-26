---
name: Wave 05.5 — Task 04 — Domain Ownership and Legacy Route Authorization
wave: "05.5"
order: 04
depends_on:
  - 03-authentication-session.task.md
status: done
---

# Wave 05.5 — Task 04 — Domain Ownership and Legacy Route Authorization

## Status and Preconditions

done — The implementation of Task 04 is complete, validated across all unit and isolated PostgreSQL suites, independently approved by Luna (Review 1: PASS), and formally accepted after independent final verification and human approval. SQL-level domain ownership, legacy route authorization, forged-owner rejection, and temporary authenticated filesystem fail-closed behavior are integrated into the branch while preserving the production authenticated-mode startup guard until Task 07.

## Context / Objective

Enforce ownership throughout public domain operations, including compatibility routes and history.

## Scope / Required Changes

- Thread the verified principal through controllers, services and repository queries. Do not store request-specific user state in shared singleton repositories.
- Scope list/detail/filter/create/update/archive operations for Creator, WatchTarget, Stream and Recording. Obtain owner from the principal, not request body/query/header claims.
- Validate same-owner Creator/WatchTarget/Stream/Recording relationships and scope automatic Creator grouping, name lookup and duplicate-name handling per owner.
- Protect /streamer, /session and channel-filter compatibility paths under the same policy; preserve wire IDs and lifecycle vocabulary.
- Preserve archived historical ownership and NULL legacy Stream links. Do not silently transfer history when a target is edited or archived.
- Use query-level filtering and database invariants where specified, not frontend filtering or loading all tenants before authorization. Keep privileged Worker operations explicit and separate.
- Provide the ownership lookup required by T05 while keeping unsafe filesystem routes disabled in authenticated mode until that task is accepted.

## Relevant Areas

api/src/streams/streams.controller.ts, streams.service.ts, streams.repository.ts, relational-streams.repository.ts, domain.model.ts, DTOs and modern/legacy API tests.

## Explicit Exclusions and Activation Boundary

All wave-wide exclusions apply. No normal-installation cutover, real-data migration, media changes, deployment, staging, commit or push is authorized by this task file. Implement only the current checkpoint; do not advance later tasks automatically. Preserve JSON compatibility according to T01 and keep incomplete authenticated operation disabled.

## Acceptance Criteria

- [x] Two synthetic users cannot list/read/mutate each other's resources by guessed UUID, legacy ID, name or filter.
- [x] Forged ownership input and cross-owner relationships are rejected without mutation.
- [x] Same-name Creators remain independent across users; sibling target behavior is preserved.
- [x] Legacy routes and archived/NULL-stream history enforce the same isolation.
- [x] Concurrent requests for different users cannot leak principal state; JSON/local compatibility follows T01.

## Automated Tests / Verification

Add API route/service and real-DB integration tests for an explicit two-user access matrix, including negative mutations and relationship constraints. Run affected API regressions/typecheck/build and git diff --check.

Use current scripts/frameworks; resolve exact safe commands during planning. No live platforms or real user data as fixtures. Dependencies/images may require separate preparation. Report unavailable prerequisites honestly; do not replace required database/integration evidence with mocks.

## Risks / Recovery

Audit every route rather than only modern controllers. No temporary unscoped repository fallback or authorization bypass may be enabled for normal users.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator checks branch, working tree and scope before delegation. Sol plans this checkpoint against accepted decisions; Terra implements only the approved plan. Coordinator runs objective validation before Luna independently reviews acceptance, scope and compatibility. Keep planned -> implement -> review/QA -> user-approve -> done, with fixing/coordinator-review paths and existing separate diagnostic/review limits. No automatic acceptance or commit is implied.
