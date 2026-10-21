# StreamRecorder Clone — Project Status

## Current Milestone

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
Task 07 verification: API 157 passed / 37 DB-gated skipped (all 43 database tests passed in isolated PostgreSQL test harness); frontend 25 passed; Worker unittest 198 passed; Worker pytest 198 passed; API/frontend typechecks and production builds passed; Docker smoke Scenarios A and B passed in isolated containers. Fake media verifies process mechanics and does not prove playable MP4 or live platform recovery.

## Transitional Architecture / Technical Debt

| Shared JSON | Responsibility today |
| --- | --- |
| watchlist.json | WatchTarget configuration and name-based Creator grouping |
| channels_status.json | Operational/runtime snapshot |
| streams.json | Stream history |
| sessions.json | Legacy Recording history (channel_id compatibility) |

The table describes default JSON mode. In relational bridge mode PostgreSQL is
domain authority and channels_status.json is a replaceable operational snapshot.
Atomic JSON replacement and process-local locks do not provide cross-process
transactions. Domain event acknowledgement is transactional in PostgreSQL.

Legacy sessions omit Recording.stream_id; import preserves unknown links as
NULL. New bridge recordings persist the Stream relationship and originating
target context. Relational Creator IDs are stable; JSON grouping remains
name-derived. Relational archival/deletion preserves history.

## Not Implemented Yet

Persisted User/local profile; authentication; ownership; Redis/BullMQ; queue-backed Recording Jobs; Tags; SSE; Worker heartbeat; Tauri; Google Drive/Dropbox/OneDrive integrations; cloud OAuth; CloudStorageConnection; optional CloudExport; automatic retention/storage limits; hosted deployment; invite-only.

## Roadmap

### Completed Waves

The inspected Wave 04, 04.5, 04.75, and 05 task frontmatter is done:
- Wave 04/04.5/04.75: Worker reliability/probe corrections; enabled and recording-folder/browser controls; quality/URL editing and adaptive quality integration.
- Wave 05 ([PostgreSQL + Definitive Domain Persistence](.github/tasks/wave-05/README.md)): Architecture decisions (T01), PostgreSQL 17 + Drizzle foundation (T02), Creator & WatchTarget relational persistence (T03), Stream & Recording persistence with composite foreign key (T04), Option A Worker bridge with durable outbox and fail-closed checkpoints (T05), Legacy JSON migration CLI with transactional import and SHA-256 manifests (T06), and Docker live integration QA (Scenarios A and B) and documentation (T07).

### Next Wave

Wave 05.5 — User + authentication + ownership: planned. Local profile/account, password hashing (Argon2/bcrypt), token/session handling, and user isolation.

### Planned Waves

| Wave | Direction |
| --- | --- |
| 05.5 | User + authentication + ownership |
| 06 | Redis/BullMQ + Recording Jobs |
| 06.5 | Tags + advanced filters |
| 07 | Local Recording Storage + file lifecycle |
| 07.5 | Local recording management + storage policies/limits |
| 08 | SSE + Worker heartbeat |
| 08.5 | Tauri 2 Desktop Application |
| 09 | Google Drive + CloudStorageConnection + OAuth |
| 09.5 | Optional Cloud Export / Upload |
| 10 | Dropbox + OneDrive |
| 10.5 | Local/cloud retention and cleanup policies |
| 11 | Invite-only + user limits for future Hosted Mode |
| 12 | Hosted deployment + production hardening |
| 13 | Compliance/legal + observability + release hardening |

Roadmap numbering may evolve. Wave 07 extends existing local capture/browser foundations; it does not mean local output is absent today.
Possible later desktop subtasks: Desktop Shell, Native Recording Folder Integration, Local Runtime Manager, System Tray / Background Behavior, Packaging / Installer, Desktop Integration QA. No such tasks are created now; service packaging remains undecided.

## Current Risks / Known Limitations

- No Worker heartbeat/healthcheck; HTTP health cannot establish Worker liveness.
- Browser polling is five seconds; Worker default polling is 60 seconds plus probe time.
- Persisted active state may be stale; multi-worker coordination is absent.
- Successful recording state is finished, based on exit code and existing non-empty output. The .mp4 suffix is not proof of a valid MP4; explicit FFmpeg finalization is absent.
- Worker timestamps omit timezone offsets; migration must not silently reinterpret historical times.
- Malformed/zero-byte JSON remains an error rather than an empty collection.
- Current console has no authentication and is intended for a trusted local environment.
- Recorded Wave 04 documentation leaves real-platform recovery/playability unverified by deterministic tests.

## Definition of Local-First MVP

A local user/profile configures Creator and independent WatchTargets, detects a Stream, processes a Recording Job, captures/finalizes media, and retains an accessible local Recording conceptually COMPLETED. Profile, job queue, and complete file management are target milestones; current polling captures finish as finished. No cloud export is required.

## Definition of Future Hosted Mode

Optional hosted operation with ownership, authentication, invite limits, deployment security, and production hardening. It must not replace Local Mode or make remote infrastructure essential to local recording.

## Last Updated

2026-10-21: Wave 05 completed and merged into master via PR #2 with Compose volume driver hardening incorporated. All automated suites (API, Worker unittest/pytest, Frontend, PostgreSQL foundation) and live Docker integration smoke tests (Scenarios A and B) passed. Relational persistence remains opt-in and JSON mode remains default.
