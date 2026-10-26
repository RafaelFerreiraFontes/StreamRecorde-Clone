# StreamRecorder Clone — Project Status

## Post-Wave 05.5 Operational Readiness Checkpoint

Documentation checkpoint only; existing wave statuses and human approvals below remain unchanged. New Docker stability testing has **not** been claimed or recorded. See [the operational guide](README.md#1-operational-checkpoint-status) and [unfilled human test matrix](docs/DOCKER-STABILITY-TESTING.md).

Approved deployment contract: A = three-service JSON/local without PostgreSQL; B = relational/local with PostgreSQL 17 and persistent Worker outbox; C = relational/authenticated with exact `AUTH_TRUSTED_ORIGINS`. B/C require `POSTGRES_PASSWORD` and shared `INTERNAL_API_TOKEN`.

Operational packaging now uses explicit tracked overlays and production CLI wrappers. Automated validation is reported separately; human stability testing remains unrecorded.

### Docker Modes Verification Matrix

| Mode                                    | Compose Configuration (`COMPOSE_CONFIG_PASS`) | Isolated Runtime Execution (`ISOLATED_RUNTIME_PASS`)             | Human Stability Testing (`USER_STABILITY_TEST_PENDING`) |
| --------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| **Mode A** (JSON / local)               | **PASS** (`compose.yml`)                      | **PASS** (API & Frontend `/health` 200 in disposable project)    | **PENDING** (Reserved for human evaluation)             |
| **Mode B** (PostgreSQL / local)         | **PASS** (A + `compose.relational.yml`)       | **PASS** (Migrated PostgreSQL 17, Bridge, API/Frontend 200)      | **PENDING** (Reserved for human evaluation)             |
| **Mode C** (PostgreSQL / authenticated) | **PASS** (B + `compose.authenticated.yml`)    | **PASS** (Migrated, enrolled user, API/Frontend 200, unauth 401) | **PENDING** (Reserved for human evaluation)             |

### Production Administrative CLI Verification

- **Production Migration CLI (`dist/database/migrate.js`)**: **PASS** (Executed in disposable container against isolated PostgreSQL 17 instance; verified schema and constraints applied cleanly).
- **Production User Management CLI (`dist/auth/users-cli.js`)**:
  - `create <username> --email <email>` via stdin password: **PASS** (Executed with noninteractive stdin in isolated production container; verified no password in command arguments, logs, or image layers).
  - `list`: **PASS** (JSON parsed; confirmed created user with `enabled: true`, `has_password: true`).
  - `disable <username>`: **PASS** (Verified user transitioned to `enabled: false`).
  - `enable <username>`: **PASS** (Verified user restored to `enabled: true`).
  - Interactive TTY no-echo prompt: **PENDING** (Requires interactive human terminal; separated from automated noninteractive stdin verification).

## Wave 05.5 — User, Authentication and Ownership (Completed & Human-Approved)

Wave 05.5 implementation, integration QA (Phases A, B, C) and operational
documentation are complete and formally human-approved. Post-QA hotfix `3d7f115`
closes the Worker bridge recovery contract gap; the wave is officially completed and
accepted for merge into `master`, with the merge itself still unperformed.

- Authenticated startup implementation: completed.
- Authenticated startup QA: passed across unit, isolated PostgreSQL integration, and Docker smoke suites.
- Authenticated startup capability: explicit opt-in with fail-closed prerequisite validation (`RELATIONAL_STORAGE=true`, valid PostgreSQL `DATABASE_URL`, non-empty `AUTH_TRUSTED_ORIGINS`, reachable database, Wave 05.5 ownership schema/composite constraints, and an enabled password-enrolled user).
- Authenticated startup on personal installation: not activated.
- Hosted deployment: not authorized.
- Merge into master: not performed.

Supported normal operation remains JSON/local by default, or explicitly migrated
PostgreSQL/local with stable bootstrap `local`. JSON/authenticated is unsupported;
PostgreSQL/authenticated requires explicit opt-in and validated prerequisites. There is no public
signup/default credential, public media, per-user physical folders, hosted
service, Redis, Tags, SSE or cloud export. See
[operations](api/README.database.md#wave-055-operations-supported-modes-and-activation-gate)
for account CLI, security configuration, migration/cutover and relational/local
rollback. Other owners remain stored and invisible to local domain routes, but
Worker monitoring and shared-root browsing have explicit operator caveats.
Required blocked/skipped checks must not be reported as passing; synthetic media
does not prove playable MP4.

Terra and Coordinator validation (2026-10-23, verified with Node 25.9.0, pnpm 11.20.0,
Python 3.12.4 and `.venv` Python 3.13.9 / Ruff 0.15.6):

- `pnpm lint` (`node scripts/lint-repository.mjs lint`): PASS (exit 0, 0 ESLint/Ruff diagnostics across `scripts`, `api`, `frontend`, `worker`; SHA-256 tracked-file inventory identical before and after).
- `pnpm format:check` (`node scripts/lint-repository.mjs format:check`): PASS (exit 0, Prettier and Ruff format checks clean; SHA-256 tracked-file inventory identical before and after).
- `git diff --check`: PASS (exit 0).
- `pnpm --dir api exec tsc --noEmit`, `pnpm --dir api test` (12 suites passed, 3 DB-gated skipped; 200 passed, 80 DB-gated skipped), `pnpm --dir api run build`: PASS (exit 0).
- `node scripts/test-db-foundation.mjs` (`streamrecorder-test-db` on `127.0.0.1:55432`): PASS (exit 0; 6 suites / 88 passed, including relational/local rollback case, authenticated startup prerequisite cases, and DB restart persistence probe).
- `node scripts/test-wave05-rehearsal.mjs` (`streamrecorder-rehearsal-41a446b09db9`): PASS (exit 0; all 7 phases including clean migrations, dry-run, backup/manifest, transactional import, verify, idempotence, forward repair and rollback invariants), plus disposable PostgreSQL `pg_dump`/restore snapshot verification.
- `pnpm --dir frontend run typecheck`, `pnpm --dir frontend run test` (38 passed, 0 failed), `pnpm --dir frontend run build`, and `pnpm --dir frontend run test:integration` (isolated localhost stack): PASS (exit 0).
- `C:\Python312\python.exe -m unittest discover -s worker -p "test_*.py"` (198 passed) and `C:\Python312\python.exe -m pytest worker/test_worker.py` (198 passed): PASS (exit 0).
- `docker compose -f compose.yml config --quiet` and `pnpm test:smoke` (18 JSON gates + relational bridge E2E proxy, Worker outbox recovery, zero duplicates, and DB/API restart durability): PASS (exit 0).
- Test containers/volumes and private temporary fixtures were removed (`docker ps -a` and `docker volume ls` empty); pre-existing application image tags were restored. No normal storage, engines, dependencies or global runtimes were changed.

### Post-QA Hotfix and Official Closure (2026-10-26)

Hotfix `3d7f115` (`fix(worker): align bridge recovery reason with API event contract`)
resolves a mismatch between the Worker's recovery reason and the API event DTO.
The minimal correction accepts `worker_restart_before_launch` in the DTO's explicit
allowlist while preserving strict validation and rejection of unknown reasons.
Regression coverage verifies durable acknowledgment and idempotent terminal-event
replay after an API restart against isolated PostgreSQL, with unchanged Recording
data and no duplicate Recording, Stream or Worker event rows.

Recorded post-hotfix automated validation at HEAD `3d7f115`:

- API: 291/291 passed, 0 skipped, with isolated PostgreSQL and restart probe.
- Worker: 201/201 passed, 0 skipped.
- Frontend: 38/38 passed, 0 skipped.
- Relational bridge smoke: 3/3 gates passed in a disposable environment.
- API/frontend typechecks and production builds, repository lint and format checks: passed.

These results are the post-hotfix execution evidence supplied for this closure,
not new application-suite executions performed by the documentation consolidation.
Automated smoke/restart checks do not replace human Docker User Stability Testing,
which remains pending in the matrix above; synthetic media does not prove playable MP4.

## Current Milestone

Wave 05.5 (User Authentication & Ownership) is officially complete and accepted for
merge into `master` on branch `wave-05.5-user-authentication-ownership`, including
post-QA hotfix `3d7f115` and the automated validation recorded above. All wave tasks
are done. Merge, personal-installation authenticated activation and hosted deployment
remain unperformed; human Docker stability testing remains pending.

Wave 05 (PostgreSQL Domain Persistence, Option A Worker Bridge, Migration CLI, and Live Docker Integration) is complete and integrated into `master` via PR #2, with Compose volume driver hardening incorporated. All automated suites and live Docker smoke scenarios have been verified. Existing installations remain JSON-authoritative by default until explicit operator cutover; no automatic user data migration has occurred.

## Product Direction

**Local Mode is primary. Hosted Mode is future/optional.** The application must first work robustly on the user's computer. Recordings belong in Local Recording Storage. No VPS, cloud account, external OAuth, or hosted service is required for the core flow; platform capture still needs network access.

Cloud export to Google Drive, Dropbox, and OneDrive is secondary. A valid local Recording must remain successful if optional export fails. Future Recording and CloudExport lifecycles should be separate.

## Current Architecture

Next.js browser/proxy -> NestJS REST API -> shared JSON adapters (default) or
Drizzle/PostgreSQL domain repositories (opt-in). In relational bridge mode the
independent Python Worker reads execution configuration and submits lifecycle
events through token-protected internal API routes with a durable local outbox.
Compose includes PostgreSQL, frontend, API and Worker, using wave-05 application
images. Streamlink writes private local recordings; FFmpeg is installed, but no
explicit standalone finalization step is invoked.

## Implemented

### Worker

- Twitch/YouTube/Kick platform configuration and Streamlink capture; container pin streamlink==8.6.1.
- Enabled-aware polling; LIVE/OFFLINE/ERROR classification.
- Per-target preferred quality with adaptive fallback that does not overwrite the preference; URL is authoritative.
- Local recording paths/subdirectories, Stream and Recording lifecycle, JSON compatibility, persistence recovery, cooperative subprocess shutdown/reaping.

### API

- NestJS REST domain: Creator, WatchTarget, Stream, Recording.
- JSON Creator grouping/read routes; relational mode adds stable persisted Creator CRUD.
- WatchTarget create/read/delete and PATCH enabled, recording_subdir, quality, URL.
- Stream/Recording reads and Recording target filter; legacy /streamer and /session compatibility.
- Safe read-only recording location/directory browser.

### Frontend

- Next.js App Router operational dashboard for the four domain collections.
- Target creation/deletion, enabled switch, quality/URL/folder edits, external Open Stream.
- Recording location browser/folder picker, API polling, loading/error/stale data, diagnostics.
- No independent Creator mutation, recording playback/download, or native Explorer integration.

### Infrastructure

- Four-service local Docker Compose including PostgreSQL; API/frontend HTTP healthchecks, non-root Worker.
- Shared runtime-data bind mount; Worker recording write mount and API read-only mount.
- Frontend proxy without direct filesystem access.

### Testing

Repository contains deterministic Worker unittest/pytest coverage, API Jest tests, frontend component/proxy tests, isolated fake-Streamlink Docker smoke (Scenario A: 18 gates, Scenario B: relational bridge), and isolated migration/rehearsal harness (7 phases).
Historical Wave 05 Task 07 verification: API 157 passed / 37 DB-gated skipped (all 43 database tests passed in isolated PostgreSQL test harness); frontend 25 passed; Worker unittest 198 passed; Worker pytest 198 passed; API/frontend typechecks and production builds passed; Docker smoke Scenarios A and B passed in isolated containers. Fake media verifies process mechanics and does not prove playable MP4 or live platform recovery.

## Transitional Architecture / Technical Debt

| Shared JSON          | Responsibility today                                      |
| -------------------- | --------------------------------------------------------- |
| watchlist.json       | WatchTarget configuration and name-based Creator grouping |
| channels_status.json | Operational/runtime snapshot                              |
| streams.json         | Stream history                                            |
| sessions.json        | Legacy Recording history (channel_id compatibility)       |

The table describes default JSON mode. In relational bridge mode PostgreSQL is
domain authority and channels_status.json is a replaceable operational snapshot.
Atomic JSON replacement and process-local locks do not provide cross-process
transactions. Domain event acknowledgement is transactional in PostgreSQL.

Legacy sessions omit Recording.stream_id; import preserves unknown links as
NULL. New bridge recordings persist the Stream relationship and originating
target context. Relational Creator IDs are stable; JSON grouping remains
name-derived. Relational archival/deletion preserves history.

## Not Implemented Yet

Redis/BullMQ; queue-backed Recording Jobs; Tags; SSE; Worker heartbeat; Tauri; Google Drive/Dropbox/OneDrive integrations; cloud OAuth; CloudStorageConnection; optional CloudExport; automatic retention/storage limits; hosted deployment; invite-only.

## Roadmap

### Completed Waves

The inspected Wave 04, 04.5, 04.75, 05, and 05.5 task frontmatter is done:

- Wave 04/04.5/04.75: Worker reliability/probe corrections; enabled and recording-folder/browser controls; quality/URL editing and adaptive quality integration.
- Wave 05 ([PostgreSQL + Definitive Domain Persistence](.github/tasks/wave-05/README.md)): Architecture decisions (T01), PostgreSQL 17 + Drizzle foundation (T02), Creator & WatchTarget relational persistence (T03), Stream & Recording persistence with composite foreign key (T04), Option A Worker bridge with durable outbox and fail-closed checkpoints (T05), Legacy JSON migration CLI with transactional import and SHA-256 manifests (T06), and Docker live integration QA (Scenarios A and B) and documentation (T07).
- Wave 05.5 ([User, Authentication and Ownership](.github/tasks/wave-05.5/README.md)): Identity & ownership decisions (T01), User schema & local account migration (T02), Authentication & session lifecycle (T03), Domain ownership & legacy authorization (T04), Worker ownership & filesystem isolation (T05), Repository linting & code readability (T05.5), Frontend authentication & proxy isolation (T06), and Wave integration QA, Phase B startup prerequisite validation & operational documentation (T07). Task 07 is in final review/QA for closure on branch `wave-05.5-user-authentication-ownership`.

### Next Wave

Wave 06 — Redis/BullMQ + Recording Jobs: planned. Background queue orchestration decoupled from HTTP requests.

### Planned Waves

| Wave | Direction                                            |
| ---- | ---------------------------------------------------- |
| 06   | Redis/BullMQ + Recording Jobs                        |
| 06.5 | Tags + advanced filters                              |
| 07   | Local Recording Storage + file lifecycle             |
| 07.5 | Local recording management + storage policies/limits |
| 08   | SSE + Worker heartbeat                               |
| 08.5 | Tauri 2 Desktop Application                          |
| 09   | Google Drive + CloudStorageConnection + OAuth        |
| 09.5 | Optional Cloud Export / Upload                       |
| 10   | Dropbox + OneDrive                                   |
| 10.5 | Local/cloud retention and cleanup policies           |
| 11   | Invite-only + user limits for future Hosted Mode     |
| 12   | Hosted deployment + production hardening             |
| 13   | Compliance/legal + observability + release hardening |

Roadmap numbering may evolve. Wave 07 extends existing local capture/browser foundations; it does not mean local output is absent today.
Possible later desktop subtasks: Desktop Shell, Native Recording Folder Integration, Local Runtime Manager, System Tray / Background Behavior, Packaging / Installer, Desktop Integration QA. No such tasks are created now; service packaging remains undecided.

## Current Risks / Known Limitations

- No Worker heartbeat/healthcheck; HTTP health cannot establish Worker liveness.
- Browser polling is five seconds; Worker default polling is 60 seconds plus probe time.
- Persisted active state may be stale; multi-worker coordination is absent.
- Successful recording state is finished, based on exit code and existing non-empty output. The .mp4 suffix is not proof of a valid MP4; explicit FFmpeg finalization is absent.
- Worker timestamps omit timezone offsets; migration must not silently reinterpret historical times.
- Malformed/zero-byte JSON remains an error rather than an empty collection.
- Normal local console remains unauthenticated and intended for a trusted single operator; authenticated session UI and authorization are implemented/tested but authenticated startup is explicitly opt-in and fail-closed.
- Recorded Wave 04 documentation leaves real-platform recovery/playability unverified by deterministic tests.

## Definition of Local-First MVP

A local user/profile configures Creator and independent WatchTargets, detects a Stream, processes a Recording Job, captures/finalizes media, and retains an accessible local Recording conceptually COMPLETED. Profile, job queue, and complete file management are target milestones; current polling captures finish as finished. No cloud export is required.

## Definition of Future Hosted Mode

Optional hosted operation with ownership, authentication, invite limits, deployment security, and production hardening. It must not replace Local Mode or make remote infrastructure essential to local recording.

## Last Updated

2026-10-26: Official Wave 05.5 closure includes post-QA hotfix `3d7f115` and recorded post-hotfix automated validation. All tasks are done; accepted for merge into master. Human Docker User Stability Testing remains pending.

2026-10-23: Wave 05.5 completed and human-approved on branch wave-05.5-user-authentication-ownership. All tasks (01–07, including 05.5) are done. Authenticated startup capability is available via explicit opt-in with fail-closed prerequisite validation. Merge into master, deployment, and personal installation activation remain unperformed. See the summary above.

2026-10-21: Wave 05 completed and merged into master via PR #2 with Compose volume driver hardening incorporated. All automated suites (API, Worker unittest/pytest, Frontend, PostgreSQL foundation) and live Docker integration smoke tests (Scenarios A and B) passed. Relational persistence remains opt-in and JSON mode remains default.
