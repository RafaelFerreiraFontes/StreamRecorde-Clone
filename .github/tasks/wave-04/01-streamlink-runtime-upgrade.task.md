---
name: Wave 04.1 Streamlink Runtime Upgrade and Twitch Probe Recovery
wave: 04
order: 01
depends_on: []
status: done
---

# 04.1 — Streamlink Runtime Upgrade and Twitch Probe Recovery

## Context

The supplied Worker-container reproduction reports Streamlink 7.1.3 and a Twitch GraphQL failure: `type object 'Urllib3UtilUrlPercentReOverride' has no attribute 'sub'`. Repository inspection confirms `streamlink==7.1.3` and `python:3.12-slim`. This is a runtime/plugin failure, not proof of an offline channel; all supplied targets were enabled.

## Objective

Select, explicitly pin, rebuild, and validate a current stable Streamlink release compatible with the existing Worker. Version selection and dependency edits happen during later implementation, not this planning wave.

## Dependencies / Preconditions

No Wave 04 dependency. Read [wave context and workflow](README.md), Worker code/tests, Dockerfile, and requirements. Use an isolated runtime/output directory for execution; do not interrupt an active user recording to rebuild a container.

## Scope

Streamlink pin, directly necessary compatibility adjustments, reproducible image installation, and evidence of Twitch probe recovery. Inspect current capture flags for compatibility with the chosen release.

## Out of Scope

Unrelated package/base-image upgrades, broad transitive pinning, a different resolver, probe-model implementation (04.2), logging redesign (04.3), queues/databases/cloud integrations, frontend work, public content serving, commits, and pushes.

## Required Changes

- Sol must consult official Streamlink release notes/package metadata at implementation time, recording release number, source links, check date, Python requirement, and rationale. Do not assume a version is current from this plan or use an unbounded `latest` dependency.
- Confirm support for Python 3.12 and the existing Twitch/YouTube/Kick plugins and CLI arguments. Prefer keeping Python 3.12; report an actual incompatibility before expanding base-image scope.
- Terra changes only the explicit Streamlink pin and proven necessary compatibility details. Record any transitive dependency changes produced by that upgrade; do not manually upgrade unrelated dependencies to hide the error.
- Rebuild the Worker image and recreate its container. Verify the executable inside the running container, not only local pip or the requirements text. A plain `docker compose restart worker` is insufficient.
- Save sanitized command outcomes for a controlled live Twitch probe and its available stream keys. The supplied channel is incident context, not a permanent fixture or guaranteed-live test target.
- Preserve the original version/image reference as rollback evidence. Task 04.7 performs final integrated validation after the other corrections.

## Compatibility Requirements

Preserve WatchTarget quality selection, output paths, JSON adapters/contracts, Stream/Recording separation, and polling. No access-control bypass or credential requirement should be introduced. See [shared boundaries](README.md#shared-compatibility--non-goals).

## Acceptance Criteria

- [ ] Official release/Python compatibility evidence justifies one explicit supported stable pin.
- [ ] Rebuilt container `streamlink --version` exactly matches the selected pin; `python -m pip check` passes.
- [ ] Existing Worker tests pass and relevant CLI capture flags remain supported.
- [ ] A controlled live Twitch `--json` probe resolves a non-empty streams object without the supplied GraphQL/runtime exception, or the operational check is explicitly left pending with its environmental reason.
- [ ] No automated test requires Twitch or any other real platform to be live.
- [ ] Diff contains no unrelated upgrades or changes to domain persistence.

## Verification

Later, from the repository root, using an isolated Compose project and test bind mounts:

```sh
docker compose build worker
docker compose up -d worker
docker compose exec worker python --version
docker compose exec worker streamlink --version
docker compose exec worker python -m pip check
python -m pytest worker/test_worker.py
git diff --check
```

Separately, during a short controlled live window:

```sh
docker compose exec worker streamlink --json <controlled-live-url>
```

Replace the placeholder before execution; do not publish raw signed media URLs from JSON. Record build/recreation evidence and distinguish deterministic PASS from external validation not run. Missing live access does not justify a false recovery claim.

## Risks / Notes

Stale containers, changed plugin output, transitive incompatibility, platform outages, and channels going offline during testing can mislead diagnosis. The exact lower-level dependency incompatibility is not yet isolated. Update only from evidence. The `.mp4` filename alone does not verify the capture format; final media validation belongs to 04.7.

## Rollback / Safety

Retain runtime JSON/media untouched. If the upgrade regresses, restore the prior pin/image in an isolated environment and report that it still has the known Twitch failure; rollback is not incident resolution. Do not erase state or restart normal recordings automatically.

## Files likely affected

`worker/requirements.txt`; `worker/Dockerfile` only if required for verified compatibility; focused CLI-compatibility tests in `worker/test_worker.py` if necessary. Final user-facing documentation belongs to 04.8. Sol plans, Terra implements, and Luna checks actual image/version evidence under the existing workflow.
