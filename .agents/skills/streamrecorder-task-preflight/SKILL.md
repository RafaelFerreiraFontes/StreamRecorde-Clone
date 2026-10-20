---
name: streamrecorder-task-preflight
description: Establish scope, Git ownership, baseline behavior, and validation before starting a StreamRecorder task, bug fix, refactor, infrastructure change, or other repository edit. Produces a preflight plan without implementing the change.
---

# Task preflight

## Purpose and use

Prepare a safe, bounded change, including direct agent sessions without a Coordinator. Use before editing; use review-gate for an implementation readiness verdict.

## Read first

- [Project instructions](../../../.github/instructions/project.instructions.md) and [MVP instructions](../../../.github/instructions/mvp.instructions.md).
- The concrete task and acceptance criteria in [tasks](../../../.github/tasks/), if supplied; otherwise the user's requested outcome.
- [Project status](../../../PROJECT-STATUS.md), [development guide](../../../README.md), and relevant component README, implementation, and tests.

## Procedure

1. Record `git branch --show-current`, `git status --short --untracked-files=all`, `git rev-parse HEAD`, and the existing staged/unstaged diff. Verify the expected branch from the request/task before switching or editing.
2. Inventory preexisting and untracked work by file and ownership. Preserve it, including staged changes. If ownership or overlap is unresolved, stop with `BLOCKED`; do not silently absorb it.
3. Classify the request as application work or harness/documentation work. Extract objective acceptance criteria, authorized files, compatibility requirements, and explicit out-of-scope work. Do not turn a tooling request into a Wave implementation.
4. Trace current behavior through affected producers, consumers, persistence, and tests. Current code overrides historical implementation claims; record contradictions without expanding scope.
5. Identify the smallest safe diff and relevant risks. Select focused checks and required affected-suite validation from current package scripts/runbooks. Establish baseline results where they help distinguish regressions; document any omitted baseline.
6. Report readiness and blockers before implementation. Specialized domain, Worker, persistence, Docker, API/frontend, or security workflows can supplement this plan when relevant; none is a prerequisite for completing preflight.

## Safety / invariants

Never automatically reset, stash, discard, rewrite history, or force push. A preflight grants no commit, push, task-status, or dangerous-operation authority. Keep permanent rules in instructions and role assignment/handoffs in custom agents; do not expand the roadmap.

## Validation and expected result

Return branch/SHA, change-ownership inventory, current behavior evidence, acceptance criteria, affected files, exclusions, and exact intended checks with working directories. Classify assertion failures, runtime regressions, and introduced type errors as `CODE_FAILURE`; unavailable tools/services, permissions, dependencies, or disk failures as `ENVIRONMENT_FAILURE`, with evidence. Never change unrelated configuration to hide the latter. End with ready-to-implement scope or `BLOCKED` and the unresolved prerequisite; do not implement from this skill alone.
