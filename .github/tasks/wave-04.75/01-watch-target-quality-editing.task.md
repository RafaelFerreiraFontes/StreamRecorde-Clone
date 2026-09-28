---
name: Wave 04.75.1 WatchTarget Quality Editing
wave: 04.75
order: 01
status: done
---

# Wave 04.75.1 — WatchTarget Quality Editing

## Status

done

## Context

`WatchTarget.quality` is already a persisted user preference. The current API create DTO and frontend create form expose a finite quality list, but `PATCH /watch-targets/:id` accepts only `enabled` and `recording_subdir`; the Watch Targets table renders quality as read-only.

## Problem

Users cannot change an existing target's preferred quality without recreating it. The PATCH allowlist rejects `{ quality }`, despite JSON already storing the field.

## Objective

Extend the existing PATCH contract and the Watch Targets UI so a user can safely edit and persist the preferred quality, without changing its meaning into the effective quality selected during a live recording.

## Scope

### In Scope

- PATCH DTO/service/repository support for `quality`, validation, atomic JSON update, and round-trip compatibility.
- An accessible per-target editable quality control in the existing Monitoring configuration table, with saving, error feedback, rollback/reconciliation, and refetch.
- Focused API and existing `node:test`/React component tests.

### Out of Scope

- Adaptive Worker selection (04.75.3/04.75.4), new endpoints, a schema migration, persisting actual selected quality, or changing create/delete/recordings browser behavior.

## Current Architecture

- Domain/API contract: `api/src/streams/domain.model.ts`, `api/src/streams/dto/watch-target.dto.ts`.
- PATCH route and limited allowlist: `api/src/streams/streams.controller.ts`, `api/src/streams/streams.service.ts`, `api/src/streams/streams.repository.ts`.
- `WatchTargetJsonAdapter` maps `quality` both directions in `api/src/streams/json-compatibility.adapters.ts`; `watchlist.json` owns configuration.
- UI constants and table: `frontend/lib/types.ts`, `frontend/app/watch-targets/page.tsx`; API calls transit the existing Next proxy in `frontend/lib/api.ts` / `frontend/app/api/backend/[...path]/route.ts`.
- Existing component-test convention: `frontend/tests/wave-04.5-components.test.tsx`.

## Required Changes

- Add optional `quality` to `PatchWatchTargetDto` and to the existing PATCH service allowlist; reject unknown keys as today.
- Reuse the create-quality validation/normalization policy where practical. Current accepted values are `best`, `worst`, `source`, `chunked`, `1080p60`, `720p60`, `1080p`, `720p`, `480p`, `360p`; investigate the pinned Streamlink 8.6.1 representation before freezing the edit control. Include at least `best`, `source`, `1080p60`, `1080p`, `720p60`, `720p`, `480p`, `360p`, and `160p` if supported. Do not silently narrow valid pre-existing Streamlink values; preserve an existing valid value that is absent from a curated select (for example via an explicit current/custom option or a compatible input strategy).
- Extend the repository update method atomically, preserving all sibling target fields, IDs, `enabled`, `recording_subdir`, URL, and legacy omitted-field behavior. Keep `WatchTargetJsonAdapter` as the compatibility boundary and prove `quality` survives adapter round trips.
- Make Quality editable in the existing table, preferably an inline `<select>` consistent with the enabled/folder controls. It must PATCH only `{ quality }`, show saving/disabled state, expose an accessible label, display an error on failure, restore/reconcile the server-rendered value on failure, and call the existing dashboard refetch after success.
- Treat quality as the configured preference only. Do not alter it in response to an eventual Worker fallback.

## Behavioral Contract

| Event | Required result |
| --- | --- |
| Valid quality PATCH | Persisted `WatchTarget.quality` changes and GET/refetch returns it |
| Invalid/empty/non-string or unsupported PATCH | 400 with no partial JSON write |
| PATCH omits quality | Existing quality remains unchanged |
| UI request fails | Control exits saving state and returns to/refetches the persisted value with visible error |
| Existing JSON quality | Read/write adapter and unrelated PATCH fields preserve it |

## Acceptance Criteria

- [ ] `PATCH /watch-targets/:id` accepts a valid quality without a parallel endpoint.
- [ ] Invalid quality is rejected before persistence and cannot modify siblings or unrelated fields.
- [ ] Quality adapter/domain/JSON round trips preserve configured values and legacy fields.
- [ ] The table has an accessible editable Quality control with pending/error/reconciliation behavior.
- [ ] Refetch displays the persisted API value, not a stale optimistic value.
- [ ] No Worker execution behavior or public recording access changes.

## Automated Tests

- API HTTP/unit tests for valid PATCH, invalid value/type/unknown key, omitted field no-op, persistence, JSON adapter round trip, and preservation of `url`, `enabled`, `recording_subdir`, IDs, and sibling entries.
- Extend the Wave 04.5 component setup to assert PATCH payload, saving/disabled state, successful refetch, API-error rollback, and a value already stored outside the visible default options if compatibility requires it.

## Manual Verification

Create a target, change `best` to `720p60`, reload Watch Targets, and confirm the same configured preference appears. Attempt an invalid request through the API and confirm the JSON and UI do not change.

## Verification Commands

- `cd api; pnpm test -- --runInBand`
- `cd api; pnpm exec tsc --noEmit`
- `cd api; pnpm build`
- `cd frontend; pnpm test`
- `cd frontend; pnpm typecheck`
- `cd frontend; pnpm build`
- `docker compose config --quiet`
- `git diff --check`

## Dependencies

None. Coordinate quality validation semantics with 04.75.3 before broadening any accepted-value list.

## Risks / Regression Risks

A UI-only fixed list can accidentally make already persisted Streamlink variants uneditable. Repository parameter ordering can cause accidental modification of `enabled`/folder fields; use an explicit patch object or equivalently unambiguous contract.

## Rollback Considerations

No migration. A rollback must leave the persisted preference intact; older clients can continue reading it as before.

## Notes for Coordinator / Sol / Terra / Luna

Keep this task API/frontend-only. Sol verifies Streamlink-name compatibility; Terra implements the narrow existing PATCH extension; Luna checks JSON round-trip and UI rollback rather than only happy-path rendering.
