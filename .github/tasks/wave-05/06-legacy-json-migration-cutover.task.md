---
name: Wave 05 — Task 06 — Legacy JSON Migration and Authority Cutover
wave: 05
order: 06
depends_on:
  - 05-worker-persistence-bridge.task.md
status: planned
---

# Wave 05 — Task 06 — Legacy JSON Migration and Authority Cutover

## Status and Preconditions

planned — execution has not started. Read the [wave specification](README.md) and complete the predecessor's independent validation/review and human acceptance gate before starting. The shared scope, security, testing, and lifecycle constraints apply to this task.

## Context / Objective

Deliver the explicit opt-in migrator and activate only the authority switches approved in 05-T01 after the Worker bridge has passed its independent gate. Existing installations must migrate without a flag-day replacement or loss of local recordings/history.

## Input and Backup Policy

Domain sources are watchlist.json, streams.json, and sessions.json according to the approved responsibility matrix. channels_status.json stays operational by default; any imported durable subset requires an explicit prior documented decision.

Back up all relevant JSON files (including the operational snapshot when present), schema/DB state as needed, and mapping/manifest metadata before writes. Backing up a file does not mean importing it as domain history. Preserve original files and recording media.

The default policy is an explicit opt-in local command/script, not destructive automatic startup import. Require dry-run validation/report before mutation. Quiesce API/Worker writers or use th…3123 tokens truncated…027s independent QA. Terra only fixes approved wave-caused gaps; substantive defects return to their owner, followed by focused and affected integration validation.

Preserve the established fixing/coordinator-review limits and user-approve -> done human gate. Rollback uses the already rehearsed checkpoint-specific runbook; QA must not invent destructive reset commands or erase valid media.
