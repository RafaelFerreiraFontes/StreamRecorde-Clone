---
name: Wave 04.3 Worker Probe Observability and Diagnostics
wave: 04
order: 03
depends_on:
  - 02-probe-result-model.task.md
status: done
---

# 04.3 — Worker Probe Observability and Diagnostics

## Context

Normal logs show checking without a clear result. `is_live()` currently logs a raw URL on exceptions; `drain_stderr()` forwards raw Streamlink lines despite its no-secrets docstring. Invalid watchlist warnings also dump the whole entry. These paths can undermine otherwise sanitized probe logs.

## Objective

Make live detection and runtime failures diagnosable with concise, consistent, safe events.

## Dependencies / Preconditions

04.2 supplies explicit probe results and bounded diagnostic context. Read [wave context](README.md), all relevant Worker logging paths, process start/finish handling, and existing stderr tests.

## Scope

Probe events, startup runtime summary, recording lifecycle events, and narrowly scoped sanitization of connected Worker diagnostics. Reuse Python logging; no observability service is needed.

## Out of Scope

Metrics platform, dashboards, full stdout/JSON dumps, persistent probe-history storage, log collection infrastructure, frontend redesign, domain/schema changes, or other future architecture.

## Required Changes

- Emit consistent channel/WatchTarget-scoped events: `Checking status...`, `Probe: LIVE`, `Probe: OFFLINE`, `Probe: ERROR (category=..., returncode=...)`, `Live detected!`, `Recording started`, and `Recording finished (outcome=...)`. Include target ID when needed to distinguish multiple configurations for one channel.
- Record available return code, timeout duration, exception type, and bounded sanitized stderr/error-envelope summary. Distinguish absent return code from exit 0. Do not label failed launch/persistence as a successful recording start.
- Once per startup report Worker started, actual installed Streamlink version, polling interval, resolved CONFIG_DIR/path overrides, and OUTPUT_DIR. Use a bounded version command; a missing/broken executable must produce actionable failure rather than a false ready message.
- Redact before truncation; never dump credentials, OAuth tokens, authorization headers, cookies, URL userinfo, signed query values, raw stream URLs, full watchlist entries, command lines, or exception text that may contain them. Prefer safe identifiers and allowlisted fields; suppress arbitrary URL details when reliable redaction is uncertain.
- Apply the same safety boundary to probe exceptions and the existing recording stderr drain. Keep draining stderr even when a line is suppressed to avoid blocking the media process. Bound each diagnostic line and normalize control characters to avoid log injection.
- Use INFO for concise lifecycle/results and WARNING/ERROR for failures; raw debug payloads are not required. Keep normal polling volume modest. Any repeated-error suppression must retain first failure and recovery visibility without introducing a scheduler.
- Permission/startup failures from 04.4 must fit the same diagnostic vocabulary. No secrets may be required to interpret a failure.

## Compatibility Requirements

Logging must not change probe classification, recording outcomes, timeout/shutdown behavior, JSON schemas, or API status enums. Preserve useful recognizable checking/live/finished messages and the existing Docker log transport.

## Acceptance Criteria

- [ ] Each LIVE/OFFLINE/ERROR result has a clear, bounded diagnostic event with a safe target identity.
- [ ] Failure logs include available return code/category, sanitized stderr, timeout, and exception type.
- [ ] Startup logs identify actual Streamlink version, poll interval, and effective runtime/output paths without dumping the environment.
- [ ] Recording start is logged after actual launch; completion reports its actual outcome.
- [ ] Synthetic token/cookie/userinfo/signed-URL fixtures never appear in captured logs, including existing stderr and exception paths.
- [ ] Output truncation/control-character tests pass; stderr is still drained and shutdown remains bounded.

## Verification

Use `assertLogs`/captured logging with mocked version/probe/process failures. Verify content and absence of secrets, not exact timestamps. Exercise empty/large stderr, multiline exceptions, timeout output, JSON error messages, and secret-bearing URLs. Run `python -m pytest worker/test_worker.py` and `git diff --check`; inspect `docker compose logs --tail=100 worker` later in the isolated 04.7 scenario.

## Risks / Notes

Logging arbitrary third-party text is a leak risk even at debug level. Sanitizing only the new probe helper leaves existing recording logs exposed. Avoid an expensive generic logging framework or a credential-specific regex that assumes all secret names are known.

## Rollback / Safety

No data migration. Preserve the sanitizer if event wording is rolled back; do not restore raw credential-bearing logging. Do not commit captured production diagnostics.

## Files likely affected

`worker/worker.py`, `worker/test_worker.py`; only a small shared Worker diagnostic helper if justified. Sol defines safe fields, Terra implements/tests them, Luna checks both diagnostic usefulness and leak resistance.
