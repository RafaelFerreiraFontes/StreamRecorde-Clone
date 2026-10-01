---
name: Wave 04.5 WatchTarget Enabled-State Enforcement
wave: 04
order: 05
depends_on:
  - 02-probe-result-model.task.md
  - 03-worker-probe-observability.task.md
status: done
---

# 04.5 — WatchTarget Enabled-State Enforcement

## Context

The Worker reads raw watchlist entries and never checks `enabled`. The API domain includes the field, but its adapter hardcodes true on read and drops it on serialization. Current POST defaults true and PATCH supports only `recording_subdir`. The supplied Twitch targets all have `enabled: true`; this defect did not cause that incident.

## Objective

Honor explicit enabled/disabled configuration while preserving current recordings and legacy watchlists that omit the field.

## Dependencies / Preconditions

04.2 defines probe/lifecycle reactions; 04.3 establishes safe diagnostics. Read [wave context](README.md), Worker polling/monitoring, API WatchTarget adapter/repository/DTOs, and tests. Preserve the current API route surface.

## Scope

Worker gating and lifecycle tests; minimal API adapter/type compatibility so explicit false is accurately exposed and preserved across existing writes. This bounded API correction is required by repository findings, not a new configuration UI.

## Out of Scope

New enable/disable endpoints or frontend controls, broad PATCH redesign, cancellation products, forced stopping/deleting recordings, a new Stream identity model, JSON migration, and future infrastructure.

## Required Changes

Implement the following contract using strict booleans, not Python/JavaScript truthiness:

| Configuration / event | Required behavior |
| --- | --- |
| `enabled: true` | Normal polling and capture rules |
| `enabled: false`, no active capture | No Streamlink probe, new Stream, recording start, or retry |
| Field omitted | Legacy default true; existing fixtures and users continue working |
| Present but invalid (`null`, string, number, array/object) | Skip probe/start with a safe configuration diagnostic; do not coerce `"false"` to true or treat it as confirmed offline |
| Disabled while already recording | Let the existing process finish normally; retain monitoring, stderr drain, and final Recording persistence |
| Capture ends/fails while disabled | Persist its normal finished/error result; do not start another attempt while disabled |
| Re-enabled while capture still active | Preserve the active-recording guard; no duplicate probe/capture |
| Re-enabled after capture ended | Resume normal probe rules: LIVE reuses an unfinalized Stream, OFFLINE finalizes it, ERROR preserves it |

- Disabling is monitoring configuration, not proof the broadcast ended. Do not finalize or delete a Stream merely because the target was disabled. Its last observed state can remain stale until an enabled probe confirms the next observation; document this MVP limitation.
- A broadcast may end and another begin entirely while disabled. Without a confirmed offline observation/platform ID the current model cannot distinguish that gap reliably. Preserve the open Stream conservatively; do not invent timestamps or add platform metadata APIs.
- Apply the gate before probe/start on each loaded target. Define timing as the next successful configuration refresh. Re-read the target's enabled flag immediately before launching after a potentially long probe; if that read fails, the target disappeared, or it is now disabled/invalid, do not launch. This narrows the race but cannot promise an atomic API/Worker transaction.
- Keep current SIGTERM behavior independent of disabling. Do not use shutdown/cancellation logic to implement false. Do not purge runtime/history/media or overwrite a still-recording status with offline.
- Extend the API watchlist compatibility representation with optional boolean `enabled`; default omitted to true, expose explicit false, and preserve it on domain round trips and existing mutations (including recording_subdir changes). Do not backfill every legacy file on read. Keep current create defaults and endpoint contracts; legacy consumers may ignore the optional field.
- Validate invalid persisted values consistently without silently reporting enabled true. Sol should choose the smallest explicit adapter error/validation path consistent with existing invalid-JSON handling; no new API state enum is needed.

## Compatibility Requirements

Preserve target IDs, multiple independent targets per Creator, quality/subdirectory settings, existing routes, status enums, and sessions/streams shapes. Adding optional `enabled` to the watchlist boundary must not alter legacy Session mapping. No `Stream.channel_id`.

## Acceptance Criteria

- [ ] False causes zero probe/subprocess/start calls and no new Stream/Recording.
- [ ] True and omitted preserve normal behavior; invalid values cannot accidentally activate capture.
- [ ] A mid-capture disable never terminates/kills the process or deletes output/history; finalization still persists its actual result.
- [ ] No retry occurs while disabled; re-enabling behaves according to the lifecycle table without duplicates.
- [ ] Disable observed after a probe but before launch prevents a new recording.
- [ ] API reads explicit false correctly and preserves it across existing supported writes; legacy omitted fields retain their default.
- [ ] Behavior and observation-gap limitations are documented and covered by deterministic tests.

## Verification

Mock probe/process calls and bounded polling across true/false/omitted/invalid values. Simulate configuration change during a probe and capture completion while disabled. Assert process terminate/kill are not called by disabling and Stream `finished_at` is unchanged. Test two targets for one Creator independently.

Run `python -m pytest worker/test_worker.py`. From `api/`, run `pnpm test -- --runInBand` and `pnpm exec tsc --noEmit` for adapter/repository compatibility; keep old shape assertions where applicable and add optional-field fixtures. Run `git diff --check`. Never require a live channel.

## Risks / Notes

No distributed lock exists: changes after the final read can race with launch. Promise the documented refresh/pre-launch boundary, not instantaneous cancellation. A disabled open Stream may remain unresolved for a long time; stale observation is preferable to a fabricated broadcast end.

## Rollback / Safety

No data migration/removal. Preserve explicit false fields on rollback; warn that older Worker/API versions ignore/misreport them. Do not deploy that rollback as if disabled targets remain protected. Never delete existing recordings to enforce configuration.

## Files likely affected

`worker/worker.py`, `worker/test_worker.py`, `api/src/streams/json-compatibility.adapters.ts`, relevant `api/src/streams/streams.repository.ts` types/mapping only if needed, and `api/src/streams/test/stream.controller.spec.ts`/fixtures. Endpoint/DTO expansion is out of scope. Sol checks the boundary, Terra implements the gate, Luna verifies non-destructive lifecycle behavior.
