---
name: streamrecorder-worker-lifecycle
description: Diagnose and validate StreamRecorder Worker probe classification, polling, Stream reuse, Recording retries, Streamlink/FFmpeg processes, quality selection, terminal persistence, restart/reload, and shutdown when changing or reviewing worker behavior.
---

# Worker lifecycle

## Purpose and use

Trace a Worker failure or change across observation, execution, and persistence without conflating their outcomes.

## Read first

- [Worker README](../../../worker/README.md), then the relevant helpers in [worker.py](../../../worker/worker.py), [JSON adapters](../../../worker/json_adapters.py), and [current tests](../../../worker/test_worker.py).
- [Project instructions](../../../.github/instructions/project.instructions.md), the concrete task, and current persistence decisions when the storage boundary changes.

## Procedure

1. Reconstruct the actual flow: probe -> LIVE / OFFLINE / ERROR -> Stream creation/reuse -> Recording attempt -> media child -> terminal state -> later polling/retry. Locate each transition and its persistence failure path before proposing a fix.
2. Reproduce with deterministic probe/process fixtures. A timeout, malformed response, or uncertain Streamlink failure must remain ERROR, never false OFFLINE. Only verified broadcast termination may finalize its Stream according to current guards.
3. Check repeated LIVE polls reuse the broadcast's Stream; retries may create separate Recording attempts on that Stream; a later broadcast gets a new identity. Distinguish capture failure from broadcast ending.
4. Inspect enabled checks, config reload, and immediate pre-launch refresh. Exercise removed/disabled/invalid targets and changed URLs. Verify runtime quality selection uses available variants without rewriting the target preference.
5. Trace process ownership from launch through monitoring, stderr draining, interruption, timeout, termination, and `wait`/reaping. Check shutdown and launch/persistence failure paths for surviving children or stuck active state.
6. Follow initial and terminal writes, pending persistence retries, and reload/restart recovery. Confirm what is durable versus only in memory, including missing legacy Stream links. If changing persistence, consult its current authority/recovery design; do not create a second primary store.
7. Assess media handling from actual subprocess commands. Avoid unnecessary memory buffering, intermediate disk copies, and transcoding. Verify any claimed FFmpeg finalization is really invoked.

## Safety / invariants

Never delete valid local media to hide a metadata failure or falsely report durable completion. Automated tests must not use real channels, user runtime-data, or user recordings. Fake Streamlink output and an `.mp4` suffix do not prove playable MP4. Any authorized live-media exercise is separate evidence.

## Validation and expected result

Run focused cases, then required affected-suite checks. Supported Worker checks include `python -m unittest test_worker` or `python -m pytest test_worker.py -q` from `worker/`, plus relevant syntax checks from the development guide. For container interaction, combine the Docker workflow and inspect the existing isolated smoke before running it. Return transition evidence, reproduction, smallest correction if authorized, process/persistence recovery results, and explicit unverified media claims.
