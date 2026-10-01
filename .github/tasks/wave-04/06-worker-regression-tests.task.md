---
name: Wave 04.6 Worker Regression and Probe Test Coverage
wave: 04
order: 06
depends_on:
  - 01-streamlink-runtime-upgrade.task.md
  - 02-probe-result-model.task.md
  - 03-worker-probe-observability.task.md
  - 04-runtime-directory-permissions.task.md
  - 05-watch-target-enabled-enforcement.task.md
status: done
---

# 04.6 — Worker Regression and Probe Test Coverage

## Context

`worker/test_worker.py` uses unittest, temporary paths, FakeProcess, patched subprocess/thread calls, and bounded polling via patched sleep. It already tests Stream identity, recording lifecycle, shutdown/stderr drain, adapters, path validation, and initialization. Most detection tests mock boolean `is_live`, leaving actual probe parsing failures untested.

## Objective

Complete a deterministic regression matrix proving Wave 04 failure handling and preserving prior behavior without contacting live platforms.

## Dependencies / Preconditions

04.1–04.5 implementations and their focused tests are available. Read [wave context](README.md), their evidence and decisions, current Worker tests, API compatibility tests, and pinned-version probe fixtures. This task consolidates coverage; earlier tasks still require their own focused tests.

## Scope

Add missing tests/fixtures and minimally adapt obsolete boolean mocks to explicit results. Preserve prior assertions and coverage unless their obsolescence is demonstrated. Report uncovered implementation defects to the owning task/Coordinator instead of broadening this test task.

## Out of Scope

Live Twitch/YouTube/Kick, internet-dependent tests, actual recording processes in unit tests, dependency upgrades, a new test framework, broad refactoring, skipped assertions to obtain green tests, and future infrastructure.

## Required Changes

Cover at least this matrix with direct assertions on return values, side effects, persisted data, and call counts:

| Area | Required cases / assertions |
| --- | --- |
| Parser | Non-empty streams LIVE; confirmed empty-stream OFFLINE; exact supported no-streams CLI signature if applicable |
| Error classification | Non-zero exit, supplied Twitch dependency error, network/plugin error, error envelope with exit 0, timeout, malformed JSON, empty/whitespace stdout, missing streams, wrong root/streams type, executable missing, OS/process error, unexpected exception |
| Open Stream | Temporary ERROR preserves ID/state/timestamps and does not retry capture; confirmed OFFLINE ends it only with no active capture |
| Broadcast identity | Same live broadcast reuses Stream across failed recording/retry; observed OFFLINE then later LIVE creates a new Stream |
| Active recording | Repeated polling creates no duplicate process/Recording/Stream; active capture is not finalized by probe logic |
| Enabled | True, false, omitted legacy flag, invalid values, disable mid-capture, completion while disabled, re-enable, change during probe, two independent targets |
| Persistence | Startup unwritable directory with existing files; temp create/write/fsync/replace failure; old JSON intact; descriptor/temp cleanup; mid-run state/process tracking and pending-state recovery |
| Observability | LIVE/OFFLINE/ERROR events, actual runtime version diagnostics, timeout/exit/exception context, secret redaction including existing stderr logs, bounded output |
| Prior guarantees | Shutdown/kill fallback, reload preserving active state, malformed persisted JSON, path overrides/subdirectory containment, legacy Session round trips, Stream without channel_id |

- Mock `subprocess.run` at the real probe boundary rather than only returning ready-made probe results. Combine parser unit tests with polling/lifecycle tests to catch accidental truthiness of an ERROR result.
- Patch Popen, threads, clocks/sleep, and output paths; ensure no accidental Streamlink/FFmpeg execution. Fake time/iterations must make every test terminate promptly without real polling delays.
- Isolate/reset all module globals, including `streams_data`, active recordings, paths, and locks. Keep fixture data beneath temporary directories and avoid `runtime-data`, `worker/config`, developer `.env`, or real media.
- Use fault injection for permission errors across Windows/Linux; supplement with real POSIX ownership checks only in 04.7. Test recovered persistence, not only an exception being raised.
- Preserve valid existing tests. If renamed or rewritten, record the old test's purpose and corresponding new assertion; do not remove failure coverage because the result type changed.

## Compatibility Requirements

Keep unittest-compatible tests runnable under the documented pytest command. No new production test mode or network fixture dependency. Preserve legacy `sessions.json` without persisted `stream_id`; in-memory Recording association must not be mistaken for a durable API field.

## Acceptance Criteria

- [ ] Every matrix row has named tests/fixtures linked in the implementation report.
- [ ] Tests run with all external platform/subprocess behavior substituted and no internet/live channel requirement.
- [ ] Error paths assert no false offline/end transition or capture start, not merely successful exception handling.
- [ ] Existing Stream/Recording/path/shutdown/compatibility coverage is retained.
- [ ] Permission and enabled-state recovery sequences verify data and process safety.
- [ ] Full affected Worker suite passes; relevant API regression suite/typecheck passes when API tests/boundaries changed.

## Verification

Run focused new cases while implementing, then `python -m pytest worker/test_worker.py` once after the final edits. Optionally use `python -m unittest discover -s worker -p test_worker.py` to verify stdlib compatibility when relevant. From `api/`, run `pnpm test -- --runInBand` and `pnpm exec tsc --noEmit` if affected. Run `git diff --check` and inspect changed/untracked files for leaked fixtures/media. Record failures and environmental blockers honestly.

## Risks / Notes

Mocking only the new result enum can leave the parser broken. Overly permissive FakeProcess behavior can hide process leaks; assert calls and lifecycle ownership. Permission tests based on host chmod alone are unreliable on Windows or privileged runners.

## Rollback / Safety

Test-only changes need no runtime rollback. Restore only demonstrably broken test harness edits; retain regression cases and report implementation failures rather than suppressing them. No user data or real container state is needed.

## Files likely affected

`worker/test_worker.py`, small sanitized fixtures under `worker/` if justified, and focused API compatibility tests where needed. Avoid production edits except an approved minimal testability correction returned to the owning task. Sol maps gaps, Terra adds tests, Luna assesses assertions and actual coverage rather than test counts alone.
