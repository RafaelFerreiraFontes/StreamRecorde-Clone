---
name: Wave 04.75.3 Adaptive Quality Selection
wave: 04.75
order: 03
status: done
critical: true
---

# Wave 04.75.3 — Adaptive Quality Selection

## Status

done

## Context

`worker/requirements.txt` pins the deployed image to `streamlink==8.6.1`. Today `worker/worker.py` probes once with `streamlink --json <url>` but discards the returned `streams` mapping after deciding LIVE; `start_recording()` then invokes `streamlink ... <url> <entry.quality> -o <file>`. Thus the configured preference is exact at capture time and an unavailable variant can make the child fail. Local inspection found a host Streamlink 7.3.0, which is not evidence for the container pin; implementation must validate the 8.6.1 image/API.

## Problem

A playable LIVE mapping can be detected but a configured preference such as `1080p60` can fail recording when only `1080p` or `720p60` exists.

## Objective

Create a deterministic, unit-tested Worker-local selection contract that turns a WatchTarget preferred quality and one discovered Streamlink mapping into a selected playable variant. Preserve `WatchTarget.quality` unchanged.

## Scope

### In Scope

- Parse/normalize only the Streamlink variant names actually returned by the existing one-shot JSON probe.
- Pure deterministic selection helper/result (including selected name and fallback reason) and focused unit tests.
- Safe diagnostic contract for preferred/available/selected names without URLs/secrets.

### Out of Scope

- API/frontend preference edits, persistence schema additions, selecting by repeated Streamlink processes, platform calls, changing Stream/Recording domain separation, or integration wiring covered by 04.75.4.

## Current Architecture

- Probe parser/classifier: `ProbeResult`, `classify_probe_result()`, and `is_live()` in `worker/worker.py`. JSON currently proves only non-empty `streams` means LIVE.
- Exact capture argument: `start_recording()` builds `streamlink ... url, quality, -o` in the same file.
- Existing tests mock `subprocess.run` and use JSON `{"streams": {"best": {}}}` fixtures in `worker/test_worker.py`.
- Current DTO/UI option values appear in `api/src/streams/dto/watch-target.dto.ts` and `frontend/lib/types.ts`; they include aliases (`best`, `worst`, `source`, `chunked`) and named variants.

## Required Changes

- Inspect Streamlink 8.6.1 inside the configured Docker image (or its installed package metadata/help) to freeze the real `--json` stream-key shape and alias semantics. Do not infer those semantics from the local 7.3.0 executable or assume aliases are independent streams.
- Change the probe boundary/design so the validated `streams` mapping is available once for local selection without a second or sequential quality-discovery command. Preserve safe `ProbeResult` classification: valid non-empty mapping is LIVE; no playable mapping remains OFFLINE only under the existing exact rules; malformed/error responses remain ERROR.
- Build a pure helper that accepts the configured preference plus validated available stream names (and any safe metadata the real mapping provides), returns either a reproducible selected playable name and reason, or an explicit no-playable result. It must not mutate configuration.
- For parseable resolution/FPS names, use this ordered policy: exact match; same resolution nearest viable FPS; greatest suitable lower resolution, preferring the higher/closer FPS within that resolution; continue descending; if no equal/lower candidate exists, choose the nearest higher playable candidate; finally choose the sole/remaining playable stream instead of abandoning capture. Define deterministic tie-breakers, including unparseable names, from observed Streamlink 8.6.1 data.
- Preserve supported aliases: `best` must use Streamlink’s correct best semantics; `source` must remain source semantics when available; investigate `worst`/`chunked` and aliases supplied by plugins. A requested alias unavailable in a non-empty mapping must fall back deterministically to a playable real variant rather than being treated as offline. Do not fabricate `best` or `source` if the mapping cannot resolve it.
- Emit a bounded sanitized selection record using safe identifiers only: preferred, available names (bounded/count-limited), selected, and reason such as `exact_match`, `preferred_quality_unavailable`, or `no_equal_or_lower_quality_available`. Never include target URL, stream URL, command line, cookies, token-bearing keys, or raw payload.

## Behavioral Contract

| Preferred | Available | Selected |
| --- | --- | --- |
| `1080p60` | `1080p60`, `1080p`, `720p60` | `1080p60` |
| `1080p60` | `1080p`, `720p60` | `1080p` |
| `1080p60` | `720p60`, `720p` | `720p60` |
| `1080p60` | `720p`, `480p` | `720p` |
| `720p60` | `720p`, `480p` | `720p` |
| `480p` | `480p` | `480p` |
| `480p` | `720p` | `720p` |
| `best` | multiple valid streams | Streamlink-correct best selection |
| unavailable preference | one playable stream | that playable stream |
| any preference | no playable streams | no selected variant; never fake fallback |

## Acceptance Criteria

- [ ] Exact preference always wins when present.
- [ ] Same-resolution fallback precedes lower-resolution fallback; lower resolution favors the appropriate higher/closest FPS.
- [ ] A higher-only playable option is selected rather than cancelling capture.
- [ ] `best`/`source` behavior follows verified Streamlink 8.6.1 semantics.
- [ ] No-playable differs explicitly from preferred-unavailable and preserves the Wave 04 error/offline boundary.
- [ ] The helper is deterministic, testable without real platforms, uses one discovered mapping, and never mutates `WatchTarget.quality`.

## Automated Tests

- Add table-driven pure-helper tests for every table row and the ten required cases from the Wave brief, plus duplicate aliases, parseable FPS ties, unparseable/plugin-specific names, aliases, and no-playable.
- Mock Streamlink JSON mapping/probe results; never contact Twitch/YouTube/Kick or launch a real media process.
- Assert safe logs contain preference/available/selection/reason where allowed and omit URL/token/cookie/stream URL data.
- Add regression assertions that configuration still says `1080p60` after a selected `720p60` fallback.

## Manual Verification

In a disposable Worker container using Streamlink 8.6.1, inspect representative `--json` keys from an authorized public fixture without retaining or publishing URLs, then compare selection logs against the table.

## Verification Commands

- `docker compose build worker`
- `docker compose run --rm worker streamlink --version`
- `python -m pytest worker/test_worker.py`
- `python -m unittest discover -s worker -p test_worker.py`
- `git diff --check`

## Dependencies

This is the critical logic prerequisite for 04.75.4. It may share only a small Worker-local helper/result with that task.

## Risks / Regression Risks

Streamlink aliases/plugins can differ from simple `NNNp` names. Sorting string names lexicographically is incorrect. Re-running Streamlink to try each candidate increases load and race risk, and treating a missing preference as OFFLINE regresses Wave 04.

## Rollback Considerations

No JSON migration. Rolling back must not overwrite the configured preference or persisted Stream/Recording history; acknowledge that it restores exact-quality capture failure risk.

## Notes for Coordinator / Sol / Terra / Luna

Sol must record the 8.6.1 facts used to settle aliases/tie-breakers. Terra keeps the selector pure and independently testable. Luna must reject a hidden `best` shortcut, repeated probes, or a preference mutation.
