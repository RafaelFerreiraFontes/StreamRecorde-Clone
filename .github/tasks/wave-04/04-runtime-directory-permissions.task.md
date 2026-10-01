---
name: Wave 04.4 Shared Runtime Directory Permission Hardening
wave: 04
order: 04
depends_on: []
status: done
---

# 04.4 — Shared Runtime Directory Permission Hardening

## Context

Supplied runtime evidence includes `Permission denied: /data/.channels_status.json.<random>.tmp`. Python uses same-directory `mkstemp` and atomic replace. Worker image creates UID/GID 1000:1000 and chowns image directories; API runs as `node`. Compose overlays those directories with host bind mounts. Existing startup initialization creates missing files but skips existing files, so successful initialization does not prove later replace access.

## Objective

Establish predictable non-root API/Worker access to shared runtime files and Worker output while preserving atomic persistence and user data.

## Dependencies / Preconditions

No Wave 04 dependency; may proceed independently after repository analysis. Must finish before 04.6/04.7. Read [wave context](README.md), both Dockerfiles, Compose, both JSON adapters, API startup initialization, and path/initialization tests. Coordinate overlapping Worker/test edits with 04.2/04.3.

## Scope

Proven ownership/mode correction, bounded host-directory initialization, startup validation, and explicit runtime persistence-failure handling. Inspect all effective parent paths, including per-file overrides and output subdirectories.

## Out of Scope

Unsafe direct JSON writes, running application services as root, blanket `chmod 777`, broad recursive ownership changes, deletion/reinitialization of existing data, distributed locks, transactional database replacement, new health servers, and future infrastructure.

## Required Changes

- Sol records container `id` for API and Worker, host/mount type, effective numeric UID/GID, directory owner/mode/ACL, mount read/write setting, file mode after replacement, and the exact failing operation. Distinguish directory create/write/search/rename permissions from destination-file readability and Windows file-sharing restrictions. Do not claim the root cause is a UID mismatch without evidence.
- Prefer a documented consistent numeric identity or shared group plus a narrowly scoped host-directory provisioning procedure. Existing image `chown` does not fix a mounted host directory. Account for fresh directories auto-created by Docker and pre-existing host-owned data. Provision only explicitly selected runtime/output directories; do not run recursive ownership changes over the repository or arbitrary override paths.
- Verify Python `mkstemp`'s restrictive file mode and API temporary-file creation under umask. A group-based design must deliberately preserve required access after each replace; changing only parent ownership is insufficient. Do not make private runtime files world-readable/writable as a shortcut.
- Preserve same-directory temp creation, full write, flush/fsync, and atomic replacement. On write/sync/replace failure retain the old valid destination, close descriptors, and clean up only that operation's temporary file. Report cleanup failure without hiding the original error. Atomic replace is not a multi-file transaction or cross-process lock.
- At startup validate actual required operations under the application identity, including safe disposable create/write/replace/read/cleanup checks in runtime parents and media-output writability. Do not overwrite real JSON as a capability test. Validate existing JSON readability and preserve current override precedence and canonical initialization.
- On startup inability to access required directories, fail clearly with a non-zero exit and actionable path/operation/identity details before polling. Do not merely announce readiness because directories exist.
- On mid-run persistence failure, report an operational persistence error, never OFFLINE or successful persisted completion. Keep capture/process handles tracked and avoid duplicates/orphan children. Do not launch new captures while required Stream/Recording persistence is failing; retry only on a bounded later poll after access recovers. Active recordings may drain/finish normally; preserve pending state in memory and retry its persistence without dropping it during reload. No durable queue or multi-file transaction is required.
- Document Linux bind mounts versus Windows Docker Desktop/WSL2 host ACL and sharing behavior. POSIX chmod/chown may not have equivalent effects on Windows-mounted paths; use actual container access checks, not mode bits alone.

## Compatibility Requirements

Keep both services non-root, JSON shapes and legacy adapters intact, `*_PATH > CONFIG_DIR > local default`, `/recordings` and subdirectory validation, and current single-Worker architecture. Narrow API adapter/startup adjustments are allowed only for this shared access contract.

## Acceptance Criteria

- [ ] The exact cause of the supplied temp-file denial is established or explicitly marked unreproduced; the chosen access contract is independently demonstrated.
- [ ] Fresh and existing test bind mounts work for both API and Worker under verified non-root identities.
- [ ] Files remain accessible to the other service after repeated atomic replacement; Worker can create media files beneath OUTPUT_DIR.
- [ ] Startup detects unwritable parents/output paths even when canonical JSON files already exist.
- [ ] Temp creation/write/sync/replace failures preserve old valid JSON and produce actionable diagnostics.
- [ ] Mid-run failure cannot generate false offline/end/success transitions, duplicate captures, or untracked children; recovery persists pending state.
- [ ] No root-service workaround, unsafe permissions, data reset, direct writes, or distributed lock is introduced.

## Verification

Run Worker tests with injected `PermissionError`/`OSError` at temp creation, write, fsync, and replace; verify cleanup, old file contents, and state after recovery. Do not rely solely on chmod tests that behave differently on Windows/root. Run `python -m pytest worker/test_worker.py`; if API files change, run from `api/` `pnpm test -- --runInBand` and `pnpm exec tsc --noEmit`. Run `git diff --check`.

In isolated container fixtures inspect `docker compose exec worker id`, `docker compose exec api id`, and `sh -c 'ls -ldn /data /recordings'` in Worker (`/data` only in API). Verify reads after each service's intended writes; use disposable files for cross-writer replacement tests. Test an intentionally unwritable mount and recovery without touching developer data. 04.7 repeats the integrated gate.

## Risks / Notes

ACLs, read-only mounts, Docker-created root-owned directories, Windows file handles/antivirus, differing umasks, disk-full errors, and ownership after rename are separate failure modes. Missing data must not be confused with inaccessible/corrupt data. Process-local locks do not prevent cross-process lost updates; keep that limitation explicit.

## Rollback / Safety

Record pre-change identities/modes for the exact directories, preserve data backups, and restore only targeted permission/configuration changes if needed. No automatic broad chown or destructive cleanup. Rollback must retain atomic writes; report pending persistence and do not claim data durability that was not achieved.

## Files likely affected

`worker/Dockerfile`, `api/Dockerfile`, `compose.yml`, `worker/worker.py`, `worker/json_adapters.py`, `worker/test_worker.py`; API startup/`api/src/streams/json-compatibility.adapters.ts` and related tests only as proven necessary; narrowly scoped provisioning instructions/script if required. Final runbook consolidation is 04.8. Sol establishes evidence, Terra hardens the minimum paths, Luna verifies access and failure safety.
