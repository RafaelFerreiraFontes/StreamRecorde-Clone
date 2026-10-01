---
name: API Validation Cleanup
description: Confirm and minimally resolve the API TypeScript startup validation and CreateStreamerDto test-fixture mismatch without changing application behavior.
wave: 01
status: done
---

# API Validation Cleanup

## Objective

Investigate two API validation failures, prove their root causes, and apply only the smallest non-functional maintenance corrections that the evidence supports:

1. The API TypeScript compiler must start with `pnpm exec tsc --noEmit` without a manual command-line override for `ignoreDeprecations`.
2. The `StreamController` create-streamer test fixture must respect the actual `CreateStreamerDto` input contract.

This is a maintenance-validation task. It must not introduce new product behavior, redesign the API, or advance later roadmap work.

## Required Context

Read these files before analysis or implementation:

- `.github/instructions/project.instructions.md`
- `.github/instructions/mvp.instructions.md`
- `.github/tasks/wave-01/stabilization.task.md`
- `.github/agents/coordinator.agent.md`
- `.github/agents/sol.agent.md`
- `.github/agents/terra.agent.md`
- `.github/agents/luna.agent.md`
- `api/package.json`
- `api/tsconfig.json`
- `api/src/streams/test/stream.controller.spec.ts`
- `api/src/streams/dto/streamer.dto.ts`

## Allowed Scope

Future implementation changes are permitted only in:

- `api/tsconfig.json`, and only if Sol confirms that its current setting causes the compiler startup failure and identifies the compatible minimal correction;
- `api/src/streams/test/*`, and only if Sol confirms that the failing create-streamer input is a test fixture or mock that violates the existing DTO contract.

Any other file may be changed only when Sol clearly proves that it is both necessary and non-functional. Such an expansion is not implicitly approved: the Coordinator must treat it as a scope blocker and return `CHANGES_REQUIRED` for explicit refinement before Terra proceeds.

Production DTOs, controllers, services, repositories, and worker code are not approved implementation targets for this task.

## Problem A — TypeScript Deprecation Configuration

The repository currently declares TypeScript through the API package and configures `ignoreDeprecations: "6.0"` in `api/tsconfig.json`. Do not assume that deleting the setting is correct.

Sol must establish:

- the TypeScript version actually resolved by the package manager, not only the semver range in `package.json`;
- the relevant package and lockfile evidence;
- whether that resolved compiler supports `ignoreDeprecations: "6.0"`;
- the meaning of the setting for that compiler version;
- whether it is the direct cause of the compiler startup failure;
- the smallest compatible fix that preserves current type-safety and compiler strictness;
- which later TypeScript errors are ordinary project code errors and therefore separate from this startup/configuration failure.

Desired result: from `api/`, `pnpm exec tsc --noEmit` starts normally with the checked-in configuration and without a manual override. Passing the entire type-check is desirable, but unrelated code errors must be reported separately rather than hidden or pulled into scope.

Do not weaken type checking, disable strictness, add broad exclusions, or suppress unrelated diagnostics to make the command appear successful.

## Problem B — CreateStreamerDto Test Fixture

`api/src/streams/test/stream.controller.spec.ts` currently passes an `id` in the object supplied to `createStreamer`, while `CreateStreamerDto` does not declare an `id`.

Sol must verify the controller signature, DTO contract, service/repository behavior, and related tests before proposing a correction.

If the evidence confirms that the identifier is generated or assigned after creation, Terra may correct only the input fixture or mock while keeping the expected returned entity accurate. Do not modify the production DTO merely to satisfy the test, and do not add `id` to `CreateStreamerDto` as a workaround.

## Environment Failure Policy

`ENOSPC` is an environment failure, not a project failure. No configuration, Jest setting, cache behavior, dependency, package-manager choice, or source file may be changed to mask it.

If a required validation cannot run because of `ENOSPC`, stop the affected work and report:

```text
AGENT_RESULT

status: BLOCKED
next_agent: Coordinator
scope_changed: false
blocking_issue: true
failure_type: ENVIRONMENT_FAILURE
environment_failure: ENOSPC
```

The task may be considered complete only when the required validations can run, or when the sole remaining blocker is environmental and the Coordinator stops the pipeline correctly without authorizing compensating project changes.

## Agent Pipeline

Use the existing automatic pipeline:

```text
Coordinator -> Sol -> Terra -> Luna
```

- Luna `PASS` returns automatically to Coordinator.
- Coordinator reports `READY_FOR_COMMIT` and hands control to the human.
- Luna `CHANGES_REQUIRED` returns automatically to Terra, then Terra returns to Luna.
- Luna may perform at most three review iterations.
- Review 3 with unresolved findings returns `FAILED_REVIEW_LIMIT` to Coordinator and stops.
- Agents must use their existing `AGENT_RESULT` protocol and automatic-handoff rules.

Do not wait for the human between normal pipeline stages. Do not commit or push.

## Sol — Investigation and Plan

Sol owns root-cause analysis only. Sol must not implement changes.

Sol must:

1. Confirm the declared and actually resolved TypeScript versions using `api/package.json`, the applicable lockfile, and package-manager commands where available.
2. Inspect `api/tsconfig.json` and establish whether `ignoreDeprecations: "6.0"` is supported, what it means, and whether it causes the startup failure.
3. Run or analyze `pnpm exec tsc --noEmit` from `api/`, separating configuration/startup failure from later code diagnostics.
4. Inspect `CreateStreamerDto`, the controller create method, relevant service/repository behavior, the failing controller test, and nearby tests.
5. Confirm whether the `id` belongs only to the returned entity and therefore must be removed only from the create input fixture or mock.
6. Produce the smallest implementation plan within the allowed scope.
7. Identify risks, commands to run, and refined acceptance criteria.
8. Hand off automatically to Terra with `AGENT_RESULT` when the plan is ready.

Sol's report must include:

- confirmed root cause for each problem;
- evidence and relevant files;
- exact proposed files and minimal edits;
- explicit confirmation that application behavior is unchanged;
- risks and rollback considerations;
- validation commands;
- refined acceptance criteria;
- any environment failure, classified precisely.

Sol must not:

- edit files;
- change a production DTO to accommodate a test fixture;
- touch worker code;
- start Creator, Stream, Recording, or other Wave 2 work;
- broaden the task into general cleanup.

If evidence requires a file outside the allowed scope, Sol must report the need to Coordinator as a scope change instead of authorizing Terra directly.

## Terra — Minimal Implementation and Validation

Terra may implement only Sol's approved plan and only after both root causes are confirmed.

Implementation rules:

- keep the diff minimal;
- change `api/tsconfig.json` only if the compiler-version evidence confirms the setting is the cause;
- change a test fixture or mock only if the DTO-contract evidence confirms the mismatch;
- preserve production DTO and API behavior;
- do not weaken compiler strictness or type safety;
- do not refactor nearby code;
- do not change dependencies, the package manager, or lockfiles;
- do not touch the worker or unrelated modules.

Terra must run these commands from `api/` at minimum:

```text
pnpm exec tsc --noEmit
pnpm test -- --runInBand src/streams/test/stream.controller.spec.ts
```

Terra may run an additional directly relevant suite when needed to verify the minimal change. Every command must be recorded as `passed`, `failed`, or `blocked`, with failures explained. If `tsc` starts but reports unrelated code errors, record them separately without hiding them or expanding scope.

Before handoff, Terra must also run `git diff --check` from the repository root and provide the exact changed-file list. Terra then hands off automatically to Luna using the existing protocol.

## Luna — Review

Luna must review the actual diff and validation evidence, not merely Terra's summary.

Luna must confirm:

- each root cause was established before its correction;
- the TypeScript change is a compatible correction rather than a workaround;
- compiler strictness and type safety were not weakened;
- `CreateStreamerDto` was not changed merely to satisfy a test;
- test inputs and mocks respect the DTO contract;
- expected returned entities remain accurate;
- no API behavior changed;
- the required validations ran and their results were reported honestly;
- environment failures are classified rather than masked;
- no scope creep occurred.

Luna returns `PASS` only when the implementation and evidence satisfy the task. Luna returns `CHANGES_REQUIRED` on review 1 or 2 when an in-scope defect, workaround, missing required validation, or scope violation can be corrected by Terra. Luna follows the existing third-review limit and returns `FAILED_REVIEW_LIMIT` if required findings remain on review 3.

## Acceptance Criteria

- [ ] The cause and compatibility of `ignoreDeprecations: "6.0"` are confirmed before any edit.
- [ ] The actual resolved TypeScript version is documented with package/lockfile evidence.
- [ ] `pnpm exec tsc --noEmit` starts without a manual override.
- [ ] Later unrelated TypeScript code errors, if any, are classified separately and not suppressed.
- [ ] Type safety, strictness, and compiler coverage are not weakened.
- [ ] The intended `CreateStreamerDto` contract is confirmed from production code.
- [ ] Create-streamer fixtures and mocks respect that DTO contract.
- [ ] The production DTO is not changed merely to accommodate a fixture.
- [ ] The targeted controller test runs when environment resources permit.
- [ ] No test is skipped, disabled, or weakened.
- [ ] No functional controller, service, or repository behavior changes.
- [ ] No worker file changes.
- [ ] No Creator, Stream, Recording, WatchTarget, or other domain expansion.
- [ ] No infrastructure work outside the two confirmed maintenance issues.
- [ ] `ENOSPC`, if encountered, is reported as `environment_failure: ENOSPC` and is not masked by project changes.
- [ ] All validation commands are recorded as passed, failed, or blocked.
- [ ] `git diff --check` reports no whitespace errors.
- [ ] Luna returns `PASS` before Coordinator reports `READY_FOR_COMMIT`.
- [ ] Coordinator hands control to the human; no commit or push is performed.

## Out of Scope

- Wave 2 implementation;
- new or redesigned Creator, WatchTarget, Stream, or Recording entities;
- database models, migrations, ORM adoption, or database tooling;
- Redis, BullMQ, RabbitMQ, queues, schedulers, or job payloads;
- OAuth, Google Drive, Dropbox, OneDrive, or other cloud integrations;
- WebSocket or SSE application features;
- frontend, authentication, authorization, invitations, or tags;
- worker, Streamlink, FFmpeg, recording, upload, or retention changes;
- general API refactors or cleanup;
- arbitrary dependency additions, removals, or upgrades;
- package-manager changes;
- broad test restructuring;
- unrelated optimizations;
- commits or pushes.

## Completion Report

Coordinator's final report must include:

- confirmed root cause for both problems;
- files changed and why;
- validation results, including any unrelated diagnostics;
- Luna verdict and review iteration;
- confirmation that scope did not change;
- confirmation that the worker and production API behavior were untouched;
- `git diff --check` result;
- final status: `READY_FOR_COMMIT`, `BLOCKED`, or `FAILED_REVIEW_LIMIT`;
- explicit handoff to the human for any commit decision.
