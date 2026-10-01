---
name: Wave 02.2 Creator and WatchTarget Extraction
description: Incrementally separate creator identity from platform-specific monitoring configuration while preserving legacy API behavior.
wave: 02
order: 02
depends_on:
  - 01-domain-model-definition.task.md
status: done
---

# Wave 02.2 — Creator and WatchTarget Extraction

## Goal

Extract `Creator` identity and 1:N `WatchTarget` monitoring configuration from the responsibilities currently combined under `Streamer` and `watchlist.json`, while preserving working API and Worker behavior.

## Why This Task Exists

The current watchlist entry contains creator-facing identity together with platform, channel, URL, quality, and runtime status. This prevents one logical creator from having multiple independently configured targets. Separating the concepts is the first structural domain migration in Wave 02.

## Current State

- API endpoints use the legacy `/streamer` contract.
- A watchlist entry currently acts as both a displayed streamer and the Worker's monitoring input.
- `StreamsRepository` generates the entry ID and writes `watchlist.json` directly.
- Current status is merged from `channels_status.json`.
- The Worker keys active recordings and status by the current watchlist/channel ID.
- Twitch, YouTube, and Kick are supported through Streamlink.

Sol must re-check the actual repository and Task 01 result when this task begins. Task 01 is guidance, not an immutable implementation contract.

## Dependencies / Preconditions

- Task 01 has a Luna-approved domain model or Coordinator has documented an equivalent verified boundary.
- Current endpoint, JSON, and Worker contracts are understood.
- Existing lifecycle and API tests from Wave 01 are passing or any unrelated failure is documented.

## In Scope

- Introduce the smallest useful Creator representation for logical identity.
- Introduce independent WatchTargets related to a Creator at 1:N cardinality.
- Place platform, channel information, URL, quality, and monitoring configuration on WatchTarget.
- Support multiple WatchTargets for one Creator, including different platforms and qualities.
- Preserve Twitch, YouTube, and Kick without a creator whitelist.
- Adapt the current JSON representation minimally according to Task 01's verified strategy.
- Keep the Worker supplied with the monitoring fields it currently requires.
- Preserve legacy `/streamer` endpoints through compatible mapping/adaptation when feasible:
  - `GET /streamer`
  - `GET /streamer/:id`
  - `POST /streamer`
  - `DELETE /streamer/:id`
- Add focused API and Worker tests for the new relationships and compatibility behavior.

## Out of Scope

- Recording extraction, a full Stream model, or generalized persistence adapters beyond what this extraction immediately needs.
- Removing or renaming legacy endpoints solely for cleaner terminology.
- PostgreSQL, Prisma, TypeORM, Redis, BullMQ, RabbitMQ, OAuth, cloud storage, WebSocket, SSE, frontend, authentication, invitations, retention, cron, public streaming, or public indexing.
- Official Twitch, YouTube, or Kick APIs; Streamlink remains the detector.
- Microservices, Kubernetes, event sourcing, CQRS, generic repository frameworks, or speculative domain fields.
- Broad module reorganization or unrelated cleanup.

## Sol Responsibilities

- Validate Task 01 assumptions against current code and prior task results.
- Trace how IDs, watchlist fields, current status, controller DTOs, repository methods, and Worker lookups behave today.
- Decide the smallest compatible JSON shape and migration/read strategy.
- Define how legacy `/streamer` requests and responses map to Creator/WatchTarget without ambiguous destructive behavior.
- Identify focused tests proving 1:N targets, platform/quality independence, and legacy compatibility.
- Provide exact affected files, risks, data-compatibility behavior, and a minimal plan.
- Return `BLOCKED` to Coordinator if a required API semantic decision would significantly change the roadmap.

## Terra Responsibilities

- Implement only the approved incremental extraction with the smallest safe diff.
- Preserve existing behavior and old JSON data where the approved compatibility strategy requires it.
- Avoid duplicate sources of truth between legacy Streamer and new concepts.
- Keep Worker monitoring functional for all three platforms.
- Do not introduce a whitelist or force one platform per Creator.
- Add deterministic tests that do not need internet or a real live channel; mock filesystem, Streamlink, and subprocess boundaries as appropriate.
- Run existing Wave 01 API and Worker lifecycle tests plus focused new tests.

## Luna Responsibilities

- Verify Creator contains identity rather than recording configuration.
- Verify WatchTarget owns platform/channel/URL/quality monitoring concerns.
- Prove one Creator can have multiple independent WatchTargets across platforms and qualities.
- Check legacy endpoint behavior, JSON compatibility, Worker behavior, and old lifecycle tests.
- Reject exact duplicate Streamer/Creator sources of truth unless a temporary adapter is explicit and justified.
- Reject breaking API changes, scope creep, speculative abstractions, or hidden data loss.

## Acceptance Criteria

- [ ] Creator and WatchTarget have distinct, verified responsibilities.
- [ ] One Creator can own multiple WatchTargets.
- [ ] WatchTargets may use different platforms and qualities independently.
- [ ] Twitch, YouTube, and Kick remain supported through Streamlink.
- [ ] No creator whitelist is introduced.
- [ ] Required legacy `/streamer` endpoints remain compatible or any unavoidable break is blocked for human decision.
- [ ] Existing JSON data has an explicit compatible read/migration path.
- [ ] Worker monitoring behavior and Wave 01 lifecycle guarantees remain intact.
- [ ] Tests are deterministic and require no live service or internet.
- [ ] JSON remains active persistence; no future infrastructure is introduced.
- [ ] Luna returns `PASS` before Coordinator reports `READY_FOR_COMMIT` to the human.

## Stop Conditions

- Stop with `BLOCKED` if legacy `/streamer` semantics cannot map safely to multiple WatchTargets without a human product decision.
- Stop if data conversion could silently lose or duplicate current watchlist entries.
- Stop and refine if changes require Recording/Stream migration, replacement persistence, or a broad architecture rewrite.
- Do not edit later Wave 02 task files automatically.

## Expected Result

A minimal Creator/WatchTarget boundary used by current code, with 1:N monitoring configurations, preserved legacy behavior, active JSON persistence, and no speculative architecture.

## Next Task

`03-recording-extraction.task.md`
