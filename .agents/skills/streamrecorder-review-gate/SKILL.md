---
name: streamrecorder-review-gate
description: Independently audit a completed StreamRecorder diff against scope, acceptance criteria, current code, and executed validation when reviewing an implementation, validating a task, preparing a commit, or answering whether work is ready.
---

# Evidence-based review gate

## Purpose and use

Determine implementation readiness from evidence. Use after work exists, rather than for initial implementation planning. This procedure supports direct review or Coordinator/Luna QA without replacing their roles, handoffs, or review limits.

## Read first

- User request, concrete task/acceptance criteria, approved plan if present, and initial change-ownership inventory.
- [Project instructions](../../../.github/instructions/project.instructions.md), [MVP instructions](../../../.github/instructions/mvp.instructions.md), relevant current implementation/tests, and applicable canonical decisions in [tasks](../../../.github/tasks/).
- Validation evidence with exact commands, working directories, and results; historical task claims are context, not current execution proof.

## Procedure

1. Reconstruct authorized scope and exclusions, including any explicit user amendments. Map each acceptance criterion to observable behavior or an inspectable documentation requirement.
2. Inspect `git status --short --untracked-files=all`, complete staged and unstaged diffs, and all task-produced untracked files. For branch/commit review, also inspect the full diff against the agreed baseline; working-tree diff alone may be empty.
3. Compare the final file inventory with the initial snapshot. Distinguish preexisting user changes, authorized changes, generated artifacts, secrets, unexpected dependencies, and scope creep. Never discard someone else's changes to clean the review.
4. Check acceptance criteria one by one against current code and meaningful tests. File creation alone is not behavioral proof. Inspect producers/consumers and negative, compatibility, lifecycle, and recovery paths relevant to the actual diff.
5. Review executed test evidence, ensuring it covers changed behavior. Run missing appropriate checks safely using current scripts and isolated resources. Do not run mutating lint as read-only review or weaken tests to obtain green output.
6. Apply domain, Worker, persistence, API/frontend, Docker, or security procedures where the diff warrants them. Their separate loading is optional; review still needs the applicable evidence.
7. Run `git diff --check` and the staged equivalent when applicable. Inspect the complete final diff again if corrections change the reviewed artifact, then classify the result.

## Validation and expected result

Report overall `PASS`, `CHANGES_REQUIRED`, or `BLOCKED`. Use `CHANGES_REQUIRED` for objective in-scope defects and `BLOCKED` for unresolved prerequisites preventing safe review/required validation. Separate `CODE_FAILURE` from `ENVIRONMENT_FAILURE`; do not change unrelated configuration to mask the latter.

For each command report `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, or `PRE-EXISTING`, with evidence and impact. Never mark an unexecuted command PASS. PRE-EXISTING requires baseline evidence, not an assumption, and does not waive an acceptance criterion.

Include an acceptance-criteria/evidence table, scope audit, test gaps, and findings with severity, file/symbol, defect, impact, and smallest scoped correction. A PASS requires satisfied criteria and required validation; blocked checks are not passes. Do not reject correct scoped work for personal style preferences. The verdict itself grants no task-status edit, commit, push, merge, or next-task authority.
