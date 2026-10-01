---
name: Wave 02.1 Domain Model Definition
description: Define the minimum verified boundaries between Creator, WatchTarget, Stream, and Recording before structural migration.
wave: 02
order: 01
depends_on: []
status: done
---

# Wave 02.1 — Domain Model Definition

## Goal

Define a small, evidence-based domain model that separates `Creator`, `WatchTarget`, `Stream`, and `Recording` clearly enough to guide Tasks 02–05 without implementing the migration itself.

## Why This Task Exists

The current code uses `Streamer` for identity, monitoring configuration, and current state, while `Session` represents most of the recording lifecycle. Moving directly to the desired names would risk a cosmetic rename, duplicated concepts, or a speculative redesign. This task establishes verified boundaries first.

## Current State

- The NestJS API concentrates stream behavior under `api/src/streams/`.
- `StreamerDto` combines identity fields with platform, URL, quality, and current state.
- `StreamsRepository` maps API operations directly to the Worker JSON files.
- `SessionDto` and `sessions.json` describe capture lifecycle data.
- The Python Worker reads monitoring entries, detects live broadcasts through Streamlink, starts capture, and updates session/status JSON.
- JSON is the active persistence mechanism and remains active throughout Wave 02.

The current repository at execution time is the source of truth. Sol must verify these observations and the results of all completed Wave 01 work.

## Dependencies / Preconditions

- Wave 01 must be complete or its remaining blockers must be understood.
- Read project and MVP instructions, all Wave 01 tasks, current agent rules, `api/src/`, `worker/worker.py`, and relevant tests.
- Record any pre-existing working-tree changes before proposing edits.

## In Scope

- Inventory every responsibility currently carried by `Streamer`, `StreamDto`, `Session`, the JSON repository, and the Worker.
- Decide which current responsibilities minimally belong to Creator, WatchTarget, Stream, and Recording.
- Define the minimum relationships and identifier flow among those concepts.
- Define when a Stream is considered to exist and how it relates to a Recording.
- Identify external API and JSON contracts that must remain stable during migration.
- Define a compatibility strategy for `watchlist.json`, `channels_status.json`, and `sessions.json`.
- Produce a concise domain decision document, diagram, or minimal types/interfaces only when they have an immediate consumer in Tasks 02–05.
- Refine acceptance criteria and migration seams for the following tasks.

## Out of Scope

- Implementing the full domain migration or renaming every legacy symbol.
- PostgreSQL, Prisma, TypeORM, Redis, BullMQ, RabbitMQ, OAuth, cloud storage, WebSocket, SSE, frontend, authentication, invitations, retention, cron, public streaming, or public indexing.
- Official Twitch, YouTube, or Kick APIs; Streamlink remains the detector.
- Microservices, Kubernetes, event sourcing, CQRS, speculative aggregate roots, generic repositories, or abstractions without a current consumer.
- Opportunistic refactors, package-manager changes, or infrastructure redesign.

## Sol Responsibilities

- Inspect the actual API, Worker, JSON shapes, tests, and Wave 01 results before accepting any proposed model.
- Create a responsibility matrix for legacy `Streamer`/`Session` concepts versus Creator/WatchTarget/Stream/Recording.
- Define relationship cardinality and ID ownership without inventing unused fields.
- Identify stable external endpoints and temporary compatibility names.
- Distinguish current facts, safe conclusions, and questions that must remain deferred.
- Recommend the smallest useful artifact and implementation plan.
- Escalate a materially different roadmap decision to Coordinator instead of guessing.

## Terra Responsibilities

- Implement only Sol's approved, minimal modeling artifact.
- Prefer concise documentation when code types would have no immediate consumer.
- If minimal interfaces or types are justified, keep them close to their first use and avoid a framework-scale domain layer.
- Do not migrate controllers, repositories, JSON formats, or Worker lifecycle in this task.
- Add only validation proportional to any executable code introduced.

## Luna Responsibilities

- Verify that each boundary follows current behavior rather than an imagined final architecture.
- Reject duplicated concepts, speculative fields, unused abstractions, or accidental implementation of Tasks 02–05.
- Confirm `Creator != WatchTarget`, `Stream != Recording`, and `Recording != Creator` in the documented model.
- Confirm API compatibility and JSON continuity are explicit.
- Confirm the result is actionable enough that later tasks do not need to reinvent the relationships.

## Acceptance Criteria

- [ ] Current `Streamer` responsibilities are mapped to Creator and WatchTarget.
- [ ] Current `Session` responsibilities are mapped to Recording, with any additional responsibilities identified.
- [ ] The minimum reason and lifecycle boundary for Stream are documented.
- [ ] Creator-to-WatchTarget cardinality is explicitly 1:N.
- [ ] ID ownership and relationships are defined at the minimum level needed for Tasks 02–05.
- [ ] Existing API endpoints and JSON formats requiring compatibility are listed.
- [ ] JSON remains the active persistence implementation.
- [ ] No unsupported future fields or patterns are introduced.
- [ ] Relevant documentation or minimal types pass diagnostics and proportional validation.
- [ ] Luna returns `PASS` before Coordinator reports `READY_FOR_COMMIT` to the human.

## Stop Conditions

- Stop with `BLOCKED` for a significant roadmap or domain decision that cannot be derived safely from current code.
- Stop for human direction if the proposed model requires breaking existing API contracts.
- Stop and refine if implementation would expand into Tasks 02–05 or require out-of-scope infrastructure.
- Do not modify future task files automatically when the implementation differs from an initial assumption.

## Expected Result

A concise, validated domain map and incremental migration plan that preserves current behavior and gives Tasks 02–05 stable definitions without enterprise overengineering.

## Next Task

`02-creator-watch-target-extraction.task.md`
