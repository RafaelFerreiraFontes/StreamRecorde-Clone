---
name: streamrecorder-code-quality
description: Apply and validate the StreamRecorder repository's ESLint, Prettier and Ruff policies for API, Frontend, Worker and Node scripts. Use during implementation, refactoring, review, and pre-commit validation to keep changes formatted, lint-clean, behavior-preserving and reproducible.
---

# StreamRecorder Code Quality

## 1. Purpose and Applicability

Use for implementation, refactoring, independent review, and pre-commit validation affecting API, Frontend, Worker, or root Node scripts. Keep static cleanup scoped and behavior-preserving. Documentation-only work uses document/scope checks unless the task explicitly requires source quality gates.

## 2. Required Files and Source of Truth

- [Repository linting guide](../../../README-LINTING.md)
- [Repository runner](../../../scripts/lint-repository.mjs)
- [Root package](../../../package.json)
- [API package](../../../api/package.json)
- [Frontend package](../../../frontend/package.json)
- [Worker Ruff configuration](../../../worker/ruff.toml)
- [Worker development dependencies](../../../worker/requirements-dev.txt)

Read the relevant files before selecting commands. Their bounded inventory and checked-in policies are authoritative; this skill does not authorize changing them to hide failures.

## 3. Supported Runtime Versions

Require Node.js >= 25.9, pnpm 11.20, Python >= 3.12, and Ruff 0.15.6. Worker source must remain compatible with Python 3.12. A missing or incorrect runtime is an environment issue, never permission to alter `engines`, downgrade dependencies, replace an existing environment, or mutate the global environment.

## 4. Component Selection

Select `scripts`, `api`, `frontend`, `worker`, or `all` according to the actual diff and runner inventory. Prefer focused component checks while implementing; run required repository gates before independent review. Do not broaden cleanup beyond authorized files.

## 5. Read-Only Validation

Run from the repository root:

```sh
pnpm lint
pnpm lint:check
pnpm format:check
pnpm check
node scripts/lint-repository.mjs lint <area>
node scripts/lint-repository.mjs format:check <area>
pnpm --dir api exec tsc --noEmit
pnpm --dir frontend run typecheck
```

`lint` and `lint:check` are equivalent read-only lint gates; `check` combines lint and formatting checks. Replace `<area>` with a supported component. Select required checks rather than redundantly running every alias. Typechecks supplement lint; neither formatting nor typechecking proves behavior.

## 6. Explicit Corrections

Only deliberate remediation may use these mutating commands:

```sh
pnpm lint:fix
pnpm format:write
pnpm format
node scripts/lint-repository.mjs lint:fix <area>
node scripts/lint-repository.mjs format:write <area>
```

Never present these as read-only verification gates. Prefer the smallest affected area. Always inspect semantic diffs after autofix, rerun affected tests, and rerun read-only gates. Do not accept unrelated formatting churn.

## 7. Behavioral and Semantic Safety

### API (NestJS / TypeScript)

Preserve runtime DI and decorator metadata (`emitDecoratorMetadata` / `experimentalDecorators`). Classes used as injection tokens require value imports, not `import type`. Handle Promises carefully under `no-floating-promises`; do not silently discard errors. Preserve `||` versus `??` fallback semantics, HTTP contracts, and exception shapes. Static cleanup is not permission to refactor persistence, authentication, or Worker contracts.

### Frontend (Next.js / React / TSX)

Preserve React Hooks and `exhaustive-deps` semantics; avoid stale closures and unintended effect reruns. Preserve the authentication generation/cancellation model (`AbortController` plus generation token), prevent cross-account snapshot restoration, and retain proxy security checks. Passing the formatter does not prove that the UI works; run relevant component/proxy tests.

#### Rule Compatibility and Adoption Matrix

| Decision              | Policy                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Already enabled       | Next Core Web Vitals, TypeScript and Hooks recommendations; explicitly retain frontend `no-explicit-any`, `jsx-key` and `prefer-const` as errors.             |
| Adopted               | TS/TSX `no-unused-vars` ignores underscore-prefixed args, vars and caught errors; `consistent-type-imports` prefers separate type imports.                    |
| Adopted               | `jsx-no-leaked-render` permits ternary/coerce strategies; `self-closing-comp` covers components and HTML; `no-array-index-key` requires stable identity keys. |
| Adopted               | `eqeqeq` uses `smart`; `no-console` warns except for `warn`/`error`, and zero-warning gates reject other calls.                                               |
| Deferred              | `no-nested-ternary`: avoids broad refactoring of readable JSX and state ternaries under `--max-warnings 0`.                                                   |
| Deferred              | Frontend type-aware `no-floating-promises`, `await-thenable` and `prefer-optional-chain`; do not enable project service incidentally.                         |
| Rejected              | API `prefer-nullish-coalescing`: preserve intentional logical OR fallback behavior.                                                                           |
| Adopted               | Ruff `combine-as-imports = true` and `docstring-code-format = true`; preserve the remaining selected rules and format settings.                               |
| Adopted clarification | Prettier ignores generated output, private runtime/media, environments, lockfiles and applied migrations, without excluding maintained source directories.    |

Keep frontend global ignores first, Next recommendations next, scoped TS/TSX rules and JS/MJS tooling/test overrides after them, and Prettier last. The additional React rules do not apply to Node tooling/test scripts.

#### 3.5 Optional Evaluation: Type-Aware Frontend Rules

The hardening evaluation with `projectService: true` produced 27 floating-promise errors and no await-thenable or optional-chain findings. Resolving test callback and application promise lifecycles needs its own semantic scope; do not silence findings with indiscriminate `void`. Defer all three frontend type-aware rules: optional-chain alone has no current findings and does not justify TypeScript project loading or coupling lint to tsconfig membership and generated Next.js types. API typed linting remains unchanged. See the repository guide for the full adoption matrix.

### Worker (Python 3.12 / Ruff 0.15.6)

Preserve Python 3.12 target compatibility, Streamlink/FFmpeg subprocess ownership, interruption/shutdown handling, durable outbox/checkpoint recovery, retry semantics, event acknowledgments, and local media retention on persistence failure. Never run live streams as lint validation. Avoid unsafe Ruff fixes unless justified and authorized; use deterministic tests for changed behavior.

Ruff combines aliased imports and formats recognized code examples in docstrings. These options do not authorize changing capture behavior or widening the lint selection.

### Root Scripts (Node JS/MJS/CJS)

Preserve Docker smoke harnesses, database integration scripts, migration tooling, exit-code propagation, test cleanup ownership, cross-platform paths, and non-destructive fixtures. YAML, Dockerfiles, shell scripts, and applied SQL migrations are excluded from the bounded formatter inventory; their exclusion does not remove task-specific validation obligations.

Prettier excludes `.next/`, `api/dist/`, `coverage/`, `.venv/`, `runtime-data/`, `recordings/`, `*.lock`, `pnpm-lock.yaml` and `api/drizzle/migrations/`. The runner still formats maintained scripts/frontend/API files and README-LINTING.md; Worker Python uses Ruff. Other Markdown, including this skill, is outside the aggregate inventory: explicitly check edited documentation with the root Prettier configuration.

## 8. Integration with Agent Responsibilities

- Coordinator selects relevant skills in preflight, verifies task/README synchronization, enforces objective validation and quality gates before Luna, and stops at human approval.
- Delegate Coordinator applies the same responsibilities in the reserve workflow.
- Sol identifies required read-only gates and runtime-sensitive transformations while planning; it does not implement or replace Coordinator validation.
- Terra uses focused tests, makes deliberate scoped fixes, inspects semantic diffs, reruns affected checks, reports actual evidence, and preserves the three-attempt debugging budget. Entering `fixing` requires synchronized task frontmatter and Wave README metadata.
- Luna independently inspects the final diff, executed gates, semantic safety, acceptance evidence, and task/README synchronization. It does not edit implementation or mark tasks `done`.

Include concise skill references in handoffs, not entire skill bodies. Load domain/contextual skills only for affected boundaries.

## 9. Failure Classification

Use `CODE_FAILURE` for lint/format diagnostics or semantic regressions introduced by edits. Use `ENVIRONMENT_FAILURE` for missing or incompatible runtimes/tools, unavailable dependencies, permissions, or services; report the exact blocker and validation impact. Never weaken ESLint, Prettier, or Ruff rules or add bulk suppressions to pass. Do not change unrelated configuration to conceal environment failures.

## 10. Expected Validation Evidence

Report exact read-only commands, working directory, exit codes, and zero diagnostics for successful gates. Include `git diff --check`, affected behavior-test results when applicable, and confirmation that read-only gates left tracked files unchanged by comparing before/after working-tree content. Distinguish executed checks from planned or blocked checks. Skill consultation alone is not validation evidence.
