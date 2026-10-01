---
name: Wave 04.75.4 Worker Probe and Recording Integration
wave: 04.75
order: 04
depends_on:
  - 03-adaptive-quality-selection.task.md
status: done
---

# Wave 04.75.4 — Worker Probe and Recording Integration

## Status

done

## Context

Wave 04 established explicit `LIVE`, `OFFLINE`, and `ERROR` probes. `poll_loop()` in `worker/worker.py` calls `is_live(url)`, creates/reuses an open Stream after LIVE, reloads the WatchTarget to enforce `enabled` and URL stability, then calls `start_recording()`. `start_recording()` currently has no available-quality context and passes configured quality exactly to Streamlink. Streams are persisted in `streams.json`; recordings are legacy-adapted to `sessions.json`, where `stream_id` is in-memory only.

## Problem

The LIVE probe and exact-quality recording command follow different selection paths. A preferred missing variant must not classify a live stream as OFFLINE or leave lifecycle state inconsistent when fallback capture starts.

## Objective

Integrate the deterministic selector from 04.75.3 into one probe-to-recording flow, preserving Wave 04 lifecycle, enabled gating, reload/race protections, Stream/Recording separation, and safe diagnostics.

## Scope

### In Scope

- Carry verified available variants from the existing probe through LIVE handling to recording launch.
- Invoke the 04.75.3 selection exactly once per eligible LIVE observation and pass the selected stream name to Streamlink.
- Worker lifecycle/integration tests, including observability.

### Out of Scope

- New domain fields, API/frontend work, JSON migration, real platform testing, background schedulers, cross-process locking, or public recording functionality.

## Current Architecture

- `is_live()` executes `streamlink --json <url>` and `classify_probe_result()` currently returns state/reason only in `worker/worker.py`.
- `poll_loop()` preserves active recordings, applies strict `enabled`, initializes runtime status, distinguishes LIVE/OFFLINE/ERROR, and reloads the target before start.
- `create_stream()`/`finalize_stream()` own `streams.json`; `start_recording()` creates Recording state and active child; `monitor_recording()`/`_persist_terminal_recording()` own terminal state.
- Compatibility conversion is `worker/json_adapters.py`; `RecordingJsonAdapter.from_domain()` intentionally removes in-memory `stream_id` for legacy `sessions.json`.

## Required Changes

- Modify the probe result boundary minimally so LIVE includes the validated available-variant context needed by 04.75.3, without retaining raw stream URLs or arbitrary raw JSON in state/logs. OFFLINE/ERROR contracts and diagnostics remain explicit.
- A valid non-empty mapping means LIVE irrespective of whether the configured preference exists. Selection failure due only to unavailable preference must never produce OFFLINE. If the validated mapping has no selectable playable candidate, distinguish that anomaly from preferred-unavailable and keep the Wave 04 classifier’s conservative error/offline rules.
- After the existing reload/enable/URL checks, select against the same completed probe mapping and invoke capture with the selected variant. Decide/document the safe race policy if the refreshed preference changes during the probe: reselect locally from the same validated mapping using the refreshed quality, or conservatively skip/reprobe; do not use stale preference silently.
- Preserve disabled behavior: disabled/invalid targets do no probe/new Stream/new Recording/new child; disabling during an active capture does not terminate it; the existing active guard prevents duplicates.
- Preserve Stream/Recording lifecycle: LIVE fallback creates/reuses exactly one open Stream then creates one Recording attempt; child launch/persistence failures retain current safe handling; confirmed OFFLINE finalizes only with no active capture; ERROR does not finalize/overwrite state.
- Keep `WatchTarget.quality` as configuration. Record selected quality in existing safe operational logs/active in-memory info only unless investigation proves a current compatible metadata location. Do not add a persisted field merely for observability.
- Use existing logging style (`worker` logger, safe identifiers, `_sanitize_diagnostic` discipline). Log preferred, bounded available names, selected, and fallback reason; no URLs, stream URLs, token/cookie/credential data, or full command.

## Behavioral Contract

| Observation | Required result |
| --- | --- |
| `1080p60` preference; validated mapping has `720p60` | LIVE, select `720p60`, start recording |
| Valid mapping lacks preferred but has `1080p` | LIVE, select `1080p`; never OFFLINE for that reason |
| Valid mapping has only one playable variant | LIVE and attempt that variant |
| Mapping empty/exact recognized no-stream response | OFFLINE under existing Wave 04 rule |
| Malformed/plugin/network/timeout response | ERROR; no finalization or recording launch |
| Disabled target | No probe/selection/Stream/Recording launch |

## Acceptance Criteria

- [ ] Probe LIVE is based on a non-empty valid mapping, independent of configured preference.
- [ ] A selected fallback is the exact quality passed to the capture invocation.
- [ ] No preferred-quality-missing path turns LIVE into OFFLINE.
- [ ] ERROR remains distinct from OFFLINE and retains an open Stream/state.
- [ ] Existing URL refresh, enabled, active-recording, persistence, Stream/Recording, and shutdown protections remain valid.
- [ ] Logs identify fallback safely; configured quality remains unchanged after capture fallback.

## Automated Tests

- Integration-style unit tests with patched `subprocess.run`, `Popen`, threads, clocks/sleep, and temporary JSON files: probe `1080p60` preference with `1080p`, `720p60`, `720p`, and a single stream; assert launched command selection, Stream/Recording IDs and states.
- Test LIVE no-preferred never calls offline finalization; confirmed OFFLINE and probe ERROR retain their Wave 04 semantics.
- Test refresh preference/URL/enable changes during probe, disabled targets, active captures, failed recording/retry lifecycle, and `WatchTarget.quality` unchanged.
- Capture logs to assert reason fields and absence of sensitive URL/credential fixtures. No real platform/FFmpeg/Streamlink process.

## Manual Verification

Use an isolated Docker fixture with fake Streamlink output to observe LIVE, selected fallback, capture start, and terminal Recording state. Do not use a live platform URL or publish media/logs.

## Verification Commands

- `python -m pytest worker/test_worker.py`
- `python -m unittest discover -s worker -p test_worker.py`
- `docker compose config --quiet`
- `pnpm test:smoke`
- `git diff --check`

## Dependencies

Requires the decision contract and selector from 04.75.3. Coordinate with 04.75.1 only to preserve the configured-preference distinction.

## Risks / Regression Risks

If the probe result discards variants too early, implementation may re-run Streamlink and introduce inconsistent observations. Persisting `stream_id` or selected quality through the legacy sessions adapter would change existing compatibility. Logging raw Streamlink maps risks stream URL/token leaks.

## Rollback Considerations

No data migration. Do not alter retained Stream/Recording history. Reverting integration must preserve Wave 04 probe classification and enabled protections, while acknowledging that exact-quality capture failure returns.

## Notes for Coordinator / Sol / Terra / Luna

Sol validates the smallest data flow from probe to selector. Terra must preserve current pre-launch refresh and terminal-persistence behavior. Luna reviews state transitions and command arguments with secret-safe logging, not merely fallback helper tests.
