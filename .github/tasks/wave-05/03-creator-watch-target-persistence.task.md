---
name: Wave 05 — Task 03 — Creator and WatchTarget Relational Persistence
wave: 05
order: 03
depends_on:
  - 02-postgresql-foundation-schema.task.md
status: planned
---

# Wave 05 — Task 03 — Creator and WatchTarget Relational Persistence

## Status and Preconditions

planned — execution has not started. Read the [wave specification](README.md) and complete the predecessor's independent validation/review and human acceptance gate before starting. The shared scope, security, testing, and lifecycle constraints apply to this task.

## Context / Objective

Give Creator stable persisted identity and WatchTarget relational configuration while retaining current API/legacy behavior and transitional Worker compatibility. The DB foundation is already independently accepted.

Creator CRUD is limited to domain/API management required to establish stable Creator identity. A full frontend Creator-management redesign is explicitly out of scope; the UI may keep its current flow.

## Required Changes

- Implement Creator create/read/update/delete-management and repository behavior under the 05-T01 policy. Use stable IDs independent of mutable display names.
- Implement explicit legacy name-derived identity mapping, collision/duplicate-name handling, rename behavior, and compatibility with existing Creator GET/name references. Do not silently merge distinct Creators or reassign history.
- Persist WatchTarget IDs, Creator relationships, platform/channel, quality, enabled, URL, and recording_subdir with approved constraints.
- Preserve current POST/defaults and PATCH semantics: omitted fields unchanged, empty recording_subdir clears override, absent legacy enabled defaults true. Retain strict boolean, URL, quality, and relative-path validation.
- Preserve modern/legacy response shapes, status/errors, filters and mappings; adapt the Next proxy only if necessary for required API compatibility, not UI redesign.
- Implement the minimum approved configuration projection/boundary needed for the existing polling Worker to observe targets correctly while it still depends on transitional compatibility. Preserve refresh, URL, quality preference, disabled behavior, and current configuration path precedence.
- Keep one declared primary authority in every execution mode, including fixtures. No uncontrolled dual writable configuration stores, silent DB fallback, or lossy projection.
- Apply approved history-safe Creator/target deletion and immutable-context policies. Do not cascade-delete recordings or media by convenience.

## Authority and Checkpoint

Prove relational Creator/WatchTarget behavior and the configuration compatibility boundary in an isolated installation. Existing installations remain on their approved pre-cutover authority until opt-in migration in 05-T06; implement only the activation boundaries approved in 05-T01.

Do not import user JSON or perform Stream/Recording authority cutover here. This checkpoint must keep current Worker behavior viable but does not establish its new operational history writes (05-T05).

## Acceptance Criteria

- [ ] Creator has stable independently persisted identity and bounded domain/API CRUD.
- [ ] Name mapping, collisions, rename, and delete/history behavior are explicit and tested.
- [ ] WatchTarget fields/IDs/relationships survive round trips and restart.
- [ ] Required modern/legacy API and existing frontend creation flow remain compatible.
- [ ] Three targets under one Creator remain independent after edit, disable, and delete.
- [ ] Required transitional configuration reaches the existing Worker without silently creating dual primaries.
- [ ] DB/configuration-projection failures are explicit and do not falsely report successful durable mutation.
- [ ] No Stream/Recording authority switch, user-data import, or frontend redesign occurred.

## Automated Tests / Verification

Required fixture:

```text
Creator A
├── WatchTarget A
├── WatchTarget B
└── WatchTarget C
```

Use real isolated PostgreSQL to test Creator CRUD/IDs, collision/rename mapping, relationships, configuration fields, defaults, strict invalid inputs, sibling independence, timestamps where defined, deletion policy, persistence restart, and mutation/projection failure behavior.

Run API Jest/typecheck/build, focused JSON adapter/legacy regressions, and configuration compatibility tests with the current Worker using fake probes/processes. Run focused frontend proxy/component tests only for affected compatibility; full regression remains 05-T07. Use pnpm test --runInBand, pnpm exec tsc --noEmit, pnpm build in api; targeted Worker unittest/pytest; git diff --check. Record selected DB integration and projection commands. No real platforms or user fixtures.

## Risks / Rollback

Name collisions and renamed identities can corrupt grouping/history; schema-valid projection can still break Worker configuration. Roll back only this checkpoint's approved activation/projection changes, preserving the DB foundation, identity mapping, and any accepted data. Reconcile writes before restoring a previous authority; do not recover by deleting targets/history/media.

## Notes for Coordinator / Sol / Terra / Luna

Sol verifies mapping and compatibility seams. Terra implements bounded domain/API work. Coordinator validates relational and sibling/projection tests before Luna reviews identity/history safety. No later task may infer approval from code presence alone.
