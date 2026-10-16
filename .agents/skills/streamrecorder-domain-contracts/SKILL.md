---
name: streamrecorder-domain-contracts
description: Trace and validate Creator, WatchTarget, Stream, and Recording compatibility when changing domain models, legacy Streamer/Session mappings, JSON adapters, API domain DTOs, or frontend domain types in StreamRecorder.
---

# Domain contracts

## Purpose and use

Preserve domain meaning across representations. Use for entity/identity or legacy mapping changes; use API/frontend procedures as well when transport or UI behavior changes.

## Read first

- [Project instructions](../../../.github/instructions/project.instructions.md) and the concrete task.
- [Domain model](../../../api/src/streams/domain.model.ts), [repository](../../../api/src/streams/streams.repository.ts), and [API JSON adapters](../../../api/src/streams/json-compatibility.adapters.ts).
- [Worker JSON adapters](../../../worker/json_adapters.py), [frontend types](../../../frontend/lib/types.ts), relevant [DTOs](../../../api/src/streams/dto/), and [API contract tests](../../../api/src/streams/test/).

## Procedure

1. Build a small before/after contract map from current code: entity, identifier, relationship, state, physical storage, API shape, and consumers. Confirm actual values and defaults before assuming them; distinguish phase-specific behavior from future design.
2. Keep Creator (who), WatchTarget (configuration), Stream (broadcast occurrence), and Recording (capture attempt) separate. Determine how stable IDs and Creator legacy names are resolved in the active phase. Check collisions, renames, and historical references rather than assuming names are durable IDs.
3. Trace `session_id`, `watch_target_id`, legacy `channel_id`, and optional `stream_id` through reads and writes in both languages. Check whether a link is actually persisted. Preserve unknown historical links instead of inferring them from timestamps or filenames.
4. Compare state vocabulary and serialization at every boundary. A state rename needs explicit task authority and migration; probe classifications are separate from persisted recording states.
5. Trace `enabled`, preferred `quality`, authoritative URL, and `recording_subdir` through validation, defaults, PATCH omission/clear behavior, persistence, Worker reload, and frontend types. Distinguish runtime quality fallback from persisted preference.
6. Exercise one Creator with multiple differently configured WatchTargets. Editing, disabling, or deleting one must leave siblings unchanged and preserve historical meaning. Check modern API and legacy Streamer/Session compatibility separately, preventing legacy field leakage into modern payloads.

## Safety / invariants

Do not freeze today's JSON limitations into future requirements. Follow the current task and persistence decisions for deliberate evolution; do not fabricate old relationships or silently reassign history. Contract review does not authorize an authority cutover or unrelated schema/UI redesign.

## Validation and expected result

Select adapter round trips, missing/default versus malformed-input cases, sibling independence, ID/history preservation, and modern/legacy response tests from current suites. Add relevant API/frontend or PostgreSQL validation when those boundaries change, without requiring another skill to run. Return the contract map, tested compatibility scenarios, command results, intentional changes, and unresolved inconsistencies with file/symbol evidence.
