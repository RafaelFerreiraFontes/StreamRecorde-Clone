---
name: streamrecorder-postgres-persistence
description: Validate staged PostgreSQL/Drizzle schema, migrations, relational repositories, transactions, legacy JSON import, recovery, and authority cutover for StreamRecorder persistence changes, including Wave 05 tasks.
---

# PostgreSQL persistence

## Purpose and use

Make persistence changes conform to the authorized stage and its current decisions, with executable data-integrity evidence.

## Read first

- The concrete task, [Wave 05 plan](../../../.github/tasks/wave-05/README.md), and [persistence architecture decisions](../../../.github/tasks/wave-05/persistence-architecture-decisions.md) when present. Recheck that document each time; it owns architecture, timestamp, identity, authority, and recovery policy.
- [Project instructions](../../../.github/instructions/project.instructions.md), [API README](../../../api/README.md), [repository](../../../api/src/streams/streams.repository.ts), [API adapters](../../../api/src/streams/json-compatibility.adapters.ts), and [Worker adapters](../../../worker/json_adapters.py).
- Locate current schema, checked-in migrations, database configuration, and integration tests in the actual tree. Their absence is not permission to implement a later task.

## Procedure

1. Resolve task dependencies and permitted stage. Compare the canonical authority ledger with implemented readers/writers: identify the primary store per entity, projections, activation guard, and recovery checkpoint. Report stale documentation rather than assuming all Wave 05 work is active.
2. Review versioned, reproducible migrations and schema together. Confirm clean setup and supported upgrades, predictable reruns, explicit failures, constraints/indexes, stable IDs, FKs, same-target relationships, and history-safe deletion against current decisions.
3. Verify legacy Creator mapping/collisions, Recording `session_id`, target IDs, and unknown historical `stream_id`. Preserve timezone-free legacy timestamp provenance under the approved policy; never silently label wall-clock text UTC or invent historical links.
4. Define transaction boundaries from the requested operation. Check rollback, uniqueness/idempotence, concurrent/replayed updates, and acknowledgement after durable commit where applicable. File I/O and media bytes do not become transactional because metadata uses PostgreSQL.
5. Before any DB command, verify the effective connection targets an isolated disposable database/project, with owned resources and no normal runtime-data/media fixtures. Use the Docker workflow for container/volume isolation when relevant.
6. Execute the stage's real migration/repository tests, including integrity violations, restart durability, and unavailable-DB behavior as required. For authorized import/cutover, verify dry-run, consistent source snapshot, backups, counts, conflict handling, ongoing Worker writes, and the current recovery/rollback policy before activation.

## Safety / invariants

No accidental dual-primary, silent stale-store fallback, or cutover without task authority. PostgreSQL holds metadata, not media. Preserve valid files on metadata failure. Do not add User, `user_id`, Tags, Redis, BullMQ, or cloud features in anticipation of future waves. Missing or conflicting architecture decisions require resolution rather than an invented replacement in this skill.

## Validation and expected result

Use current migration commands from implemented tooling, not guessed Drizzle commands. Record database isolation, authority before/after, schema/integrity and failure/recovery evidence, commands/results, and any untested stage. Persistence readiness review may also use review-gate. Return a bounded verdict for the concrete task, never a claim that the whole Wave is complete.
