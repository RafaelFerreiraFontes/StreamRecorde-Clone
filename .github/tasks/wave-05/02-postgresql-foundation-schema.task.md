---
name: Wave 05 — Task 02 — PostgreSQL Foundation and Schema
wave: 05
order: 02
depends_on:
  - 01-persistence-architecture-decisions.task.md
status: planned
---

# Wave 05 — Task 02 — PostgreSQL Foundation and Schema

## Status and Preconditions

planned — execution has not started. Read the [wave specification](README.md) and complete the predecessor's independent validation/review and human acceptance gate before starting. The shared scope, security, testing, and lifecycle constraints apply to this task.

## Context / Objective

Implement the approved 05-T01 foundation: local PostgreSQL, selected ORM/query layer, reproducible schema/migrations, and the minimum repository/persistence seam. This proves storage infrastructure independently of domain rollout and Worker changes.

## Scope / Required Changes

- Add a local postgres Compose service with persistent local volume, healthcheck, readiness/startup handling, and ordinary restart/recreation persistence.
- Use environment configuration, .env.example if needed, safe documented local defaults, no real committed credentials, and local-only exposure where possible.
- Implement exactly the chosen ORM/query layer and migration tooling from 05-T01. Record exact clean setup/upgrade/test commands.
- Create initial Creator, WatchTarget, Stream, Recording schema according to approved IDs, FKs, nullability, uniqueness, indexes, timestamp representation, history-safe deletion, and transaction policies.
- Encode supported Recording/Stream target consistency and preservation of current states; no fictitious user_id, User, Tag, queue, or cloud schema.
- Reuse StreamsRepository/adapters as a minimal seam; preserve the JSON path and current contracts. Avoid unrelated generic repository refactors.
- Establish an isolated integration-test database/project with explicit connection/volume boundaries and cleanup limited to owned fixtures.
- Preserve current local recording mounts, API read-only access, frontend proxy, non-root Worker, path overrides, and Docker Desktop/Windows compatibility. Metadata belongs in PostgreSQL; media files remain local.

## Explicit Exclusions and Authority Boundary

No authority cutover, legacy import, Creator CRUD rollout, Stream/Recording operational integration, or Worker persistence bridge. Existing application authority remains as recorded in 05-T01. Schema presence must not silently activate the database for existing users.

All wave-wide exclusions apply, including auth, Redis/BullMQ, Tags, cloud, and desktop. Implement only minimal connection/readiness failure reporting necessary for this foundation; capture-outage behavior belongs to 05-T05.

## Acceptance Criteria

- [ ] Clean isolated DB -> migrations -> expected four-entity schema is reproducible.
- [ ] Constraints, indexes, FK/deletion strategy, timestamps, and current state vocabulary match approved decisions.
- [ ] Re-running migration tooling behaves predictably; failures are explicit rather than leaving an undocumented partial schema.
- [ ] Insert disposable state -> restart/recreate DB service retaining its volume -> state remains.
- [ ] Test DB is isolated from normal local DB, runtime-data, and recordings; no user runtime-data is modified.
- [ ] PostgreSQL health/readiness and unavailable-connection behavior are documented and tested locally.
- [ ] Minimal seam leaves existing JSON behavior/contracts intact; no live authority changes.
- [ ] Local Compose works on Docker Desktop/Windows with no real credentials committed.
- [ ] Focused migration/schema/infrastructure evidence is sufficient for independent review.

## Automated Tests / Verification Commands

Use the current test frameworks plus real isolated PostgreSQL integration tests, not only mocked repositories. Assert schema/constraint behavior, transaction rollback where used, migration initialization/replay, connection failure, and restart persistence.

Run API pnpm test --runInBand, pnpm exec tsc --noEmit, and pnpm build from api as affected; root docker compose config --quiet; foundation integration/migration/restart commands defined for the selected tool; git diff --check. Record exact safe commands before acceptance. Tests need no platform/internet/live stream; dependency/image preparation is separate.

## Risks / Rollback

Risks include schema decisions inconsistent with legacy data, destructive migration defaults, wrong DB URL, and tests touching user volumes. Rollback this checkpoint by deactivating only the new unused integration and following the approved schema backup policy; do not drop normal local volumes. No data authority or import rollback should be necessary at this stage.

## Notes for Coordinator / Sol / Terra / Luna

Sol translates approved decisions to a bounded foundation plan; Terra implements only that plan. Coordinator proves schema/restart/isolation gates before Luna reviews infrastructure and migration safety. Later domain acceptance is not required to close this checkpoint.
