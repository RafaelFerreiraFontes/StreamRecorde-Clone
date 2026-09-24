---
status: done
---
# Wave 04.5 - Integration and documentation

## Context
Changes are limited to API/frontend and minimal Docker setup.

## Problem
Compatibility and security need repeatable evidence.

## Objective
Add HTTP/persistence/security and frontend tests; update docs.

## Scope
Frontend, API, JSON compatibility/persistence where required, tests, documentation and minimal API read-only recordings mount.

## Out of scope
Worker implementation/tests, lifecycle, Streamlink, FFmpeg, cloud, retention, migrations, desktop APIs, commits and pushes.

## Dependencies
04.5.1, 04.5.2, 04.5.3

## Implementation requirements
Use isolated fixtures; report manual cases A-H honestly; inspect Worker invariance.

## Security constraints
No arbitrary host paths, shell execution, file contents or file URLs. All browsing stays under configured recordings root. Preserve unrelated changes and JSON contracts.

## Acceptance criteria
Checks pass or concrete environmental limitations recorded; final report includes commands, status and commit boundaries.

## Verification commands
Run relevant commands from the stated component directory:
- API: pnpm test --runInBand; pnpm exec tsc --noEmit; pnpm build
- Frontend: pnpm test; pnpm typecheck; pnpm build
- Root: pnpm exec eslint frontend/app frontend/components frontend/lib; docker compose config --quiet; git diff --check

## Implementation summary
Added behavior-focused React DOM coverage under the existing `node:test` approach
using `tsx`, `jsdom`, and `@testing-library/react`. Added root `jiti` so ESLint 10
can load the existing TypeScript flat config reproducibly.

## Changed files
- `frontend/package.json`
- `frontend/pnpm-lock.yaml`
- `frontend/tests/wave-04.5-components.test.tsx`
- `package.json`
- `pnpm-lock.yaml`
- all Wave 04.5 task records

## Acceptance criteria and evidence
- Component tests assert meaningful Wave behavior: enabled mutation states and
	rollback; picker path/navigation/select/manual-save/accessibility states; and
	recording location states/retry.
- No Worker diff was introduced.
- `next-env.d.ts` was not modified.

## Commands and results
- `pnpm add -D jiti`: passed at repository root.
- `pnpm exec eslint frontend/app frontend/components frontend/lib`: config loads;
	only pre-existing `frontend/lib/api.ts` `preserve-caught-error` remains.
- `tsx --test tests/*.test.mjs tests/*.test.tsx`: passed, 15 tests.
- `tsc --noEmit`: passed.
- `next build`: passed.
- `pnpm test --runInBand` in `api`: passed, 4 suites and 92 tests.

## Review notes and known limitations
The standard frontend `pnpm` scripts initially hit the environment's ignored
`esbuild` build-policy error, so validation used the installed package binaries.
The lockfile was updated with `pnpm install --ignore-scripts`; no application
configuration was changed to hide that environment policy. Coordinator validation
and Luna review passed. The user approved the local Wave 04.5 commits, and this
task is complete.

## Final commit structure
- `1921344` - `feat(api,frontend): make watch target enabled editable`
- `59d2136` - `feat(api): add safe recordings filesystem browser`
- `816b630` - `feat(frontend): add recording browser and folder picker`
- Closing commit: `test(docs): complete wave 04.5 validation and documentation`
