# StreamRecorder Clone — Project Status

## Current Milestone

Wave 04.75 is integrated on master. Wave 05 is planned, not implemented.
Baseline inspected: b13a24d10e2ac31a6ca0a442edc2d86341210858.

## Product Direction

**Local Mode is primary. Hosted Mode is future/optional.** The application must first work robustly on the user's computer. Recordings belong in Local Recording Storage. No VPS, cloud account, external OAuth, or hosted service is required for the core flow; platform capture still needs network access.

Cloud export to Google Drive, Dropbox, and OneDrive is secondary. A valid local Recording must remain successful if optional export fails. Future Recording and CloudExport lifecycles should be separate.

## Current Architecture

Next.js browser/proxy -> NestJS REST API -> shared JSON adapters.
Independent Python Worker polls the same configuration/history and writes local recordings using Streamlink. FFmpeg is installed in its image; no explicit standalone finalization step is currently invoked. Compose runs frontend, api, and worker only.

## Implemented

### Worker

- Twitch/YouTube/Kick platform configuration and Streamlink capture; container pin streamlink==8.6.1.
- Enabled-aware polling; LIVE/OFFLINE/ERROR classification.
- Per-target preferred quality with adaptive fallback that does not overwrite the preference; URL is authoritative.
- Local recording paths/subdirectories, Stream and Recording lifecycle, JSON compatibility, persistence recovery, cooperative subprocess shutdown/reaping.

### API

- NestJS REST domain: Creator, WatchTarget, Stream, Recording.
- Creator grouping/read routes; identity derived from names, not independent persisted CRUD.
- WatchTarget create/read/delete and PATCH enabled, recording_subdir, quality, URL.
- Stream/Recording reads and Recording target filter; legacy /streamer and /session compatibility.
- Safe read-only recording location/directory browser.

### Frontend

- Next.js App Router operational dashboard for the four domain collections.
- Target creation/deletion, enabled switch, quality/URL/folder edits, external Open Stream.
- Recording location browser/folder picker, API polling, loading/error/stale data, diagnostics.
- No independent Creator mutation, recording playback/download, or native Explorer integration.

### Infrastructure

- Three-service local Docker Compose; API/frontend HTTP healthchecks, non-root Worker.
- Shared runtime-data bind mount; Worker recording write mount and API read-only mount.
- Frontend proxy without direct filesystem access.

### Testing

Repository contains deterministic Worker unittest/pytest coverage, API Jest tests, frontend component/proxy tests, and isolated fake-Streamlink Docker smoke.
Wave task records document prior validation; runtime suites were not rerun for this documentation-only update. Fake media does not prove real capture/playability.

## Transitional Architecture / Technical Debt

| Shared JSON | Responsibility today |
| --- | --- |
| watchlist.json | WatchTarget configuration and name-based Creator grouping |
| channels_status.json | Operational/runtime snapshot |
| streams.json | Stream history |
| sessions.json | Legacy Recording history (channel_id compatibility) |

Shared JSON is transitional between API and Worker. Atomic replacement and process-local mutexes/locks do not provide cross-process transactions. Do not remove runtime communication just to migrate domain persistence.

Recording.stream_id is dropped by both sessions adapters. Historical links cannot be recovered by assertion. Removing targets leaves history; future FKs/deletion policy must account for this. Creator IDs depend on display-name conventions.

## Not Implemented Yet

PostgreSQL; persisted User/local profile; authentication; ownership; Redis/BullMQ; queue-backed Recording Jobs; Tags; SSE; Worker heartbeat; Tauri; Google Drive/Dropbox/OneDrive integrations; cloud OAuth; CloudStorageConnection; optional CloudExport; automatic retention/storage limits; hosted deployment; invite-only.

## Roadmap

### Completed Waves

The inspected Wave 04, 04.5, and 04.75 task frontmatter is done:
Worker reliability/probe corrections; enabled and recording-folder/browser controls; quality/URL editing and adaptive quality integration. Historical planning text is not current implementation evidence.

### Current Wave

[Wave 05 — PostgreSQL + Definitive Domain Persistence](.github/tasks/wave-05/README.md): planned. Creator, WatchTarget, Stream, Recording become durable relational entities through an incremental transition.

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

2026-10-02 — code/task inspection at the baseline above; documentation and Wave 05 planning only.
