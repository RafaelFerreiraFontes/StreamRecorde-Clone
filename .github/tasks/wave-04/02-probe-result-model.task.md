---
name: Wave 04.2 Probe Result Model and Error Classification
wave: 04
order: 02
depends_on:
  - 01-streamlink-runtime-upgrade.task.md
status: done
---

# 04.2 — Probe Result Model and Error Classification

## Context

`is_live()` returns false on non-zero exit, empty stdout, missing/empty `streams`, or exceptions. `poll_loop()` interprets false as offline and invokes `finalize_stream()`. Active captures are currently skipped, but an open Stream after a recording failure can be incorrectly ended by a temporary probe failure.

## Objective

Introduce a minimal explicit `LIVE / OFFLINE / ERROR` result and make `PROBE ERROR != OFFLINE` an enforced lifecycle rule.

## Dependencies / Preconditions

04.1 establishes the supported CLI/output contract. Read [wave context](README.md), `is_live`, `poll_loop`, `find_active_stream`, `finalize_stream`, recording monitoring, and the existing StreamDetectionTests. No network is required for implementation tests.

## Scope

One small typed result (enum plus optional diagnostic fields, or equivalent), parser/classification helper, polling reactions, and focused regression tests. Diagnostics should retain only bounded safe information needed by 04.3.

## Out of Scope

General resolver framework, retries within endless loops, new platform APIs, new persistence schemas, Recording-state enum redesign, distributed coordination, frontend changes, or shared future infrastructure listed in the wave README.

## Required Changes

Sol must verify the pinned CLI's no-streams behavior rather than assuming every non-zero exit means offline. Implement and test this decision table:

| Probe evidence | Result | Polling behavior |
| --- | --- | --- |
| Exit 0, JSON object with a valid non-empty `streams` mapping, no error | LIVE | Reuse open Stream or create one; start capture only if this enabled WatchTarget has none active |
| Exit 0, valid JSON object with explicitly empty `streams` mapping and no error | OFFLINE | Mark runtime offline; finalize open Stream only if no capture remains active |
| Exact, verified pinned-CLI no-streams response, if that CLI uses a non-zero exit/error envelope for this case | OFFLINE only for that documented signature | Same confirmed-offline behavior; add a fixture for this narrowly recognized case |
| Other non-zero exit, including plugin/network/Twitch dependency failure | ERROR | Preserve previous broadcast/operational state; no creation, capture retry, or Stream finalization on this poll |
| Timeout, empty/whitespace stdout, malformed JSON, missing `streams`, wrong root/type, invalid `streams` type, or unrecognized `error` envelope (even exit 0) | ERROR | Preserve state; retry on a future normal poll |
| Executable missing, process-launch error, or unexpected ordinary exception | ERROR | Preserve state; diagnostic event; continue other targets |

- An ambiguous response is ERROR. Do not use broad substring matching such as any message containing "offline"; plugin/network/auth errors can contain similar words. Document the actual pinned-version offline fixture and precedence of error envelopes over stream data.
- Replace boolean branching explicitly; an ERROR enum/object must not be interpreted as truthy LIVE. Keep subprocess argument lists, capture timeout, and process cleanup on timeout.
- Preserve the current skip for an already-active recording. Confirmed OFFLINE cannot terminate an active capture. Recording completion/failure continues to be determined by its process/output, not a probe result.
- ERROR leaves previous `channels_status` state and Stream timestamps unchanged. For a newly seen target with no prior status, idle initialization is acceptable; ERROR must not invent an offline/finished transition. Log diagnostics separately, without changing legacy Recording states.
- A failed capture followed by ERROR keeps its open Stream; a later LIVE retries against that Stream. Confirmed OFFLINE closes it; a subsequent LIVE creates a new ID. Do not claim platform-native broadcast identity during unobserved gaps.
- Catch ordinary exceptions, not shutdown signals such as `KeyboardInterrupt`/`SystemExit`. Keep polling interval and bounded execution intact.

## Compatibility Requirements

Preserve Wave 02 `Stream.watch_target_id`, JSON shapes, and `sessions.json` compatibility. Do not persist probe result values as Recording states or introduce `Stream.channel_id`. Existing boolean mocks may be adapted to explicit results while preserving their assertions.

## Acceptance Criteria

- [ ] Every table case has an explicit deterministic classification test, including the supplied Twitch error envelope.
- [ ] Non-zero operational errors, invalid output, and timeouts cannot become OFFLINE.
- [ ] Temporary ERROR preserves an open Stream ID, `finished_at`, and prior operational state; no new capture starts.
- [ ] Confirmed OFFLINE finalizes only when no recording is active; later LIVE gets a new Stream.
- [ ] LIVE reuses an existing open Stream and does not duplicate an active recording.
- [ ] Existing shutdown, reload, adapter, and lifecycle tests remain valid.

## Verification

Mock `subprocess.run` results/exceptions and use temporary JSON files. Test `LIVE -> capture failure -> ERROR -> LIVE -> OFFLINE -> LIVE` with bounded loop iterations and explicit IDs/timestamps/call counts. Run `python -m pytest worker/test_worker.py` and `git diff --check`. Do not use real URLs/processes in automated tests. 04.6 consolidates coverage but does not postpone this task's focused tests.

## Risks / Notes

CLI no-streams output can vary by version/plugin; freeze representative sanitized fixtures for the selected version and default unknown forms to ERROR. Capture and probe failures are separate events. Existing persisted open Streams may be stale after restart; do not invent a new reconciliation architecture here.

## Rollback / Safety

No JSON migration is needed. Reverting the classifier reintroduces false-offline risk and must be reported explicitly; never compensate by deleting open Streams/history. Keep all test state isolated.

## Files likely affected

`worker/worker.py`, `worker/test_worker.py`; a small Worker-local helper only if it simplifies testing, with Docker copy/import handling verified. Sol defines the precise CLI contract, Terra implements it, Luna reviews state transitions and failure evidence under the existing workflow.
