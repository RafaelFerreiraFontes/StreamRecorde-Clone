---
status: done
---
# Wave 04.5 - Safe recording location browser

## Context
Recordings store output_file; API lacks recordings mount.

## Problem
No application recording location browser.

## Objective
Add shared sandbox service, directory and recording-ID location routes, location dialog.

## Scope
Frontend, API, JSON compatibility/persistence where required, tests, documentation and minimal API read-only recordings mount.

## Out of scope
Worker implementation/tests, lifecycle, Streamlink, FFmpeg, cloud, retention, migrations, desktop APIs, commits and pushes.

## Dependencies
04.5.1

## Implementation requirements
Canonical containment; reject unsafe input before IO; exclude hidden entries and symlinks; sanitize errors; missing-file states; read-only Compose mount.

## Security constraints
No arbitrary host paths, shell execution, file contents or file URLs. All browsing stays under configured recordings root. Preserve unrelated changes and JSON contracts.

## Acceptance criteria
Traversal rejected; existing and missing files handled with safe relative metadata.

## Verification commands
Run relevant commands from the stated component directory:
- API: pnpm test --runInBand; pnpm exec tsc --noEmit; pnpm build
- Frontend: pnpm test; pnpm typecheck; pnpm build
- Root: pnpm exec eslint frontend/app frontend/components frontend/lib; docker compose config --quiet; git diff --check

## Implementation summary
The shared recording browser remains read-only and server-backed. Component tests
exercise its loading, retryable error, empty-directory, breadcrumbs, relative
directory navigation, Escape handling, focus restoration, and recording-location
file-not-found state.

## Changed files
- `frontend/tests/wave-04.5-components.test.tsx`

## Acceptance criteria and evidence
- Browser tests use the real component and API client, not source-string checks.
- Existing API traversal and location security coverage passed unchanged with
	`pnpm test --runInBand` in `api` (4 suites, 92 tests).

## Commands and results
- `tsx --test tests/wave-04.5-components.test.tsx`: passed, 4 tests.
- `tsx --test tests/*.test.mjs tests/*.test.tsx`: passed, 15 tests.
- `tsc --noEmit`: passed.
- `next build`: passed.

## Review notes and known limitations
No native filesystem APIs, download behavior, folder creation, or Worker changes
were introduced. Coordinator validation and Luna review passed. The user approved
the local Wave 04.5 commits, and this task is complete.
