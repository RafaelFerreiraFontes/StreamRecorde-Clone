---
description: Concrete local-first MVP scope, domain invariants, component responsibilities, validation, and completion criteria.
applyTo: "**/*"
---

# StreamRecorder Clone — MVP Instructions

## 1. MVP Purpose and Scope

Build a coherent vertical slice that works reliably on the user's computer. Local Mode is the primary product mode, not only development. Hosted Mode remains future and optional.

The MVP should prove that a user can configure monitoring, observe a live broadcast, execute a capture, persist its history, and retain a safely accessible local recording. Cloud export is not a completion criterion.

The product must not require a VPS, remote deployment, hosted backend, Google Drive, Dropbox, OneDrive, or external/cloud OAuth for its main workflow. Platform capture still requires platform/network access.

Use the smallest maintainable design that proves the slice. Avoid a collection of disconnected unfinished features. Follow the durable engineering, language, and agent workflow rules in [project.instructions.md](project.instructions.md).

## 2. Current Baseline Versus Target MVP

Wave 04.75 provides a working initial local slice:

- NestJS REST domain/legacy API with JSON adapters.
- Next.js App Router dashboard, target edits, polling, diagnostics, and recording location browsing.
- Independent Python Worker polling enabled WatchTargets, classifying LIVE/OFFLINE/ERROR, selecting adaptive quality, and recording locally.
- Stream/Recording lifecycle, JSON compatibility, terminal-persistence recovery, and safe subprocess shutdown.
- Three-service local Compose and deterministic API/Worker/frontend tests plus fake-Streamlink Docker smoke.

Current limitations must remain visible:

- Creator identity is derived from display_name/channel_name; no independent Creator CRUD exists.
- Shared JSON is the primary persistence/communication layer.
- Legacy sessions do not persist Recording.stream_id.
- Successful capture uses finished, not COMPLETED.
- FFmpeg is installed/available to Streamlink, but no separate FFmpeg finalization command is explicitly invoked.
- There is no persisted User/profile, authentication, PostgreSQL, Redis/BullMQ, queue-backed Recording Job, SSE, Worker heartbeat, cloud integration, or Tauri.

The target slice below is not a claim that these gaps have already been resolved. [PROJECT-STATUS.md](../../PROJECT-STATUS.md) holds the current milestone and roadmap.

## 3. Fundamental Domain Separation

```text
Creator     = who
WatchTarget = how
Stream      = an actual broadcast occurrence
Recording   = a concrete capture attempt/result
```

Use these concepts consistently in persistence, API responses, frontend, Worker, future jobs, and tests. Do not collapse configuration, live occurrences, and capture attempts into a single entity.

Creator owns identity-related information conceptually; quality/resolution/format and monitoring/output configuration belong to WatchTarget. Stream represents a real detected broadcast and cannot substitute for the persistent target.

Recording must preserve sufficient originating target/Stream context, timestamps, state, and local output information. Future history must not become ambiguous when the target is edited or removed. Use justified immutable context where needed; do not claim the current legacy adapter persists missing relationships or all historical configuration.

## 4. Critical Requirement — Multiple WatchTargets

A single Creator must support multiple WatchTargets with different configurations:

```text
Creator: ExampleStreamer
├── WatchTarget A -> Best, enabled
├── WatchTarget B -> 1080p, enabled
└── WatchTarget C -> 720p, disabled
```

Quality belongs to each target. Never model this as quality1/quality2/quality3 fields on Creator.

Changing, disabling, or deleting A must not alter B or C. The same invariant applies to the database, API, frontend, Worker, future job payloads, and tests.

Each target carries its own identity, Creator relationship, platform/channel, authoritative URL, preferred quality, enabled, and optional relative recording_subdir. Add further configuration only for an active requirement.

## 5. Local-First End-to-End Slice

The target functional scenario is:

1. Application starts locally.
2. Local profile/user context exists.
3. Creator can be managed.
4. Multiple WatchTargets can be managed independently.
5. WatchTargets are monitored.
6. A live Stream is detected.
7. Recording execution is orchestrated.
8. Worker captures the stream.
9. The local file is finalized safely.
10. Recording history is persisted.
11. Recording remains locally accessible.
12. Status and failures are observable.

Today target creation also establishes name-derived Creator grouping, and Worker polling initiates capture directly. Stable Creator persistence is Wave 05; profile/authentication is Wave 05.5; queue-backed execution is Wave 06. The target scenario does not make all later technologies requirements of the current task.

Cloud connection/upload, desktop packaging, and hosted deployment are not conditions for this slice to succeed.

## 6. API Responsibilities and Boundaries

Use:

```text
Controller -> Service -> Repository -> Persistence
```

Controllers handle transport and remain thin. Services enforce application/domain rules. Repositories/adapters handle persistence and compatibility. Filesystem browsing remains behind its dedicated service.

The current API exposes configuration, domain/history reads, validation, legacy mappings, and read-only recording locations. It does not capture media, execute Streamlink/FFmpeg, or hold a request open until recording finishes.

As later waves add capabilities, the API owns stable domain management, authentication/ownership enforcement, and recording-job orchestration. Do not duplicate media-processing logic in the API or move business rules into the frontend.

When a future recording request schedules work, validate the target and applicable authorization, resolve the exact configuration, persist/schedule the work, and return promptly.

## 7. Current API Resources and Compatibility

Current domain contracts include:

```text
GET /creators
GET /creators/:id
GET /creators/:id/watch-targets

GET /watch-targets
GET /watch-targets/:id
POST /watch-targets
PATCH /watch-targets/:id
DELETE /watch-targets/:id

GET /streams
GET /streams/:id
GET /recordings
GET /recordings/:id
GET /recordings?watchTargetId=<id>
```

Recording filesystem/location GETs support safe metadata browsing. Legacy /streamer and /session routes still coexist.

Creator mutations, /auth, /users, and cloud-storage routes are not currently implemented. Old conceptual route examples do not override the actual controller/proxy contracts.

Prefer REST resource-oriented design for additions. Preserve response shapes, status/error semantics, IDs, filters, and legacy boundaries unless an explicit migration justifies a change.

## 8. Creator and WatchTarget Management

**Creator target:** independently create, list, read, update, and delete/manage identity with history-safe semantics. Wave 05 must resolve stable persistence and legacy name-ID mapping. Ownership applies when introduced in Wave 05.5.

**WatchTarget current behavior:** create/read/delete and PATCH enabled, recording_subdir, quality, and URL. Preserve omitted fields; an empty recording_subdir clears the override. The API creates targets enabled by default, and legacy absent enabled maps to true.

Validate required fields, IDs, supported platform, quality, URL, strict enabled type, and recording paths at the API boundary. Frontend validation is UX only.

Preserve absolute HTTP/HTTPS URL validation without embedded credentials, supported-quality validation, and path traversal protection. recording_subdir must remain contained beneath the configured root; reject absolute/drive/UNC paths, traversal, and unsafe filesystem access.

Do not let name changes, target deletion, or config edits silently reassign historical identity. Sibling targets must remain independent.

## 9. Stream and Recording Management

The Worker currently creates/reuses Streams and creates capture attempts; the API exposes their persisted history. Repeated live observations may use one Stream; a failed capture can be retried within it; a later broadcast has a new Stream.

Preserve Recording session_id, watch_target_id, timestamps, output_file, and lifecycle across the compatibility boundary. stream_id is known in memory for new captures but omitted by legacy sessions adapters. Unknown historical links must remain explicit, not invented.

Future relational persistence must enforce valid relationships and retain relevant historical context. A target edit must not cause the UI to present a past recording as though it used new settings.

Recording files remain local. Optional export is separate from capture/history validity.

## 10. Recording Orchestration and Future Jobs

```text
CURRENT:
Worker polls configuration -> detects live -> starts capture

FUTURE WAVE 06:
API / Redis-BullMQ -> Recording Job -> Worker
```

Both flows keep long-running capture outside HTTP requests. Queue-backed jobs are not yet implemented and are not a prerequisite for Wave 05.

Future job payloads must identify the correct WatchTarget, Stream/Recording as appropriate, and enough configuration context for execution. Resolve that target's preference, not a Creator-wide quality default.

Never include OAuth tokens, credentials, or other secrets directly in job payloads. Define retry/idempotence, duplicate-work prevention, and state reporting when queue integration is planned.

## 11. Worker Execution Responsibilities

Worker is the media/operational execution layer, not the owner of all product policy.

Preserve configuration loading, lifecycle updates, local output, operational diagnostics, and failure handling. Keep it independently executable/restartable where its integration allows; future persistence dependencies need explicit recovery behavior.

Current protections to retain:

- Disabled or invalid targets perform no new probes/captures; active captures and pending terminal persistence continue independently.
- Configuration is refreshed before launch; removal, disablement, invalid required fields, or changed URL blocks launch.
- LIVE/OFFLINE/ERROR remain distinct; ERROR does not prove a broadcast ended.
- Quality fallback is runtime-only and does not overwrite the saved preference.
- WatchTarget URL is authoritative.
- Shutdown terminates/reaps children and records appropriate failure outcomes.
- Persistence failure must not become false durable success.

Do not add auth, REST serving, public media indexing, or user-facing business decisions to the Worker.

## 12. Streamlink

Isolate Streamlink invocation and response handling behind clear functions/helpers. Keep platform-specific behavior from spreading through the entire Worker or duplicating the pipeline.

The boundary must support probe/capture launch, requested/effective quality selection, process-exit detection, bounded error handling, safe termination, and resource cleanup.

The current container pin is streamlink==8.6.1. Tests should fake process/platform behavior and should not depend on the developer host Streamlink version.

A successful probe is not successful capture. If no runtime variant is selectable, do not report a successful recording.

## 13. FFmpeg and Final Media Handling

Use FFmpeg only when the media pipeline requires remuxing, container conversion, format normalization, processing, or justified transcoding. Avoid expensive transcoding by default.

The intended local pipeline is:

```text
Stream -> Worker -> Streamlink -> FFmpeg / final media handling
       -> Local Recording Storage -> Recording completed
```

Current Worker explicitly launches Streamlink with an .mp4 filename and has FFmpeg available in the image. It does not separately invoke a finalization command. Do not describe the conceptual FFmpeg stage as already implemented.

Current success checks process outcome plus existing non-empty output. A filename suffix or fake media fixture does not prove a valid MP4 or playability. Any future finalization requirement needs actual format/output validation and tests for failure/partial cleanup.

## 14. Recording Lifecycle and Observable State

Current shared states:

```text
idle / offline / recording / finished / error
```

These are the existing vocabulary, not a required sequence through all five states. Capture attempts use recording -> finished/error. Probe LIVE/OFFLINE/ERROR is a different classification.

Future PENDING -> RECORDING -> COMPLETED with ERROR outcomes is conceptual. Preserve current finished success until an explicit migration changes the contract consistently across API, Worker, persistence, and frontend.

Do not introduce mandatory UPLOADING into the Recording lifecycle. A separate future CloudExport may use PENDING/UPLOADING/COMPLETED/FAILED while Recording remains COMPLETED.

Display failure and stale/unavailable status honestly. There is no current Worker heartbeat; a successful API response or retained active state cannot prove Worker liveness.

## 15. Local Storage, Access, and Retention

Completed local files are retained user data. Local recording success does not require cloud storage or an export.

Keep OUTPUT_DIR and target-relative recording_subdir boundaries. Preserve read-only API browsing, traversal/symlink restrictions, and safe missing-file/unavailable-directory responses. Current browsing is not playback, download, public serving, or native Explorer opening.

Temporary files and partial captures need controlled, owned cleanup. Do not remove valid local output because export failed or because a capture subprocess finished.

Waves 07/07.5 extend local file lifecycle, management, limits, and configurable policies. Later local/cloud retention may differ. Do not impose universal seven-day deletion or automatically remove recordings without configured policy. Cleanup must be explicit, idempotent, and reflect actual deletion outcomes in metadata.

## 16. Frontend Responsibilities and Creator Organization

The frontend is a management/monitoring UI. Business rules, validation authority, and future authorization belong to the API.

Current Next.js dashboard supports Creator groups, targets, Streams, Recordings, diagnostics, and polling. Targets can be created/deleted, enabled/disabled, and edited for quality, URL, and folder.

Creator should organize WatchTargets so the user can understand configurations such as Best, 1080p, and 720p as independent rows/settings. Selecting or creating a display name currently establishes grouping; do not imply an independent Creator mutation endpoint exists.

Preserve loading/error/stale-data handling and mutation reconciliation. A failed edit must not leave a false saved value. Open Stream is validated external navigation, not proxying or playing recorded media.

Do not access shared JSON, start Worker processes, or run media tools from the frontend.

## 17. Recording Views and Filters

Present enough information to understand Creator/WatchTarget origin, known Stream relationship, Recording state, timestamps, and local output location.

Develop grouping/filtering by Creator, WatchTarget, status, and date progressively within approved scope. Current Recording target filtering and Stream/history views must continue to work; do not claim every future filter exists.

Show absent legacy stream_id as unknown/not persisted. Preserve history when a file is missing rather than pretending metadata disappearance is successful cleanup.

Use the existing safe location browser/folder picker. Do not expand the MVP into an advanced media library, public video service, or analytics dashboard.

## 18. Polling and Future Real-Time Status

Current frontend polling is acceptable during transition. It refreshes the domain collections every five seconds while visible; Worker default polling is 60 seconds plus probe time. Faster UI refresh does not accelerate detection.

There is no current SSE or WebSocket. Wave 08 plans SSE plus Worker heartbeat; prefer SSE unless investigation justifies a different transport. WebSocket remains a possible target capability, not a second required implementation.

Persist lifecycle state so future realtime delivery can consume it. Keep transport availability, persisted state freshness, and actual Worker liveness distinct.

## 19. Persistence Foundation

Current shared files serve different purposes:

| File | Role |
| --- | --- |
| watchlist.json | Configuration and name-derived Creator identity |
| channels_status.json | Operational runtime snapshot |
| streams.json | Broadcast history |
| sessions.json | Legacy Recording history without persisted stream_id |

Wave 05 plans PostgreSQL for Creator, WatchTarget, Stream, and Recording. Use normalized entities, explicit relationships, appropriate constraints/indexes, reproducible migrations, and compatible IDs/timestamps.

Separate domain storage from operational communication. channels_status.json may remain during transition; do not delete every JSON in one replacement. Reuse existing repository/adapters and preserve ongoing Worker writes.

Existing local data needs backup, explicit import, idempotence, malformed-data handling, and rollback. Missing historical links and timezone-free timestamps require honest migration policy.

User/auth belongs to 05.5, Redis/BullMQ to 06, and Tags to 06.5. Do not create fictitious user_id fields or cloud tables merely to anticipate those waves. Follow the [Wave 05 task](../tasks/wave-05/01-postgresql-domain-persistence.task.md) for concrete persistence acceptance.

## 20. Security, Validation, Errors, Logging, and Configuration

Security applies to the implemented slice now; later security features must be delivered with their corresponding functionality.

Current obligations:

- Private local files; no public recordings, public media URLs, indexing, streaming, or redistribution.
- Safe filesystem containment, recording_subdir validation, controlled subprocesses, and appropriate service permissions.
- Explicit structured errors for validation, not found, persistence, filesystem, Worker, and platform/network failures; no silent success after failure.
- No stack traces or secrets exposed to API consumers.
- Structured logging for probes, recording lifecycle, persistence/recovery, and process failures, using bounded secret-safe diagnostics.
- No logged passwords, OAuth tokens, JWT/session secrets, Authorization headers, sensitive personal data, or raw private URLs.
- Environment/configuration-layer settings; no hardcoded real secrets, database passwords, production URLs, or cloud credentials. Safe local defaults are allowed.

The current unauthenticated console is intended for a trusted local environment; it is not a secured Hosted Mode.

Wave 05.5 must introduce stable User identity, account fields including unique email according to the account model, password hashes for password authentication, and safe token/session handling. Never store plaintext passwords; use Argon2/bcrypt or equivalent according to chosen dependencies.

Enforce ownership in backend services/queries: User A must not access User B's resources. Frontend visibility is not authorization. Add register/login/protected-route/user-isolation tests when that functionality exists.

Future cloud credentials must be encrypted/protected at rest, excluded from normal responses/logs/jobs/Git, and handled by isolated provider services. Queue, auth, and cloud errors need their own categories when implemented.

Users remain responsible for copyright/platform compliance. Terms/disclaimers are required before broad publication. Do not remove these obligations because storage is local.

## 21. Testing Priorities

Use deterministic tests and existing frameworks. Automated tests must not require Twitch/YouTube/Kick, real live channels, or external platform availability. Use fake Streamlink/process boundaries and isolated storage; later DB integration uses an isolated local test database.

Mandatory domain scenario:

```text
One Creator
├── WatchTarget A
├── WatchTarget B
└── WatchTarget C
```

Verify different settings, independent edit/disable/delete, correct target execution context, and unchanged siblings.

Cover the implemented scope:

- API modern/legacy regression, grouping, filters, validation, and adapter round trips.
- IDs, timestamps, persistence, missing/malformed data, and restart/recovery.
- Stream reuse, later broadcasts, multiple Recording attempts, and lifecycle outcomes.
- LIVE/OFFLINE/ERROR, enabled, authoritative URL, adaptive fallback without preference mutation.
- Launch/process/persistence failures, pending terminal writes, shutdown/reaping, and safe cleanup.
- Filesystem containment, missing files, unavailable directories, permissions, and private output.
- Frontend loading/error/edit reconciliation, proxy behavior, and component interactions.

Add Creator CRUD/relational integrity/migration/DB-outage tests in Wave 05, auth/user isolation in 05.5, job payload/retry/idempotence in 06, Tags in 06.5, and provider/export/retention tests in their later waves.

Do not confuse:

```text
container running != API healthy != probe successful
                  != capture successful != playable media
```

Fake-Streamlink smoke verifies integration behavior, not real-platform recovery or media playability. Record optional authorized live/manual checks separately. Never point tests at normal runtime-data or user recordings.

Run relevant existing API Jest, Worker unittest/pytest, frontend component/proxy, and isolated Docker smoke checks when behavior changes require them. Do not run mutating lint as though it were a read-only check. Documentation-only work should use document/diff/scope validation.

## 22. Infrastructure and Deferred Milestones

Current local Docker Compose runs frontend, api, and worker with shared runtime-data and recording mounts. API recording access is read-only; frontend uses the API proxy. Preserve Windows/Docker Desktop operation and safe configuration precedence.

PostgreSQL and Redis join only in their planned waves, with appropriate local persistence, health/readiness, configuration, and recovery. Do not require Kubernetes, clusters, expensive managed services, GPU processing, or unnecessary microservices.

The active task controls implementation scope. The roadmap includes PostgreSQL (05), User/auth (05.5), queue/jobs (06), Tags (06.5), local storage/management (07/07.5), SSE/heartbeat (08), Tauri 2 (08.5), and optional cloud (09 onward). Full roadmap/status stays in PROJECT-STATUS.md.

Tauri is a shell/native integration layer. Embedded PostgreSQL, Redis packaging, API/Worker sidecars, FFmpeg packaging, and Python bundling are Wave 08.5 decisions.

Hosted Mode and invite limits are later optional work; a simple future VPS deployment must not become a Local Mode dependency.

## 23. Optional Cloud and Other Non-Goals

```text
Completed Local Recording -> Optional Cloud Export
                          -> Google Drive / Dropbox / OneDrive
```

Cloud is outside the main MVP completion criterion. A failed export does not invalidate local success. Prefer separate Recording and CloudExport lifecycles and isolate provider-specific behavior.

Do not prematurely add advanced scheduling, smart collections, analytics/viewer metrics, advanced metadata, distributed Workers, autoscaling, GPU/transcoding infrastructure, email verification, password recovery, 2FA, admin systems, complex permissions, or advanced notifications.

Public profiles/media sharing/indexing/streaming are outside the current product scope, not automatically promised future features. Tags and basic planned capabilities must follow their waves rather than the old deferred-feature list.

## 24. Definition of Done

The target local-first MVP is complete when the scenario in section 5 works reliably: independent targets are managed, recording execution succeeds locally, history persists, files remain accessible, and status/failures are observable.

For each wave/feature, require as applicable:

- Correct domain boundaries, relationships, and historical context.
- API validation and business rules in the correct layer.
- Correct Worker/media behavior and queue jobs only when the wave requires them.
- Explicit errors, useful safe logs, and relevant security protections.
- Deterministic tests and required checks passing.
- Existing behavior preserved and documentation/status updated when necessary.
- No unrelated complexity or premature future feature.

Cloud export, Hosted Mode, Tauri packaging, SSE, and later retention policies are not premature acceptance requirements for the active slice. Persisted profile/auth and queue behavior remain explicit milestone work, not claims about the Wave 04.75 baseline.

## 25. AI Agent Execution Rules

Before changing an MVP feature:

1. Inspect code, branch, working tree, active task, and applicable instructions.
2. Identify the layer, domain entities, relationships, and current contracts.
3. Reuse existing API, persistence, Worker, frontend, and testing patterns.
4. Implement the smallest incremental change satisfying the active scope.
5. Preserve unrelated pre-existing/staged work and explain cross-module changes.
6. Add/update relevant tests and verify compatibility and failure behavior.
7. Distinguish current implementation, target design, test evidence, and remaining gaps.
8. Follow task lifecycle and Coordinator/Sol/Terra/Luna validation and review rules in project instructions.
9. Avoid unnecessary dependencies, abstractions, infrastructure, and unrelated rewrites.
10. Do not automatically stage, commit, push, or mark planned future work done.

The API/Worker separation, independent WatchTargets, local recording destination, secure boundaries, and testability must guide the slice. Prefer a simple solution that preserves real extensibility over speculative infrastructure.
