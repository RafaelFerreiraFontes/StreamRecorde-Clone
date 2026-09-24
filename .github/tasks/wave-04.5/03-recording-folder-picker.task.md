---
status: done
---
# Wave 04.5 - Recording directory picker

## Context
Create and inline edit use text inputs.

## Problem
Typing server directory names is inconvenient.

## Objective
Reuse directory browser for create/edit selection.

## Scope
Frontend, API, JSON compatibility/persistence where required, tests, documentation and minimal API read-only recordings mount.

## Out of scope
Worker implementation/tests, lifecycle, Streamlink, FFmpeg, cloud, retention, migrations, desktop APIs, commits and pushes.

## Dependencies
04.5.2

## Implementation requirements
Keyboard modal, breadcrumbs, current selection, cancel/select, loading/empty/error states; manual input retained. Empty root selection retains channel fallback and must be explained.

## Security constraints
No arbitrary host paths, shell execution, file contents or file URLs. All browsing stays under configured recordings root. Preserve unrelated changes and JSON contracts.

## Acceptance criteria
Nested selection returns relative path; manual input works; no client filesystem APIs.

## Verification commands
Run relevant commands from the stated component directory:
- API: pnpm test --runInBand; pnpm exec tsc --noEmit; pnpm build
- Frontend: pnpm test; pnpm typecheck; pnpm build
- Root: pnpm exec eslint frontend/app frontend/components frontend/lib; docker compose config --quiet; git diff --check

## Implementation summary
`RecordingBrowser` now accepts an optional `initialPath`. The inline edit picker
supplies the current `recording_subdir`, so it opens at that safe logical relative
path. Create mode continues to open at the root. Missing or unavailable initial
paths keep the browser error/retry UI and the root breadcrumb remains available.
Manual entry remains available, and saving still uses the existing WatchTarget
PATCH route.

## Changed files
- `frontend/components/recording-browser.tsx`
- `frontend/app/watch-targets/page.tsx`
- `frontend/tests/wave-04.5-components.test.tsx`

## Acceptance criteria and evidence
- Tests assert edit-path initialization, nested relative selection, breadcrumbs,
  manual edit, and PATCH payload `{ "recording_subdir": "..." }`.
- Tests cover loading, empty, retryable error, Escape, and focus restoration.

## Commands and results
- `tsx --test tests/wave-04.5-components.test.tsx`: passed, 4 tests.
- `tsx --test tests/*.test.mjs tests/*.test.tsx`: passed, 15 tests.
- `tsc --noEmit`: passed.
- `next build`: passed.

## Review notes and known limitations
The API remains authoritative for path validation. The picker does not create
folders or access the client filesystem. Coordinator validation and Luna review
passed. The user approved the local Wave 04.5 commits, and this task is complete.
