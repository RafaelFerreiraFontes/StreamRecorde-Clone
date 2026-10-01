---
name: Wave 04.7 Docker Worker Integration and Operational Validation
wave: 04
order: 07
depends_on:
  - 01-streamlink-runtime-upgrade.task.md
  - 02-probe-result-model.task.md
  - 03-worker-probe-observability.task.md
  - 04-runtime-directory-permissions.task.md
  - 05-watch-target-enabled-enforcement.task.md
  - 06-worker-regression-tests.task.md
status: done
---

# 04.7 — Docker Worker Integration and Operational Validation

## Context

The Wave 03 smoke harness already isolates a Compose project, ports, runtime data, and recordings, and checks API/frontend/Worker sharing and shutdown. It directly writes an offline status, uses an invalid URL, and does not validate actual probe classification or media children. A running container is not proof of working detection.

## Objective

Verify the corrected Worker in real non-root containers with deterministic automated fixtures, and provide separate short controlled real-platform evidence when available.

## Dependencies / Preconditions

04.1–04.6 must pass their relevant implementation gates, especially 04.4 permissions. Read [wave context](README.md), `scripts/docker-integration-smoke.mjs`, root `package.json`, Compose, runtime/output contracts, and reports. Require Docker/Compose availability for container checks; do not substitute mock unit results for container evidence.

## Scope

Extend the existing smoke harness with isolated Worker scenarios, ownership/persistence checks, and a separate optional real-live procedure. Reuse `pnpm test:smoke`; do not create an unrelated parallel test system.

## Out of Scope

Real-platform CI dependencies, long recordings, load testing, permanent test services, production fake-probe switches, deleting user runtime/media, unrelated API/frontend work, queue/database/cloud features, and public media access.

## Required Changes

### A. Deterministic Automated Docker Smoke Testing

- Retain current BFF/API/shared-file/restart checks. Replace reliance on an invalid URL or manually written offline status as proof of detection with explicit deterministic LIVE/OFFLINE/ERROR fixtures exercising the actual polling loop and result parser.
- Use test-only mounted executables/fixtures or an isolated test entrypoint to substitute Streamlink behavior and controlled capture children. Do not add a production environment flag that can fake live detection. Run the real installed `streamlink --version` separately before applying any executable substitution.
- Exercise LIVE -> one Stream/Recording/output artifact; repeat with no duplicate; capture failure -> ERROR preserves Stream -> LIVE retry reuses it; confirmed OFFLINE -> later LIVE creates a new Stream. Test disabled targets with zero probe/capture calls and the 04.5 disable-during-recording policy.
- Verify required JSON through both container and host/API views, valid data after atomic replacement, actual UID/GID, writable output, and fresh/existing bind mounts. Include a deliberately unwritable fixture that fails clearly without corrupting old JSON.
- Preserve `sessions.json` compatibility: it contains `channel_id`, not a durable `stream_id`. Assert in-memory association at the Worker test boundary where needed; do not change schemas merely to simplify integration assertions.
- Confirm version diagnostics, sanitized error logs, restart persistence, and SIGTERM cleanup with a controlled active child; assert no test-created orphan media process. A fake capture artifact is evidence of lifecycle/output plumbing, not real playable video.
- Use a dedicated Compose project, unique/verified-free resources, short test-only polling interval, temporary bind mounts, bounded waits, and explicit cleanup ownership. Existing fixed `streamrecorder-smoke` resources must be checked for collision or made unique. Preserve normal stack/data before and after, including non-default paths selected by configuration; never dump secret-bearing Compose environment output into reports.
- Runtime scenarios must not contact Twitch/YouTube/Kick or depend on internet. Image/package downloads during build may need network and must be reported separately. No test-created data is committed.

### B. Optional Real-Platform Operational Validation

- Use a user-controlled/authorized live channel and isolated runtime/output paths. Record time, chosen runtime version, and sanitized probe outcome; the incident channel is not a mandatory fixture.
- Verify a short WatchTarget -> live detection -> `streams.json` entry -> Recording in `sessions.json` -> growing media file under `/recordings` flow. Check logs/API visibility and only record enough media to establish the path.
- Check the actual container format with installed `ffprobe`, not only `.mp4` suffix or nonzero size. Current code launches Streamlink with `-o ...mp4` but does not explicitly invoke FFmpeg. If output is transport stream rather than MP4, report a concrete capture-format gap to Coordinator and return the minimum correction plan to the owning implementation scope; do not silently rename media, claim MP4 success, or add a broad transcoding pipeline.
- End the controlled source naturally where possible and observe Recording completion plus a subsequent confirmed-offline probe. For an intentionally interrupted test, report the existing interrupted/error result instead of claiming a successful broadcast-end test. Do not stop unrelated recordings.
- Capture failure/recovery evidence without raw signed URLs, tokens, cookies, or media content. State PASS/FAIL/NOT RUN separately from the automated gate. Unavailable live access does not fail deterministic CI, but leaves operational recovery acceptance pending.

## Compatibility Requirements

Preserve normal Compose architecture, non-root execution, JSON identities, private output, existing smoke coverage, and Windows/PowerShell support. No new public media route. Permissions tests must use the identities and provisioning contract selected in 04.4.

## Acceptance Criteria

- [ ] Automated smoke passes without a real platform/network probe and exercises actual Worker polling/result classification.
- [ ] Real container version matches the explicit pin; API/Worker can use shared data after replacement and Worker can write recordings.
- [ ] LIVE/OFFLINE/ERROR, disabled configuration, identity reuse, duplicate prevention, and persistence failure cases are verified.
- [ ] Shutdown with a controlled active child leaves no test-owned orphan processes.
- [ ] Test resources are isolated and cleanup cannot affect normal data/containers, including configured non-default paths.
- [ ] Real-live procedure and its result are separately documented; no simulated output is represented as recovered Twitch/MP4 evidence.
- [ ] If performed, the controlled run demonstrates Stream, Recording, growing output, and actual MP4 format without the supplied Twitch exception; otherwise those checks remain explicitly pending.

## Verification

Required commands for later execution (the harness supplies its own project/mount environment):

```sh
docker compose build worker
docker compose up -d worker
docker compose exec worker streamlink --version
docker compose exec worker sh -c 'ls -la /data'
docker compose exec worker sh -c 'ls -la /recordings'
docker compose exec worker id
docker compose exec api id
docker compose logs --tail=100 worker
pnpm test:smoke
git diff --check
```

Do not run the unqualified startup commands against active normal recordings; apply the isolated Compose project/environment selected by the harness. For the optional real-live exercise, replace placeholders before execution:

```sh
docker compose exec worker streamlink --json <controlled-live-url>
docker compose exec worker streamlink --loglevel debug --json <controlled-live-url>
docker compose exec worker ffprobe -v error -show_entries format=format_name,duration,size -of json <controlled-output-path>
```

Record versions, sanitized outcomes, assertion/exit-code evidence, and which container scenarios ran. Do not require a long capture.

## Risks / Notes

Docker unavailable, external image downloads, occupied ports/projects, mount ACL behavior, and missing live access are different environmental failures. A container that merely stays running or a harness that directly injects status cannot establish live-detection correctness. Separate actual media-container compatibility from the filename convention.

## Rollback / Safety

Clean up only resources created and verified as owned by this test; no prune, reset, broad deletion, or `down -v`. Restore normal configuration only if the test changed it (prefer not to). Keep test output short-lived and private. Report any unsafe cleanup or state mismatch instead of hiding it.

## Files likely affected

`scripts/docker-integration-smoke.mjs`, narrowly scoped fixture/override files under `scripts/`, root `package.json` only if needed to expose a focused scenario. `compose.yml` only for a demonstrated minimal integration correction through Coordinator. Final runbook updates belong to 04.8. Sol plans isolation, Terra executes/builds fixtures, Luna checks real container evidence and the separation of automated and operational claims.
