---
name: Wave 04.8 Worker Documentation and Runbook Update
wave: 04
order: 08
depends_on:
  - 01-streamlink-runtime-upgrade.task.md
  - 02-probe-result-model.task.md
  - 03-worker-probe-observability.task.md
  - 04-runtime-directory-permissions.task.md
  - 05-watch-target-enabled-enforcement.task.md
  - 06-worker-regression-tests.task.md
  - 07-worker-docker-integration-validation.task.md
status: done
---

# 04.8 — Worker Documentation and Runbook Update

## Context

Worker/API READMEs explain Wave 02 domain and JSON boundaries in English and Portuguese. The root README describes Wave 03 Docker development and explicitly notes that Worker running is not a healthcheck. After implementation, those documents must accurately describe the upgraded runtime, probe states, enabled policy, permissions, and stronger smoke coverage.

## Objective

Publish a concise, verified runbook for diagnosing and operating the corrected Worker without overstating test results or future architecture.

## Dependencies / Preconditions

04.1–04.7 implementation reports and validation evidence are available. Read [wave context](README.md), the final actual code/configuration, root/Worker/API READMEs, and existing agent lifecycle rules. An unavailable optional live exercise must remain explicitly not run/pending in the final wave report.

## Scope

Worker/root operational documentation, bounded API compatibility/permission notes, and wave evidence summary. Preserve bilingual component documentation and existing working commands/links.

## Out of Scope

Production code, new dependencies, task lifecycle redesign, declaring planned tasks implemented without evidence, future cloud/queue/database features, public media catalogs, permanent server-storage policies, and unrelated README cleanup.

## Required Changes

- Document the exact supported Streamlink pin selected by 04.1, Python/container compatibility, how to check the actual installed version, and when image rebuild plus container recreation is necessary. Plain restart does not update dependencies.
- Explain LIVE/OFFLINE/ERROR and the supported no-streams signature. ERROR is not OFFLINE; it preserves last known broadcast state and retries on future polling. A prior runtime state may be stale, so operators must consult probe diagnostics.
- Describe checking/result/live/start/finish logs, useful safe error fields, startup version/paths/interval diagnostics, and credential-redaction expectations. Do not suggest posting raw debug output or stream URLs publicly.
- Preserve this diagnostic sequence, with placeholders replaced by an authorized controlled URL:

```sh
docker compose exec worker streamlink --version
docker compose exec worker streamlink --loglevel debug --json <url>
docker compose logs --tail=100 worker
```

- Explicitly explain that `container running` does not necessarily mean `live detection is functioning`. Separate Docker process liveness, API/frontend HTTP health, probe success, and successful media capture.
- Provide a short decision flow: verify enabled configuration and effective mount/paths -> compare runtime version with pin -> inspect sanitized probe result -> check UID/GID and runtime/output access -> inspect Stream/Recording/output progression. Classify platform outage, dependency failure, actual offline, configuration failure, and persistence failure separately.
- Document the 04.4 identity/host provisioning contract, Linux bind-mount behavior, Windows Docker Desktop/WSL2/ACL implications, per-file override parents, and actionable permission checks. Directory existence and Dockerfile chown are insufficient; repeated atomic replace must preserve cross-container access. Never recommend root services or blanket chmod 777.
- Explain enabled true/false/omitted/invalid behavior, configuration refresh/pre-launch timing, allowing active captures to finish, no retries while disabled, and the unresolved-broadcast-gap limitation. Do not claim a new API toggle route exists if 04.5 only corrected adapters.
- Keep `channels_status.json` operational, `streams.json` historical, `sessions.json` legacy, and Creator/WatchTarget/Stream/Recording distinct. Explicitly retain lack of distributed locking and non-persisted legacy `stream_id` linkage.
- Document deterministic unit/smoke commands and their boundaries. Describe isolated temporary mounts/projects and safe cleanup. Separately describe the short controlled live exercise, required evidence, and real MP4 inspection; do not infer format from a suffix.
- Summarize actual passed/failed/blocked/not-run results, remaining limits, and the confirmed incident outcome. Leave unperformed real-live acceptance pending. Keep recordings private/user-controlled; no public distribution or unnecessary permanent storage is introduced.

## Compatibility Requirements

Match final code/commands and root Compose configuration. Update corresponding English/Portuguese sections for changed component behavior. Preserve local development paths, individual override precedence, legacy contracts, and existing links. Do not turn a runbook into an implicit schema/architecture change.

## Acceptance Criteria

- [ ] Supported version, rebuild/recreation, probe states, diagnostics, enabled lifecycle, and directory access requirements match implementation.
- [ ] The required version/debug command sequence and container-running caveat are clear.
- [ ] Permission troubleshooting covers API/Worker numeric identities, atomic replace, bind mounts, and Windows specifics safely.
- [ ] Unit tests and deterministic Docker smoke are separated from optional real-platform validation.
- [ ] Real-media outcome/format and any unperformed operational checks are reported honestly.
- [ ] Wave 02 identities and JSON limitations remain explicit; no public media/future features are implied.
- [ ] Documentation links/placeholders/shell examples are checked; bilingual sections remain consistent.
- [ ] Coordinator retains `user-approve` after Luna PASS until existing user-acceptance rules permit done; no commit/push is automatic.

## Verification

Cross-check documented version with `worker/requirements.txt` and 04.7 container evidence; check commands against actual package scripts and Compose service names. Validate relative Markdown links and `git diff --check`. Reuse 04.6/04.7 results rather than rerunning expensive builds for prose changes. Execute only a bounded safe diagnostic if its accuracy remains uncertain; never run optional recording instructions merely to proofread them. Report all referenced evidence and environmental limitations.

## Risks / Notes

Documentation can accidentally promise durable Recording-to-Stream linkage, instantaneous disable, playable MP4, or working live detection without evidence. Do not copy future architecture diagrams as present behavior. Reconcile stale statements narrowly where they touch this wave.

## Rollback / Safety

Documentation-only rollback has no runtime effect. Retain incident/safety guidance and accurate unsupported/unverified notes. Never publish secrets, runtime JSON containing private configuration, or recording samples as documentation fixtures.

## Files likely affected

`worker/README.md`, root `README.md`, `api/README.md` only for enabled/permission/shared-contract notes, and this wave's evidence/acceptance notes as appropriate to the existing workflow. Do not edit `.github/agents/` or `.github/instructions/`. Sol checks factual gaps, Terra updates prose, Luna checks it against final implementation and evidence.
