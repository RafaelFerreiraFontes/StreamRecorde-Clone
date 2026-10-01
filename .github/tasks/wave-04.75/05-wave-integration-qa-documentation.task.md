---
name: Wave 04.75.5 Integration QA and Documentation
wave: 04.75
order: 05
depends_on:
  - 01-watch-target-quality-editing.task.md
  - 02-watch-target-url-and-open-stream.task.md
  - 03-adaptive-quality-selection.task.md
  - 04-worker-probe-recording-integration.task.md
status: done
---

# Wave 04.75.5 — Integration QA and Documentation

## Status

done

## Validation Evidence

- Desktop Docker Compose config: PASS
- Docker build (api, frontend, worker): PASS
- Runtime services (api, frontend, worker): PASS (healthy)
- Streamlink runtime version: 8.6.1
- Runtime smoke check: PASS (API, frontend proxy, and worker running cleanly with disabled test target)
- Synced notebook `.env`: NOT USED (tested in isolated temporary worktree and environment)

## Context

Wave 04.5 established API/frontend PATCH and React component coverage; Wave 04 established Worker JSON compatibility, deterministic probe classifications, safe logs, Docker smoke, and enabled-state behavior. Wave 04.75 crosses all three services while retaining the shared JSON boundary.

## Problem

Individually passing edits can still regress JSON round trips, proxy behavior, Docker composition, lifecycle, external-link safety, or the configured-versus-effective quality distinction.

## Objective

Provide final cross-cutting validation and concise operator/developer documentation for the completed Wave 04.75 changes without expanding product scope.

## Scope

### In Scope

- Run/repair only test and documentation gaps directly caused by 04.75.1–04.75.4.
- Cross-service regression matrix, typechecks/builds/lint/config verification, isolated Docker fixture verification, and documentation updates where behavior changed.

### Out of Scope

- New functionality, platform/live-stream testing, production data edits, migrations, commits/pushes, auth changes, public sharing/download, or unrelated refactors.

## Current Architecture

- API: Nest tests under `api/src/streams/test`, `WatchTargetJsonAdapter`, and `PATCH /watch-targets/:id`.
- Frontend: Next proxy, `frontend/app/watch-targets/page.tsx`, and `frontend/tests/wave-04.5-components.test.tsx` using `node:test`, `tsx`, jsdom, and Testing Library.
- Worker: unittest-compatible `worker/test_worker.py`, JSON adapters, fake subprocesses, and local-poll lifecycle.
- Compose: `compose.yml`; worker Dockerfile installs pinned `streamlink==8.6.1`; repository smoke fixture lives under `scripts/docker-smoke/`.

## Required Changes

- Consolidate a requirement-to-test matrix for quality PATCH, URL PATCH, adapter round trips, UI rollback/refetch, safe external links, adaptive selection examples, LIVE/OFFLINE/ERROR, disabled behavior, and Stream/Recording lifecycle.
- Keep all external/process behavior mocked in automated Worker tests. Extend the isolated fake-Streamlink Docker smoke only if the existing fixture can demonstrate the fallback flow without real URLs or media; otherwise document the bounded limitation rather than adding live coverage.
- Update project/Worker/API/frontend documentation only where needed to state: quality is a preference; effective fallback is operational/log-only unless an existing compatible field was used; URL is authoritative; Open Stream is client-side external navigation; no public recordings/fetch proxy is added.
- Verify Docker image/version facts against the configured worker image, not the developer host binary. Preserve API read-only recordings mount and frontend API proxy.
- Inspect final diff/status for scope creep, test fixtures/logs with URLs/tokens, generated artifacts, staged files, commits, or pushes. Do not introduce another testing framework if current tools suffice.

## Acceptance Criteria

- [ ] Focused API, frontend, and Worker tests cover every Wave 04.75 behavioral contract.
- [ ] Component tests retain Wave 04.5 setup and validate loading/error/reconciliation/link safety.
- [ ] Worker tests prove all required fallback rows, no false OFFLINE, ERROR distinction, disabled guard, unchanged preference, and valid Stream/Recording lifecycle without real platforms.
- [ ] API JSON compatibility preserves Creator/WatchTarget and Stream/Recording separation, IDs, URL, quality, enabled, and recording_subdir.
- [ ] Builds/typechecks/compose validation pass, or an objective pre-existing/environment blocker is recorded without masking it.
- [ ] Documentation makes no claim that fallback overwrites user preference or that recordings are public.

## Automated Tests

- `api/src/streams/test/stream.controller.spec.ts` and `usability.spec.ts` (or focused existing suites) for PATCH/round trips.
- `frontend/tests/wave-04.5-components.test.tsx` additions, run through the existing `pnpm test` script.
- `worker/test_worker.py` pure selector and lifecycle integration tests with mocked Streamlink mapping/processes.
- Existing Docker smoke only with isolated fixtures; no Twitch/YouTube/Kick network dependency.

## Manual Verification

In a local stack with disposable JSON data: edit quality and URL, reload, inspect safe external-link attributes in browser tools, use an isolated fake Streamlink fallback fixture, and confirm configuration preference remains unchanged. Do not expose recordings, enter credentials, or use live channels.

## Verification Commands

- `cd api; pnpm test -- --runInBand`
- `cd api; pnpm exec tsc --noEmit`
- `cd api; pnpm build`
- `cd frontend; pnpm test`
- `cd frontend; pnpm typecheck`
- `cd frontend; pnpm build`
- `pnpm exec eslint frontend/app frontend/components frontend/lib`
- `python -m pytest worker/test_worker.py`
- `python -m unittest discover -s worker -p test_worker.py`
- `docker compose config --quiet`
- `pnpm test:smoke`
- `git diff --check`

## Dependencies

Requires 04.75.1, 04.75.2, 04.75.3, and 04.75.4 to be implemented and individually validated first.

## Risks / Regression Risks

Host Streamlink versions can differ from the pinned container. Broadening quality options without adapter tests can break legacy values. UI tests can pass while external links omit required `rel`. Docker smoke cannot prove a playable real-platform recording.

## Rollback Considerations

No migration. Documentation and tests must accurately state any unsupported rollback caveat; no fixture/media/log artifact may be retained as user data.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator performs the final scope and Git audit. Sol maps test evidence to contracts. Terra fixes only wave-caused gaps. Luna checks security boundaries, compatibility, and claims in documentation before human approval.
