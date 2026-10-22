# Repository Linting and Formatting

## Setup

Use Node.js 25.9 or newer, pnpm 11.20, and Python 3.12 or newer. The production Worker targets Python 3.12; Ruff targets py312. Root, API and frontend have independent manifests and lockfiles. Install each package explicitly:

```sh
pnpm install --frozen-lockfile
pnpm --dir api install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
python -m venv .venv
```

On Windows, install development Ruff with:

```powershell
.venv\Scripts\python.exe -m pip install -r worker/requirements-dev.txt
```

On Linux/macOS:

```sh
.venv/bin/python -m pip install -r worker/requirements-dev.txt
```

Ruff 0.15.6 is pinned in worker/requirements-dev.txt and is not installed in the production image. The runner selects the repository .venv on Windows or POSIX, then falls back to python. Set RUFF_PYTHON to a different interpreter if needed. Missing tools, a different Ruff version, diagnostics and subprocess failures produce a nonzero exit.

Use the selected Node executable on PATH before invoking pnpm; do not lower package engines to accommodate an older global runtime. Do not replace an existing environment merely to prepare these tools.

## Commands

Run from the repository root:

```sh
pnpm lint
pnpm lint:check
pnpm format:check
pnpm check
```

These commands check all four areas without writing source. ESLint uses --max-warnings 0. Formatting and lint corrections are separate, explicitly mutating commands:

```sh
pnpm lint:fix
pnpm format:write
```

The format alias also writes files. Fixes are bounded to the inventory below; Ruff unsafe fixes are not enabled. Inspect semantic changes and rerun the relevant tests after fixes.

For a single area:

```sh
node scripts/lint-repository.mjs lint api
node scripts/lint-repository.mjs format:check frontend
node scripts/lint-repository.mjs lint:fix worker
node scripts/lint-repository.mjs format:write scripts
```

Areas are scripts, api, frontend and worker. API/frontend package lint, lint:check, lint:fix, format:check, format and format:write scripts call the same runner. Individual tool execution is possible, but the aggregate commands are the repository acceptance gates.

## Coverage

| Area                            | Lint owner                                                                                                              | Formatting owner and bounded inventory                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Root/Node scripts               | Root ESLint 10 flat config, Node globals                                                                                | Shared Prettier 3.8.1: scripts JS/MJS/CJS, root ESLint config, package.json, .prettierrc.json and this guide                       |
| API                             | API ESLint 9: type-aware src/\*_/_.ts, including tests and CLIs; untyped rules for scripts and top-level tooling config | Shared Prettier: api/src, api/scripts, optional api/test TS/JS/MJS/JSON and explicitly listed package/compiler/Nest/Drizzle config |
| Frontend                        | ESLint 9 with the Next 16 flat Core Web Vitals and TypeScript configurations, including Hooks rules                     | Shared Prettier: app/components/lib/tests TS/TSX/JS/MJS/CSS/JSON and explicitly listed tooling/package/compiler config             |
| Worker and Python smoke fixture | Ruff check, selected E/W/F/I/UP/B/SIM/C4/RUF rules                                                                      | Ruff format: worker Python files and scripts/docker-smoke/streamlink-fixture.py                                                    |

The runner is the exact inventory. Root lint does not re-lint API/frontend files through the root config. API projectService is limited to the source TypeScript project; tooling scripts do not require a fictitious TypeScript project.

Private runtime-data, recordings, outbox/checkpoints, .env files, .git, dependencies, virtual environments, caches and generated outputs are outside the bounded source inventory. Applied SQL migrations, Drizzle migration snapshots and lockfiles are not formatted. Lockfiles change only through deliberate dependency installation.

Shell, Dockerfiles and YAML are not linted by ESLint/Ruff or reformatted by the aggregate. Other Markdown documentation is outside formatting scope. CSS/JSON in the listed source/config inventory receive formatting only. Legacy web/ is outside this task's four maintained areas. Do not describe these exclusions as passing lint coverage.

## Rule and Compatibility Decisions

Prettier has one root policy: double quotes, trailing commas, width 100, two spaces, semicolons and LF. The API-local Prettier override was removed. eslint-config-prettier disables formatting conflicts; Prettier checks run separately instead of producing duplicate ESLint formatting diagnostics.

API type-aware rules include floating promises, unsafe arguments, unused variables, consistent type imports and optional chains. The existing no-explicit-any exception is retained. prefer-nullish-coalescing was evaluated but not enabled because existing empty-string/zero fallbacks are intentional; do not replace || with ?? without checking behavior.

Nest classes used as runtime injection tokens must remain value imports when decorator metadata requires them. Typechecking alone does not prove DI works: exercise application modules through the integration/bootstrap tests and Docker smoke.

Exact ASCII C0/DEL security regular expressions use narrowly documented line exceptions to no-control-regex. Do not broaden character rejection or disable the rule globally. The API atomic-write tests use a mutable default fs/promises import so Jest spies can intercept native operations; converting it to a namespace import breaks those failure-injection tests.

Ruff uses Python 3.12, width 100, double quotes, spaces and LF. E501 is excluded because formatting does not guarantee every long string/comment fits. Import ordering reflects direct Worker execution and package-style test imports. Review subprocess, context-manager, exception, retry and outbox transformations manually.

## Regression and Agent Gates

Before independent review, run the aggregate read-only checks and the affected test/typecheck/build suites. For this repository-wide cleanup the required matrix includes API Jest, frontend tests, both production builds, Worker unittest/pytest, isolated database foundation tests and synthetic JSON/bridge Docker smoke.

Select a supported Python for database integration helpers as well as for direct Worker tests:

```powershell
$env:PYTHON = (Resolve-Path .venv/Scripts/python.exe).Path
node scripts/test-db-foundation.mjs
```

On POSIX, use PYTHON pointing to the supported virtual-environment interpreter. The default global Python may be older than the Worker target. The smoke container uses Python 3.12 independently. Database and smoke harnesses must use disposable projects/volumes and fake Streamlink, never normal runtime-data or media.

Record tool versions, selected-rule counts, test results and limitations in the task validation report. Hash tracked source/config and task-created files before and after read-only checks; compare a second explicit formatting pass to prove idempotence. Do not commit automatically or mark a required blocked check as passed.

## Historical Diagnostic Baseline

Task 05.5 recorded 436 selected API diagnostics, 83 Worker diagnostics, 7 frontend diagnostics and 6 root-script diagnostics before remediation. The old API ESLint/Prettier integration additionally reported 1,612 formatting diagnostics. The original root invocation could not run until stale dependency links from an older checkout were repaired; selected-rule counts were captured with the repaired tooling.

These counts describe the historical inventory, not a waiver or a current test result. See the [task](.github/tasks/wave-05.5/05.5-repository-linting-code-readability.task.md) for the final evidence and acceptance state.
