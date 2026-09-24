---
status: done
---
# Wave 04.5 - Editable WatchTarget enabled

## Context
Adapters preserve booleans; omitted enabled defaults to true. Wave 04 Worker gates new probes.

## Problem
PATCH only supports recording_subdir; table lacks toggle.

## Objective
Extend PATCH atomically; add optimistic accessible row switch.

## Scope
Frontend, API, JSON compatibility/persistence where required, tests, documentation and minimal API read-only recordings mount.

## Out of scope
Worker implementation/tests, lifecycle, Streamlink, FFmpeg, cloud, retention, migrations, desktop APIs, commits and pushes.

## Dependencies
None

## Implementation requirements
Strict boolean validation; preserve unrelated fields and siblings; rollback failures; reconcile saves.

## Security constraints
No arbitrary host paths, shell execution, file contents or file URLs. All browsing stays under configured recordings root. Preserve unrelated changes and JSON contracts.

## Acceptance criteria
True/false round trips, legacy defaults, independent updates.

## Verification commands
Run relevant commands from the stated component directory:
- API: pnpm test --runInBand; pnpm exec tsc --noEmit; pnpm build
- Frontend: pnpm test; pnpm typecheck; pnpm build
- Root: pnpm exec eslint frontend/app frontend/components frontend/lib; docker compose config --quiet; git diff --check

## Implementation summary
The WatchTarget enabled control is an accessible per-row switch with an optimistic
pending value. It PATCHes only `{ "enabled": boolean }`, disables while saving,
refreshes the dashboard on success, and restores the server-rendered value while
showing an error on failure. The control was extracted as a small component to
make its rendered behavior testable without changing API contracts.

## Changed files
- `frontend/app/watch-targets/page.tsx`
- `frontend/tests/wave-04.5-components.test.tsx`
- `frontend/package.json`

## Acceptance criteria and evidence
- The true/false PATCH body, optimistic disabled state, success reconciliation,
	and error rollback are asserted in the component test.
- API usability and security coverage remains unchanged and passed: `pnpm test --runInBand`
	in `api` (4 suites, 92 tests).

## Commands and results
- `tsx --test tests/wave-04.5-components.test.tsx`: passed, 4 tests.
- `pnpm test`: passed, 15 tests. The configured command explicitly includes
	`tests/*.test.mjs` and `tests/*.test.tsx`.
- `tsc --noEmit`: passed.
- `next build`: passed.

## Review notes and known limitations
No Worker files were modified. The root ESLint command now loads its TypeScript
configuration after adding `jiti`; its only remaining finding is the pre-existing
`frontend/lib/api.ts` `preserve-caught-error` reported from commit `a3597d2`.
Coordinator validation and Luna review passed. The user approved the local
Wave 04.5 commits, and this task is complete.
