---
name: Wave 05.5 — Task 02 — User Schema, Local Account and Ownership Migration
wave: "05.5"
order: 02
depends_on:
  - 01-authentication-ownership-decisions.task.md
status: planned
---

# Wave 05.5 — Task 02 — User Schema, Local Account and Ownership Migration

## Status and Preconditions

Planned only; implementation has not started. Read the [wave specification](README.md), project/MVP instructions and the accepted predecessor deliverables. Wait for predecessor validation, independent review and human acceptance under the existing lifecycle. Creating this task does not authorize its execution.

T01's accepted authentication-ownership-decisions.md is required. If it is missing or a relevant decision is unresolved, return to Coordinator review rather than inventing a policy.

## Context / Objective

Implement the accepted User/ownership schema and explicit migration paths in isolated environments, without activating authentication or changing normal installation authority.

## Scope / Required Changes

- Use existing Drizzle/PostgreSQL tooling and append new reviewable migrations; do not rewrite applied Wave 05 migrations.
- Implement stable User identity and the accepted account fields, normalization, constraints and indexes. Bootstrap one persistent local account idempotently, including concurrent/repeated execution.
- Assign existing relational rows to the designated local account transactionally according to T01. Preserve UUIDs, raw historical timestamps, NULL stream links, archival state, output paths and Recording/session compatibility.
- Implement ownership constraints or validated relationship strategy for all four entities. Reject cross-owner associations; avoid adding speculative Tag/cloud/job tables.
- Adapt legacy import, verification and manifest handling to the accepted owner mapping. Preserve empty-domain import checks and detect changed-owner replay rather than silently reassigning data.
- Keep minimum repository/Worker insertion compatibility needed for the schema transition explicit and limited to the gated local checkpoint. Do not claim authorization is complete before T04/T05.
- Document exact clean-install, upgrade, import/replay and recovery commands; use synthetic source files and an isolated database only.

## Relevant Areas

api/src/database/, api/drizzle/migrations/, api/src/migrator/, api/src/streams/ insertion paths, api/README.database.md and isolated database tests.

## Explicit Exclusions and Activation Boundary

All wave-wide exclusions apply. No normal-installation cutover, real-data migration, media changes, deployment, staging, commit or push is authorized by this task file. Implement only the current checkpoint; do not advance later tasks automatically. Preserve JSON compatibility according to T01 and keep incomplete authenticated operation disabled.

## Acceptance Criteria

- [ ] Fresh migrations and repeat runs succeed; concurrent bootstrap yields one local identity.
- [ ] Populated relational upgrade preserves all domain counts, IDs and historical fields with correct ownership.
- [ ] Legacy import/verify/replay and conflicting owner or manifest cases behave as specified.
- [ ] Constraint failures and late migration/import failures leave recoverable, consistent state.
- [ ] Existing JSON behavior remains available as documented; no normal data or media is migrated.

## Automated Tests / Verification

Run focused schema/import tests against real isolated PostgreSQL, including rollback and repeat execution. Then affected API Jest/typecheck/build and the existing database foundation harness as applicable. Record exact commands and git diff --check.

Use current scripts/frameworks; resolve exact safe commands during planning. No live platforms or real user data as fixtures. Dependencies/images may require separate preparation. Report unavailable prerequisites honestly; do not replace required database/integration evidence with mocks.

## Risks / Recovery

Back up before any separately authorized real upgrade. No automatic downgrade, owner reassignment, volume removal or stale JSON fallback after relational writes.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator checks branch, working tree and scope before delegation. Sol plans this checkpoint against accepted decisions; Terra implements only the approved plan. Coordinator runs objective validation before Luna independently reviews acceptance, scope and compatibility. Keep planned -> implement -> review/QA -> user-approve -> done, with fixing/coordinator-review paths and existing separate diagnostic/review limits. No automatic acceptance or commit is implied.
