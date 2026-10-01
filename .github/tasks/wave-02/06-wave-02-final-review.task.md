---
name: Wave 02.6 Final Domain Separation Review
description: Review the complete Wave 02 for coherent domain boundaries, compatibility, regressions, and unnecessary complexity.
wave: 02
order: 06
depends_on:
  - 01-domain-model-definition.task.md
  - 02-creator-watch-target-extraction.task.md
  - 03-recording-extraction.task.md
  - 03a-recording-compatibility-hardening.task.md
  - 04-stream-detection-model.task.md
  - 05-json-compatibility-adapters.task.md
  - 05a-domain-api-surface.task.md
status: done
---

# Wave 02.6 — Final Domain Separation Review

## Goal

Perform a complete Wave 02 review and make only necessary in-scope corrections so Creator, WatchTarget, Stream, and Recording are coherent, compatible, tested, and no more complex than current needs require.

## Why This Task Exists

Incremental migrations can leave duplicated concepts, transitional adapters with no purpose, inconsistent names, or subtle lifecycle regressions. This task is a final integration review, not another feature phase. Luna has an especially important verification role.

## Current State

Tasks 01–05a should have defined and introduced domain boundaries and the thin domain REST surface while retaining JSON persistence, legacy endpoints, Worker polling, and Streamlink. Their planned outcomes must not be assumed: the actual code, diffs, reports, tests, and current working tree are the evidence.

## Dependencies / Preconditions

- Tasks 01–05a have completed with Luna `PASS`, or Coordinator has documented any accepted deviation.
- Their implementation reports and validation evidence are available.
- Pre-existing working-tree changes are identified and preserved.

## In Scope

- Review responsibilities, dependencies, relationships, IDs, naming, imports, lifecycle behavior, and data flow for Creator, WatchTarget, Stream, and Recording.
- Review legacy Streamer/Session compatibility and remove only proven accidental duplication or dead transitional code.
- Review API compatibility, Worker behavior, JSON persistence boundaries, and all Wave 01–02 tests.
- Review the domain REST endpoints introduced by Task 05a and confirm controllers remain thin consumers of service/repository/adapter boundaries.
- Verify current Twitch/YouTube/Kick detection remains based on Streamlink.
- Verify no old concept duplicates a new one without an explicit temporary compatibility purpose.
- Make only minimal corrections directly required to satisfy Wave 02 acceptance criteria.
- Produce a concise final architecture and compatibility report for human review.

## Out of Scope

- New product features or a new Wave 03 implementation.
- PostgreSQL, Prisma, TypeORM, Redis, BullMQ, RabbitMQ, OAuth, Google Drive, Dropbox, OneDrive, WebSocket, SSE, frontend, authentication, invitations, retention, cron, cloud upload, public streaming, or public indexing.
- Official Twitch, YouTube, or Kick APIs; Streamlink remains sufficient.
- Microservices, Kubernetes, event sourcing, CQRS, speculative redesign, generic frameworks, or portfolio-driven complexity without current value.
- Broad code-style refactors, package-manager changes, or unrelated dependency work.

## Sol Responsibilities

- Audit the actual repository against every Wave 02 task and project instruction.
- Build a concise relationship/lifecycle map from current implementation.
- Identify only concrete gaps: duplicated responsibility, missing relationship, incompatibility, regression, dead code, or unjustified abstraction.
- Separate required Wave 02 corrections from future recommendations.
- Define the smallest correction plan and comprehensive validation matrix.
- Return `BLOCKED` for any significant roadmap expansion or breaking-contract decision.

## Terra Responsibilities

- Implement only Sol's approved final-review corrections.
- Prefer deleting proven accidental duplication over adding another compatibility layer, while preserving necessary legacy contracts.
- Avoid feature work, architectural expansion, and opportunistic cleanup.
- Run the full relevant API and Worker test suites plus type checks and syntax/static validation used by the project.
- Record every command and result, changed files, remaining compatibility adapters, and deferred observations.

## Luna Responsibilities

- Review the complete Wave 02 result, not only Terra's last diff.
- Confirm these distinctions in actual responsibilities and data flow:
  - `Creator != WatchTarget`
  - `Stream != Recording`
  - `Recording != Creator`
- Confirm Creator identity, WatchTarget monitoring configuration, Stream broadcast occurrence, and Recording capture lifecycle are unambiguous.
- Review API contracts, Worker lifecycle, JSON formats/adapters, tests, naming, imports, dead code, and unused abstractions.
- Verify temporary Streamer/Session compatibility is explicit, justified, and not a second source of truth.
- Reject regressions, overengineering, incomplete migrations, hidden breaking changes, or out-of-scope infrastructure.
- Exercise the existing maximum of three review iterations before `FAILED_REVIEW_LIMIT`.

## Acceptance Criteria

- [ ] Creator contains identity responsibilities and does not own WatchTarget recording configuration.
- [ ] One Creator can have multiple independent WatchTargets.
- [ ] WatchTarget represents the monitored platform/channel/configuration.
- [ ] Stream represents an actual detected broadcast occurrence.
- [ ] Stream relates to WatchTarget through `watch_target_id` and contains no redundant domain `channel_id`.
- [ ] Recording represents capture execution and its lifecycle.
- [ ] Relationships and IDs among all four concepts are clear and consistently used.
- [ ] Legacy Streamer/Session compatibility is explicit and has no unjustified duplicate source of truth.
- [ ] Required `/streamer` and `/session` endpoints remain compatible unless a human approved otherwise.
- [ ] Creator, WatchTarget, Stream, and Recording read endpoints and the scoped WatchTarget write endpoints from Task 05a are available and tested.
- [ ] Worker polling, Streamlink detection, shutdown, error handling, and Wave 01 lifecycle guarantees remain correct.
- [ ] JSON remains active persistence behind appropriately small compatibility boundaries.
- [ ] Existing and new tests pass without internet or real live channels.
- [ ] Naming, imports, dead code, and abstractions have been reviewed.
- [ ] No PostgreSQL, queue, cloud, frontend, authentication, or other excluded infrastructure was introduced.
- [ ] Final diff is limited to justified Wave 02 work and passes `git diff --check`.
- [ ] Luna returns final `PASS` before Coordinator reports `READY_FOR_COMMIT` to the human.

## Stop Conditions

- Stop with `BLOCKED` if completion needs a significant roadmap change, breaking API decision, or data migration requiring human approval.
- Stop rather than adding a fourth Luna review after unresolved findings on review 3.
- Stop and defer findings that belong to a future wave instead of expanding this review.
- Do not commit or push; the human remains the gate.

## Expected Result

A Luna-approved Wave 02 with clear domain separation, preserved behavior and JSON persistence, no unjustified duplicate concepts, comprehensive validation evidence, and a Coordinator status of `READY_FOR_COMMIT` for human review.

## Next Task

No automatic next task. Return control to the human to review Wave 02 and decide the next wave.
