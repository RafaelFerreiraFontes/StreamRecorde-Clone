---
name: Wave 02.4 Stream Detection Model
description: Introduce the minimum useful Stream concept between live detection and Recording without changing the Streamlink polling strategy.
wave: 02
order: 04
depends_on:
  - 01-domain-model-definition.task.md
  - 02-creator-watch-target-extraction.task.md
  - 03-recording-extraction.task.md
  - 03a-recording-compatibility-hardening.task.md
status: done
---

# Wave 02.4 — Stream Detection Model

## Goal

Introduce the smallest useful `Stream` model for an actual detected live broadcast, separate from Creator, WatchTarget, and Recording, while preserving the current Worker polling and Streamlink detection behavior.

## Why This Task Exists

The current application moves directly from a monitored watchlist entry to a recording session. A Stream boundary is useful only if it represents a real broadcast occurrence and clarifies behavior when detection and capture outcomes differ. It must not exist merely to satisfy a diagram.

## Current State

- Streamlink probes each configured URL and reports whether streams are available.
- The Worker starts capture immediately after a positive detection.
- `channels_status.json` is keyed by the current WatchTarget ID and describes that target's current operational state. Its approximate responsibility is `WatchTarget ID -> current runtime state`; it is not automatically Stream persistence.
- A status entry containing `channel_name`, `platform`, and `state` does not identify one concrete broadcast occurrence or distinguish Monday's broadcast from Tuesday's broadcast for the same WatchTarget.
- Current channel status and Session/Recording data partially describe a broadcast but do not model a Stream independently.
- A failed Recording can leave `active_recordings` and be created again on the next positive poll while the same broadcast is still live. Without Stream identity, those attempts cannot be related to the same occurrence.
- Tasks 02 and 03 should have established WatchTarget and Recording relationships; their actual repository state must be inspected.
- JSON remains active persistence.

## Domain Identity Decision

- `Stream.watch_target_id` is the sole relationship from the new Stream domain model to WatchTarget.
- `Stream.channel_id` must not exist in the new domain because it duplicates `watch_target_id` without adding a distinct meaning.
- Legacy `channel_id` fields remain unchanged where they are part of an existing persistence or API contract. For example, `sessions.json.channel_id` remains a compatibility field and maps to/from domain `watch_target_id` at the legacy boundary.
- Do not reuse `channel_id` for a platform-native Twitch, YouTube, or Kick identifier. If that requirement appears later, it must use an explicit name such as `platform_channel_id` and be handled as a future decision.

## Dependencies / Preconditions

- Task 01 defines the minimum Stream boundary.
- Task 02 establishes the actual Creator/WatchTarget relationship.
- Task 03 establishes the actual Recording lifecycle and compatibility contracts.
- Existing polling, platform support, and lifecycle tests are understood.

## In Scope

- Determine the exact event that creates a Stream under current behavior.
- Generate and preserve a stable `stream_id` for one detected broadcast occurrence.
- Define how repeated positive polls are recognized as the same live occurrence rather than new Streams.
- Define when a Stream ends and what minimum timestamps/state are currently meaningful.
- Relate Stream to the WatchTarget that detected it and Recording created from it.
- Define behavior when a broadcast exists but its Recording fails.
- Define behavior when the same WatchTarget detects a later broadcast.
- Support the minimum justified one-to-many relationship in which multiple Recording attempts may belong to the same Stream, for example an errored attempt followed by a successful retry while the broadcast remains live.
- Treat `channels_status.json` as runtime/compatibility state unless analysis proves a minimal additional responsibility; do not assume it is the Stream store or turn it into a database substitute.
- Remove the redundant domain `Stream.channel_id` while preserving legacy `channel_id <-> watch_target_id` translation at compatibility boundaries.
- Add only currently used metadata, identifiers, and compatibility mapping.
- Preserve Worker polling, Streamlink detection, and Twitch/YouTube/Kick support.
- Add deterministic tests for detection-to-Stream and Stream-to-Recording behavior.

## Out of Scope

- Official Twitch, YouTube, or Kick APIs, webhooks, platform metadata enrichment, or internet-dependent tests.
- Replacing polling or Streamlink.
- Speculative titles, thumbnails, categories, viewers, external metadata, or a universal platform SDK.
- PostgreSQL, Prisma, TypeORM, Redis, BullMQ, RabbitMQ, OAuth, cloud storage, WebSocket, SSE, frontend, authentication, invitations, retention, cron, public streaming, or public indexing.
- Microservices, Kubernetes, event sourcing, CQRS, generic repositories, or unrelated refactors.

## Sol Responsibilities

- Validate the current results of Tasks 01–03 rather than assuming their planned shapes.
- Trace the precise detection, capture start, capture finish, failure, and subsequent poll behavior.
- Define the minimum source and lifecycle of `stream_id`, including creation, repeated-poll reuse, termination, and a new identity for a later broadcast.
- Analyze `channels_status.json` as current WatchTarget runtime/compatibility state and decide the smallest JSON-compatible representation for Stream without assuming that file equals Stream persistence.
- Define how `WatchTarget -> Stream -> Recording` is represented and how a failed Recording followed by a retry remains related to the same Stream.
- Determine whether and where multiple Recordings for one Stream have an immediate consumer, without adding speculative metadata.
- Prove that each proposed Stream field has a current consumer or validation purpose.
- Define creation and termination rules, ID relationships, and JSON compatibility.
- Clarify whether a failed Recording leaves a valid ended Stream and how later broadcasts are distinguished.
- Plan deterministic tests with mocked Streamlink, subprocess, filesystem, and time.
- Return `BLOCKED` if stream identity cannot be inferred safely without a meaningful product decision.

## Terra Responsibilities

- Implement only the approved minimal Stream boundary.
- Keep Stream distinct from both WatchTarget configuration and Recording execution.
- Use `watch_target_id` for the Stream-to-WatchTarget relationship and remove `channel_id` from the new Stream domain model.
- Preserve legacy `channel_id` fields only inside their compatibility formats and adapters.
- Preserve current polling intervals, process behavior, platform support, and lifecycle semantics.
- Avoid storing unused future metadata.
- Ensure a later detected broadcast does not accidentally reuse a prior ended Stream.
- Keep JSON persistence active and compatible with the migration strategy already established.
- Run focused new tests plus all relevant Wave 01 and Tasks 02–03 regression tests.

## Luna Responsibilities

- Verify that Stream represents an actual broadcast occurrence with a concrete current purpose.
- Confirm `WatchTarget -> detected Stream -> Recording` is clear in code and data.
- Confirm repeated polling reuses the same active Stream, a later broadcast receives a different `stream_id`, and multiple Recording attempts can remain related to one Stream.
- Confirm `channels_status.json` remains runtime/compatibility state rather than being mislabeled as a complete Stream entity.
- Confirm the new Stream domain contains `watch_target_id` and does not retain redundant `channel_id` naming.
- Check normal end, recording failure after detection, later broadcast detection, and repeated polls during one live occurrence.
- Reject Stream objects that merely duplicate WatchTarget, Recording, or channel status.
- Reject speculative metadata, polling redesign, internet dependencies, and scope creep.
- Review JSON compatibility, lifecycle consistency, imports, dead code, and tests.

## Acceptance Criteria

- [ ] The exact creation and termination conditions for Stream are documented and implemented.
- [ ] Stream is related to the detecting WatchTarget.
- [ ] `Stream.watch_target_id` is the sole WatchTarget relationship and redundant domain `Stream.channel_id` has been removed.
- [ ] Legacy `channel_id` fields remain compatible and are translated only at legacy boundaries.
- [ ] Each broadcast occurrence receives a stable `stream_id` that survives repeated polling while that occurrence remains active.
- [ ] Recording is related to Stream without becoming the same concept.
- [ ] Multiple Recording attempts can relate to the same Stream when capture fails and is retried during the same live occurrence.
- [ ] A Recording failure does not erase the fact that a Stream was detected.
- [ ] A later broadcast can be distinguished from an earlier ended Stream.
- [ ] Repeated polling during one current broadcast does not create uncontrolled duplicate Streams or Recordings.
- [ ] `channels_status.json` is treated as WatchTarget runtime/compatibility state and is not assumed to be complete Stream persistence.
- [ ] Every Stream field has a current justified use.
- [ ] Worker polling and Streamlink detection remain unchanged in strategy.
- [ ] Twitch, YouTube, and Kick remain supported.
- [ ] Tests are deterministic and require no internet or real live broadcast.
- [ ] JSON remains active persistence.
- [ ] Luna returns `PASS` before Coordinator reports `READY_FOR_COMMIT` to the human.

## Stop Conditions

- Stop with `BLOCKED` if current detection cannot identify broadcast boundaries without a product-level identity rule.
- Stop if the model requires official platform APIs or speculative external metadata.
- Stop and refine if the change would replace polling, redesign capture execution, or begin persistence replacement.
- Keep Stream identity, lifecycle, compatibility mapping, repeated polling, Recording relationships, and their tests in this task; do not create 04a or 04b subtasks at this time.
- Do not modify Task 05 or Task 06 automatically.

## Expected Result

A minimal, behavior-backed Stream concept connecting WatchTarget detection to Recording while keeping Streamlink polling and JSON persistence intact.

## Next Task

`05-json-compatibility-adapters.task.md`
