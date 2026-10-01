# Wave 04 — Worker Correction and Improvement

Planning only. All eight tasks start as `planned`; no implementation or validation result is implied by this wave. Read `.github/instructions/project.instructions.md`, `.github/instructions/mvp.instructions.md`, and the current `.github/agents/` workflow before executing a task. The instructions directory is plural in this repository.

## Objective

Make the existing polling/JSON MVP Worker trustworthy, observable, testable, and operationally correct without replacing its architecture.

## Repository Analysis

Planning baseline: branch `master`; initial `git status --short` contained only `?? .env`. That pre-existing file was not read or modified. Inspection began through the VS Code MCP bridge at `http://127.0.0.1:3333/sse`. Waves 01, 02, and 03 exist; no prior Wave 04 or numbering conflict was found.

Repository visibility note: the existing `.gitignore` ignores `.github/`, including prior wave files and this wave. The tasks exist on disk for the agent pipeline but do not appear as ordinary untracked files. Planning does not change ignore rules or stage files. During planning an external `.gitignore` edit added `.env`; that change was preserved and is not part of this deliverable.

- `worker/worker.py` runs Python polling with a 60-second default interval and a 20-second probe timeout. `is_live()` collapses non-zero exit, empty output, missing streams, and exceptions into `False`; the polling loop then marks offline and may finalize a Stream.
- Active recordings are skipped before probing. A completed/failed Recording can leave an active Stream awaiting another probe. That case is especially vulnerable to false finalization.
- `worker/requirements.txt` pins `streamlink==7.1.3`; `worker/Dockerfile` uses `python:3.12-slim`, installs Streamlink and FFmpeg, and runs Worker UID/GID 1000:1000.
- The supplied incident evidence reports Twitch `cisco_the_vile` live with `enabled: true`, repeated checking logs, empty `streams.json`, and no Recording. Container Streamlink 7.1.3 returned `Unable to open URL: https://gql.twitch.tv/gql (type object 'Urllib3UtilUrlPercentReOverride' has no attribute 'sub')`. This runtime failure must never count as offline. It was supplied evidence, not re-executed during planning.
- Worker ignores `enabled`. The API domain has it, but `WatchTargetJsonAdapter.toDomain()` hardcodes true and `fromDomain()` omits it. Current POST defaults true; PATCH only changes `recording_subdir`.
- API and Worker share the host runtime-data bind mount at `/data`; Worker also mounts `/recordings`. API runs as `node`; its actual numeric identity must be verified in the built image rather than inferred from its username.
- Python persistence uses same-directory `mkstemp`, flush/fsync, and `os.replace`; API uses a temporary file, sync, and rename. Image-layer ownership does not establish host bind-mount permissions. The supplied temporary-file permission denial is confirmed incident evidence; its exact host/runtime cause remains for 04.4 to establish.
- Locks are process-local. There is no cross-process lock, queue, Redis, or PostgreSQL in the active Compose architecture.
- `sessions.json` intentionally translates legacy `channel_id` to domain `watch_target_id` and does not persist `stream_id`. `streams.json` is broadcast history; `channels_status.json` is an operational snapshot.
- Existing `scripts/docker-integration-smoke.mjs` and `pnpm test:smoke` provide isolated stack coverage, but write an offline status directly. They do not prove probe classification or media capture.
- Capture currently invokes Streamlink with an `.mp4` output filename; there is no explicit FFmpeg command in `start_recording()`. Installed FFmpeg and an extension alone do not prove an MP4 container. Task 04.7 must report actual media-format evidence.

## Tasks / Dependencies

| Task | Responsibility | Depends on |
| --- | --- | --- |
| [04.1](01-streamlink-runtime-upgrade.task.md) | Pin and validate a compatible current Streamlink runtime | None within this wave |
| [04.2](02-probe-result-model.task.md) | Distinguish LIVE, OFFLINE, and ERROR; protect Stream lifecycle | 04.1 |
| [04.3](03-worker-probe-observability.task.md) | Safe probe, startup, and recording diagnostics | 04.2 |
| [04.4](04-runtime-directory-permissions.task.md) | Non-root shared-directory access and atomic persistence | None within this wave |
| [04.5](05-watch-target-enabled-enforcement.task.md) | Honor enabled state without interrupting existing recordings | 04.2, 04.3 |
| [04.6](06-worker-regression-tests.task.md) | Complete deterministic failure/lifecycle regression matrix | 04.1–04.5 |
| [04.7](07-worker-docker-integration-validation.task.md) | Container smoke coverage and separate real-live validation | 04.1–04.6 |
| [04.8](08-worker-documentation-runbook.task.md) | Publish the verified operational workflow | 04.1–04.7 |

Main chain: `04.1 -> 04.2 -> 04.3 -> 04.5 -> 04.6 -> 04.7 -> 04.8`. Task 04.4 may proceed independently after repository analysis, but must join before 04.6/04.7. Coordinate overlapping edits to `worker.py`, adapters, and tests; this is not permission for concurrent uncontrolled edits.

## Shared Compatibility / Non-Goals

Keep Creator, WatchTarget, Stream, and Recording distinct. Preserve Wave 02 identities, legacy endpoints, JSON formats, path override precedence, quality/subdirectory behavior, and Twitch/YouTube/Kick support. Only the optional `enabled` compatibility correction in 04.5 is a planned watchlist-format extension. Probe results are not new Recording-state enum values. Do not add `Stream.channel_id` or persist new Recording relationships as a side effect.

No Redis, BullMQ, RabbitMQ, PostgreSQL, cloud upload (Google Drive/Dropbox/OneDrive), retention jobs, authentication redesign, major frontend redesign, Kubernetes, distributed Workers, event-platform replacement for polling, or public media endpoints/catalog/indexing/redistribution. Keep recordings private/user-controlled, avoid unnecessary permanent server storage, and retain a low-cost single-developer architecture. Broader future diagrams in project instructions do not expand this explicitly scoped wave.

## Workflow / Evidence

Use `Coordinator -> Sol -> Terra -> Coordinator validation -> Luna -> Coordinator`, including the existing pre-Luna validation gate and `AGENT_RESULT` protocol. Coordinator performs the current branch pre-flight before later implementation. No branch or task lifecycle changes are part of planning.

Coordinator sets `planned -> implement` before Terra starts. Terra returns implementation to Coordinator; green validation advances to `review/QA`. Luna `PASS` leads to final Coordinator validation and `user-approve`; `CHANGES_REQUIRED` leads to `fixing`. Preserve the three-review limit and `coordinator-review` escalation. Only existing user-acceptance rules (user commit or explicit authorization of the next task) permit `done`. No automatic commit/push.

Every task reports commands as passed, failed, blocked, or not run, with evidence and changed-file inventory. Do not claim real-platform recovery from mocked tests. Missing Docker/network/controlled-live access is an environmental limitation, not permission to weaken deterministic tests. All commands in these plans are for later execution.

## Wave Acceptance Criteria

- [ ] A current compatible, explicitly pinned Streamlink runtime is verified inside the rebuilt Worker.
- [ ] Controlled Twitch evidence shows the supplied probe failure is resolved.
- [ ] Probe failures are distinguishable from OFFLINE and do not end an active Stream.
- [ ] Safe diagnostics reveal failures and actual runtime configuration.
- [ ] Disabled WatchTargets cause no new probes or recordings; existing captures follow the documented non-destructive policy.
- [ ] API/Worker shared persistence and Worker media output work under documented non-root identities.
- [ ] Atomic JSON replacement remains intact; no false transactional/distributed-lock guarantee is made.
- [ ] Deterministic Worker and Docker regression gates pass without live platforms.
- [ ] A short controlled live exercise demonstrates WatchTarget -> detection -> Stream -> Recording -> media output, with MP4 format checked rather than inferred from its suffix.
- [ ] Updated runbooks distinguish container liveness from successful detection.
- [ ] No public video indexing, public content serving, or future infrastructure is introduced.

Real-live validation is optional for automated test execution. If it cannot be performed, record it as not run/blocked and leave the corresponding operational acceptance unchecked; do not claim complete incident recovery or full wave acceptance.
