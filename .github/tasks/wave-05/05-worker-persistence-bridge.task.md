---
name: Wave 05 — Task 05 — Worker Persistence Bridge
wave: 05
order: 05
depends_on:
  - 04-stream-recording-persistence.task.md
status: planned
---

# Wave 05 — Task 05 — Worker Persistence Bridge

## Status and Preconditions

planned — execution has not started. Read the [wave specification](README.md) and complete the predecessor's independent validation/review and human acceptance gate before starting. The shared scope, security, testing, and lifecycle constraints apply to this task.

## Context / Objective

Worker is the operational writer of streams.json, sessions.json, and channels_status.json. Implement the strategy approved in 05-T01 so ongoing lifecycle activity reaches relational authority correctly, not merely an initial imported snapshot.

This is task order 05 of Wave 05, not the future Wave 05.5 for User/authentication. No User/auth work is authorized.

## Required Changes

Implement only the chosen 05-T01 strategy: internal/API persistence boundary, bounded JSON event/projection bridge, or direct PostgreSQL adapter. If investigation disproves that decision, return to Coordinator for decision/impact review rather than switching silently.

Connect Stream/Recording creation, reuse, attempts, transitions, and terminal outcomes to relational persistence. Retain sufficient IDs/context for valid new stream_id and target relationships, replay/idempotence, and reconciliation. Configuration must flow from the declared authority with current refresh semantics.

Preserve:
- Current polling, LIVE/OFFLINE/ERROR classification, and no false OFFLINE.
- enabled and pre-launch refresh guards for removed/invalid/changed targets.
- Authoritative URL, adaptive quality, and unchanged persisted preference.
- Stream reuse, later broadcast identity, and multiple Recording attempts.
- Safe media subprocess launch, monitoring, termination/reaping, and shutdown.
- Pending terminal persistence recovery and private local media output.
- Current state/ID/timestamp/output metadata contracts and legacy compatibility where required.

channels_status.json may remain operational as approved. If JSON carries events/projections, define a bounded durable/recoverable protocol with single-writer ownership per representation, ordering, acknowledgment, retries, deletion/config propagation, replay, and deterministic reconciliation. Do not make independently writable dual primaries.

## Failure and Recovery Matrix

Implement and test the approved policy for all cases:

| Scenario | Required observable outcome |
| --- | --- |
| DB unavailable before capture / startup | Explicit failure/readiness behavior; no acknowledged durable capture record without persistence; no blind duplicate launch |
| DB unavailable during capture | Preserve valid local output and managed child lifecycle; track/reconcile pending durable updates according to policy |
| DB unavailable during terminal write | Do not claim durable completion; retain recoverable terminal outcome and retry/reconcile without duplicate Recording |
| Worker restart | Recover/reconcile identity and pending state; stale process metadata must not blindly restart duplicate capture |
| API restart | Document dependency effect for the selected boundary; preserve/replay accepted updates safely |
| PostgreSQL restart | Domain state survives; reconnect/retry/reconcile without losing accepted updates |
| Duplicate/replayed/out-of-order updates | Deterministic idempotence/order policy; no duplicate attempts or regression of terminal state |

No silent JSON fallback that leaves PostgreSQL stale, false durable success, discarded valid local media, endless uncontrolled retry, or blind duplicate captures. Define how capture outcome differs from durable persistence acknowledgment. Expose safe errors/diagnostics without raw private URLs or secrets.

## Authority and Checkpoint

Demonstrate new Worker activity reaching PostgreSQL in disposable relational integration environments. Do not silently enable the bridge on unmigrated user installations; their opt-in activation remains 05-T06.

No legacy migrator, installation-wide cutover, Redis, BullMQ, Recording Jobs, heartbeat, SSE, media pipeline rewrite, or future-wave infrastructure.

## Acceptance Criteria

- [ ] Selected persistence strategy is implemented and traceable to 05-T01.
- [ ] New fake-platform Worker Stream/Recording activity is stored in PostgreSQL with valid IDs/relationships.
- [ ] Configuration refresh, enabled, URL, quality, Stream reuse, attempts, and subprocess behavior remain compatible.
- [ ] Every outage/restart/replay matrix row has deterministic evidence with isolated real PostgreSQL.
- [ ] Terminal persistence recovers without false durable success, lost valid local output, or duplicate capture/records.
- [ ] One primary authority and compatibility/runtime representation ownership are explicit.
- [ ] channels_status.json treatment follows the approved operational policy.
- [ ] No user installation is automatically migrated/cut over and no queue/auth/cloud feature is added.

## Automated Tests / Verification Commands

Use fake Streamlink/probe/process behavior, temporary media/storage, and isolated PostgreSQL. Extend existing lifecycle/adapter tests and isolated Docker integration smoke to cover ongoing writes, DB outages, restart, replay, ordering, and safe logs.

Run python -m unittest discover -s worker -p test_worker.py; python -m pytest worker/test_worker.py -q; API regression/typecheck/build when its boundary changes; docker compose config --quiet; pnpm test:smoke; selected DB outage/restart/replay commands; git diff --check.

No automated platform or live-stream dependency. Fake media is not proof of playable MP4. Record exact commands and unsupported environmental checks honestly.

## Risks / Rollback

Risks are cross-process divergence, loss of pending terminal updates, duplicate captures after reconnect, and mismatch between configuration and history authority. Rollback must quiesce/drain/reconcile writes at the approved checkpoint before changing the boundary. Do not delete local recordings or switch to stale JSON as an emergency success path.

## Notes for Coordinator / Sol / Terra / Luna

Sol traces all operational writes and approved failure semantics; Terra changes only the selected bridge. Coordinator exercises the matrix before Luna independently reviews durability, identity, and process/file safety. Migration/cutover and final whole-wave QA remain separate gates.
