---
description: Durable local-first architecture, domain, security, engineering, and agent workflow rules for StreamRecorder Clone.
applyTo: "**/*"
---

# StreamRecorder Clone — Project Instructions

## 1. Project Context

StreamRecorder Clone is a personal, portfolio-oriented application inspired by StreamRecorder. It monitors and records live streams from Twitch, YouTube, and Kick.

The product should demonstrate reliable domain modeling, media execution, persistence, testing, and secure operation while remaining practical for one developer to maintain. Technical quality is measured by working, understandable behavior and evidence, not by the number of technologies introduced.

These instructions define durable rules. Statements marked **current** describe the verified Wave 04.75 baseline; **target**, **future**, and wave references describe work that has not necessarily been implemented. Inspect the actual code before acting.

## 2. Product Direction — Local First

**Local Mode is the primary product mode. Hosted Mode is future and optional.**

The application must first work robustly on the user's computer. Local execution is not merely a development environment.

The main workflow must not require a VPS, remote deployment, hosted backend, Google Drive, Dropbox, OneDrive, cloud storage, or external/cloud OAuth. Capturing a platform stream still requires access to that platform; local-first does not imply offline media capture.

Local Recording Storage is the primary destination. Completed local files are retained user data. Optional export cannot redefine a valid local recording as failed or make a cloud account mandatory.

Hosted deployment will be planned in later waves without replacing Local Mode.

## 3. Development Philosophy

This is a solo-developed project. Prioritize low infrastructure cost, simple operation, clear domain separation, reliability, and maintainability.

Prefer:

- Simple, explicit architecture and well-defined entities.
- Modular services and small, focused functions.
- Dependency injection where appropriate.
- Repository abstractions when they isolate real persistence concerns.
- Background execution for long-running work; queue jobs when the active wave requires them.
- Structured logging, predictable error handling, and testable components.
- Minimal necessary media processing and controlled temporary storage.

Avoid enterprise complexity, patterns, dependencies, and infrastructure adopted merely because large systems use them. Every architectural decision must justify its operational and maintenance cost.

## 4. Current Verified Architecture

The Wave 04.75 baseline is:

```text
Browser -> Next.js Frontend / API proxy -> NestJS REST API
                                               |
                                      Shared JSON adapters
                                               |
                                    Python polling Worker
                                               |
                                           Streamlink
                                               |
                                      Local recording files
```

The Worker is an independent process that reads shared configuration and writes operational state/history. The API does not currently dispatch Recording Jobs.

Compose runs only frontend, api, and worker. API and Worker share runtime-data at /data. Worker writes /recordings; API mounts it read-only. The frontend has no filesystem mount.

| Shared file | Current responsibility |
| --- | --- |
| watchlist.json | WatchTarget configuration and name-based Creator identity |
| channels_status.json | Operational/runtime snapshot merged into API responses |
| streams.json | Detected Stream history |
| sessions.json | Legacy Recording history; channel_id maps to watch_target_id |

Shared JSON is transitional persistence and communication for the initial local MVP. Atomic replacement and process-local locks do not provide cross-process transactions, distributed locks, or multi-worker coordination.

The Worker image pins streamlink==8.6.1 and installs FFmpeg. Capture directly invokes Streamlink with an .mp4 output path; no separate FFmpeg finalization step is explicitly invoked. A suffix or fake test output is not proof of playable MP4 media.

The dashboard, target editing, adaptive quality, and recording location browser are implemented. PostgreSQL, persisted User, authentication, Redis/BullMQ, queue-backed Recording Jobs, SSE, Worker heartbeat, cloud integrations, and Tauri are not implemented. Use code to resolve stale statements in historical documentation.

## 5. Target Architecture

The future local architecture may evolve toward:

```text
Tauri 2 Desktop
     |
     v
Next.js Frontend
     |
     v
NestJS API
     |
     +---- PostgreSQL
     |
     +---- Redis / BullMQ
     |
     v
Worker
     |
     +---- Streamlink
     +---- FFmpeg / final media handling
     |
     v
Local Recording Storage
```

This is a target, not the current implementation. The intended completion flow is:

```text
Stream -> Worker -> Streamlink -> FFmpeg / final media handling
       -> Local Recording Storage -> Recording completed
```

Tauri 2 is planned for Wave 08.5 as the desktop shell and native integration layer. Embedded PostgreSQL strategy, Redis packaging, API/Worker sidecars, FFmpeg packaging, and Python bundling are undecided. Resolve them when that wave is planned, not from this conceptual diagram.

## 6. Domain Model

Keep the fundamental distinction explicit:

```text
Creator     = who
WatchTarget = how
Stream      = an actual broadcast occurrence
Recording   = a concrete capture attempt/result
```

This distinction governs schema, API, Worker, frontend, future jobs, and tests. Do not merge entities for implementation convenience.

Conceptual relationships to validate against actual behavior:

```text
Creator -> WatchTarget
WatchTarget -> Stream
WatchTarget -> Recording
Stream -> Recording
```

One Creator may have multiple targets; one detected Stream may have multiple capture attempts. The current Stream references a WatchTarget. Do not invent a direct persisted Creator-to-Stream foreign key or assume broadcasts across targets are already deduplicated.

User, CloudStorageConnection, Tag, and a separate CloudExport are future concepts. Their mention does not authorize creating them in the current wave.

## 7. Creator

Creator identifies the person/content creator being monitored, independently of a recording configuration.

Identity-related information belongs here. Recording quality, resolution, bitrate, recording format, enabled state, and output-folder settings belong to WatchTarget, not Creator. Never add fields such as quality1, quality2, and quality3 to represent multiple configurations.

**Current:** Creator contains id and display_name, derived by name convention from watchlist entries, with channel_name fallback. Creator routes are read-only; independent Creator CRUD and persistent identity do not exist.

**Wave 05 target:** stable independently persisted identity and Creator management. Preserve compatibility for existing name-based references and explicitly handle collisions/renames. A display-name change must not silently reassign historical records.

## 8. WatchTarget

WatchTarget is an independent monitoring/recording configuration associated with a Creator.

```text
Creator
├── WatchTarget A -> Best
├── WatchTarget B -> 1080p
└── WatchTarget C -> 720p
```

Each target has its own identity and settings. Editing, disabling, or removing A must not modify B or C. Creator grouping is a presentation/query concern; preserve separate normalized entities.

Current configuration includes creator_id, channel_name, platform, URL, preferred quality, enabled, and optional recording_subdir. State is exposed using operational data; do not confuse it with static configuration.

Quality is a WatchTarget preference. Adaptive runtime selection may choose an available variant but must not overwrite the persisted preference. The WatchTarget URL is authoritative for probe and capture; do not reconstruct it from Creator identity.

The Worker currently reloads configuration during polling and refreshes it before launch. Preserve guards against removed/disabled targets, invalid required fields, and changed URLs. Disabling a target prevents new work; existing captures and pending terminal persistence follow their current independent lifecycle.

Future jobs must resolve the exact originating WatchTarget and relevant configuration context. Do not substitute a Creator-wide default. Add future format/options/tags only when the active feature requires them.

## 9. Stream

Stream represents a real detected broadcast occurrence, not persistent monitoring configuration. It must never substitute for WatchTarget.

Repeated polls can refer to the same open Stream. A later broadcast receives a new identity. A failed Recording attempt does not necessarily mean the broadcast has ended.

Current Streams retain id, watch_target_id, state, started_at, and optional finished_at. Preserve their history and distinguish confirmed OFFLINE from an uncertain ERROR probe. Do not close a broadcast merely because probing failed or a target was disabled.

## 10. Recording

Recording represents a concrete capture attempt/result. A retry during the same broadcast can create another Recording for the same Stream.

Preserve enough context to understand:

- The originating WatchTarget and relevant Creator identity.
- The Stream relationship when known.
- Requested recording configuration and relevant execution context.
- State, timestamps, local output metadata, and failure information.
- Ownership when introduced in its own wave; export references when separately implemented.

Historical meaning must survive later target edits. Use explicit immutable snapshots or another justified historical-context strategy where needed; do not assume current target settings describe past captures.

**Current:** the identifier is session_id; records include watch_target_id, timestamps, state, and output_file. stream_id exists in Worker memory but both legacy sessions adapters omit it. Do not claim a persisted link or fabricate one when migrating history.

Removing a target currently leaves history. Future relationship/deletion policies must preserve that history deliberately rather than cascade-delete it by convenience.

## 11. Recording Lifecycle

Use explicit state transitions and consistent contracts across persistence, API, Worker, frontend, and future queue/realtime layers.

The current shared state vocabulary is:

```text
idle
offline
recording
finished
error
```

These values are not all sequential capture stages. Current capture attempts normally progress from recording to finished/error. Successful completion uses finished, not COMPLETED.

Probe classification is separate:

```text
LIVE / OFFLINE / ERROR
```

ERROR must not be treated as OFFLINE. Current success requires a non-interrupted subprocess, zero exit code, and an existing non-empty output; these checks alone do not prove container format or playability.

A possible future Recording lifecycle is PENDING -> RECORDING -> COMPLETED, with ERROR outcomes. If adopted, migrate enum/data/API contracts explicitly; do not silently rename current values.

Optional export should have a separate lifecycle, for example:

```text
Recording.state = COMPLETED
CloudExport.state = PENDING -> UPLOADING -> COMPLETED
                                  |
                                  v
                                FAILED
```

A local Recording may remain COMPLETED while CloudExport is FAILED. UPLOADING is not a mandatory stage of local recording success.

## 12. API Responsibilities

The API is the application/domain and exposure layer:

```text
Controller -> Service -> Repository -> Persistence
```

Controllers stay thin. Services apply application/domain rules. Repositories handle persistence. Adapters isolate physical formats and legacy contracts. Keep filesystem access in the existing dedicated service boundary.

**Current API:** NestJS REST, DTO validation, Creator grouping/reads, WatchTarget configuration CRUD, Stream/Recording reads, legacy compatibility, and safe read-only recording-location browsing.

**Target API:** stable relational domain management, then ownership/authentication, then queue/job orchestration and later optional integration management as their waves arrive. /auth, /users, cloud resources, and Creator mutations are not existing routes.

The API must not execute an hours-long capture inside an HTTP request. Frontend validation and UI restrictions do not replace API validation or future backend authorization.

## 13. Worker Responsibilities

Worker is the operational/media layer. It should not accumulate user-facing business policy, authentication, or persistence rules that belong to API services/repositories.

Its responsibilities include resolving execution configuration, observing streams, starting capture, monitoring subprocesses, reporting lifecycle outcomes, handling operational failures, and cleaning up owned temporary resources.

Preserve the verified baseline:

- LIVE/OFFLINE/ERROR classification without false broadcast termination.
- Enabled enforcement and pre-launch configuration refresh.
- Authoritative URL and adaptive quality without preference mutation.
- Local output and separate Stream/Recording lifecycle.
- Pending terminal-persistence recovery.
- Cooperative subprocess termination and reaping on shutdown.

Isolate Streamlink behind clear helpers/services; avoid scattering platform behavior throughout the Worker or duplicating the full pipeline for each platform. Detect launch, probe, capture, and process-exit failures.

Use FFmpeg only for required container conversion, remuxing, normalization, or justified transcoding. Avoid costly transcoding by default. Installed FFmpeg is not evidence of explicit finalization.

Keep Worker independently executable/restartable from the API where the integration allows it. Future DB/API dependencies need explicit unavailability/recovery behavior; do not promise disconnected operation without support.

Cleanup must target owned temporary/partial resources under an explicit policy. Preserve valid completed local media and do not mask persistence failure as successful durable completion.

## 14. Background Jobs

Long-running recording is asynchronous to HTTP.

```text
CURRENT:
Worker polling -> capture attempt -> local file and JSON history

FUTURE WAVE 06:
API / Redis-BullMQ -> Recording Job -> Worker -> local file
```

The future API should validate the target, resolve execution context, persist/schedule work, and return promptly. Worker performs the long-running operation and reports progress/outcome.

Job payloads should contain stable IDs and sufficient configuration references/snapshots to execute the intended target. They must never directly contain OAuth tokens or other secrets. Resolve credentials through the appropriate backend/provider boundary when such features exist.

Define job retries, duplicate execution, status persistence, and failure recovery when Wave 06 is planned. Do not introduce a queue prematurely during Wave 05 persistence migration.

## 15. Local Recording Storage

Local Recording Storage is the primary final destination, not a disposable buffer awaiting cloud upload.

Keep completed files accessible through local recording management. Distinguish retained output from partial files and temporary processing artifacts. A failed optional export must not delete or invalidate a valid local recording.

Preserve configured root containment: recording_subdir is relative to OUTPUT_DIR, with current sanitized channel-name fallback only for absent/empty overrides. Reject unsafe paths rather than silently accepting traversal or arbitrary destinations.

The API's current browser is read-only and returns location/directory metadata. Preserve symlink/junction restrictions, missing-file states, and root boundaries. It is not download, playback, public serving, or native Explorer integration.

Waves 07/07.5 extend existing local capture/browser functionality with deliberate file lifecycle and storage management; they do not imply local recording is absent today.

## 16. PostgreSQL Principles

**Current:** shared JSON persistence. **Wave 05 target:** PostgreSQL as the primary domain database for Creator, WatchTarget, Stream, and Recording.

- Use normalized entities and explicit relationships.
- Enforce meaningful integrity with foreign keys/constraints where appropriate.
- Index actual lookup, filter, join, status, and later job-processing queries.
- Avoid needless duplication while retaining justified immutable historical context.
- Use reproducible migrations and test clean setup, upgrades, restart persistence, and failures.
- Define timestamp interpretation, identifier compatibility, nullability, transactions, and deletion policies explicitly.

No ORM/query layer is currently selected. Compare Prisma, Drizzle, TypeORM, and direct SQL/query builder using solo maintenance, migrations, type safety, NestJS/PostgreSQL integration, overhead, testability, and future ownership/Tags. Record a justified choice.

Separate domain persistence from operational runtime communication. channels_status.json may remain operational during transition; not every JSON must disappear simultaneously.

Reuse StreamsRepository and adapters where useful. Declare one primary authority per entity, avoid uncontrolled dual writes, and preserve ongoing Worker updates. Migration needs backup, explicit import policy, idempotence, malformed-data handling, and rollback. Follow the Wave 05 plan for concrete acceptance.

Do not add a fictional/nullable user_id merely to anticipate Wave 05.5, or implement Tags, queue infrastructure, or cloud entities in this wave.

## 17. Future User, Authentication, and Ownership

**Not currently implemented; planned for Wave 05.5.**

Local profile/account design must respect Local Mode and not require external OAuth or a hosted identity provider. Do not claim current routes are authenticated.

Future User data should have a stable unique ID, username/account identity, unique email as specified by the account model, password hash for password authentication, creation time, and relevant account timestamps.

Never store plaintext passwords. Use Argon2/bcrypt or an equivalent strong password hashing algorithm appropriate to the selected dependencies. Handle authentication tokens/sessions securely without exposing secrets or unnecessary personal information.

Enforce ownership in backend services/queries. User A must not access User B's resources by changing IDs, filters, or request paths. Frontend restrictions are not an authorization boundary.

Plan ownership for Creators, WatchTargets, Recordings and, when introduced, cloud connections and Tags. Test indirect relationships and user isolation. Security requirements apply when those features are introduced; they do not authorize premature User implementation in Wave 05.

## 18. Optional Cloud Export and Credential Security

Cloud is optional and later:

```text
Completed Local Recording -> Optional Cloud Export
                                +-> Google Drive
                                +-> Dropbox
                                +-> OneDrive
```

Google Drive/CloudStorageConnection/OAuth are planned for Wave 09, export/upload for 09.5, and Dropbox/OneDrive for 10. Local success never requires a connected provider.

Prefer separate Recording and CloudExport lifecycles. Credentials belong to the appropriate authenticated User connection when ownership exists.

OAuth access and refresh tokens must:

- Never appear in logs, normal API responses, or queue payloads.
- Never be committed to Git.
- Be protected and encrypted at rest when persisted.
- Be handled only by appropriate backend/cloud integration services.

Isolate provider-specific behavior behind a small provider/service interface when practical. Upload/delete/folder operations must not leak provider details throughout the domain. Do not create a speculative abstraction for every imagined provider operation.

Future exported files also remain private. Track export failures and retries independently from local recording validity.

## 19. Tags

Tags are planned for Wave 06.5 and are not implemented.

Model Tags as reusable entities rather than duplicated strings scattered across records. They may eventually relate to Creator, WatchTarget, Stream, and Recording.

Decide concrete relationships, ownership, constraints, and filtering needs in that wave. Avoid premature specialized tables or a generic tagging framework without demonstrated requirements.

## 20. API Design

Prefer REST resource-oriented endpoints where appropriate. Existing contracts win over conceptual route examples.

Current domain routes include Creator GETs, WatchTarget GET/POST/PATCH/DELETE, Stream GETs, and Recording GETs with watchTargetId filtering. /streamer and /session remain legacy compatibility boundaries.

Do not imply POST /creators or /creators/:id/watch-targets exists today. Future Creator CRUD must be designed around stable identity and compatibility rather than copying an old illustrative endpoint list.

Preserve response shapes, identifiers, filters, error semantics, and PATCH omission behavior unless a justified migration explicitly changes them. Apply changes consistently through the Next.js proxy and client when necessary.

## 21. Validation

Validate at the API boundary; frontend validation improves UX but is not authoritative.

Validate required fields, identifiers, enums, URLs, supported platform, quality, strict boolean enabled, recording paths, and pagination/filter parameters when supported. Validate authentication inputs when authentication exists.

Preserve current URL rules: absolute HTTP/HTTPS, valid protocol, and no embedded credentials. Preserve quality validation against supported values and normalization semantics.

For recording_subdir and browsing paths, enforce relative-path containment and reject traversal, absolute/drive/UNC paths, control characters, and unsafe symlink/junction access. Keep validation aligned with the filesystem helpers and Windows behavior.

PATCH only changes supplied fields. Empty recording_subdir clears the override; omission leaves it unchanged. Invalid input must produce consistent, actionable errors rather than silently changing unrelated fields.

## 22. Error Handling

Use explicit, structured errors and meaningful categories:

- Validation and not found.
- Worker/media process and platform/network.
- Persistence/database and filesystem.
- Queue/job failures when introduced.
- Authentication/authorization when introduced.
- Cloud provider/export failures when introduced.
- Unexpected internal failures.

Do not swallow meaningful failures in silent catch blocks or merely print an exception and continue as though the operation succeeded. Best-effort cleanup may deliberately tolerate an error, but its scope must be explicit and must not mask the initiating failure.

Never expose internal stack traces or secrets to API consumers. Use safe diagnostics for investigation. Distinguish invalid persisted data from valid empty state, and distinguish probe errors from confirmed offline status.

## 23. Logging

Use structured logging with safe context sufficient to diagnose:

- Stream probes and Worker execution.
- Recording start, progress where supported, completion, and failure.
- Persistence/database, filesystem, and recovery failures.
- Job/queue lifecycle when implemented.
- Optional cloud export and retention cleanup when implemented.

Prefer bounded identifiers, categories, return codes, and sanitized messages. Logs should help correlate operations without dumping private payloads.

Never log passwords, OAuth access/refresh tokens, JWT/session secrets, full Authorization headers, or sensitive personal data. Avoid raw private URLs, raw Streamlink maps/debug output, and credentials in diagnostic messages. Preserve current secret-safe diagnostics.

## 24. Configuration

Use environment variables or a dedicated configuration layer; keep environment-specific settings out of business logic.

Never hardcode real secrets, database passwords, OAuth credentials, JWT/session secrets, cloud credentials, or production URLs. Provide safe local defaults and credential-free examples where needed.

Preserve current non-empty per-file override -> CONFIG_DIR -> local-default precedence. Keep API and Worker pointed at the same runtime storage while JSON communication remains active.

OUTPUT_DIR controls Worker output; RECORDINGS_ROOT controls API browsing. recording_subdir is a target-relative setting, not permission to change arbitrary infrastructure paths. Frontend API_BASE_URL is server-side configuration.

Local Mode must remain operable without cloud configuration. Future database/queue configuration must document local persistence, startup behavior, and recovery.

## 25. Testing Principles

Test domain logic independently and test integration boundaries with the actual contracts.

This is a mandatory scenario:

```text
One Creator
├── WatchTarget A
├── WatchTarget B
└── WatchTarget C
```

Create different configurations and prove that editing, disabling, or deleting one target leaves its siblings unchanged.

Prioritize:

- Domain identity, relationships, configuration validation, and API regression.
- Stream/Recording lifecycle, repeated broadcasts, retries, and historical context.
- Preferred versus effective quality, authoritative URL, and enabled enforcement.
- Persistence round trips, malformed/missing data, restart/reload, and recovery.
- Worker compatibility, subprocess failures/shutdown, and terminal-persistence errors.
- Filesystem containment, permissions, missing output, and safe cleanup.
- Frontend loading/error/reconciliation and relevant proxy/component behavior.

Automated tests must be deterministic and must not depend on Twitch, YouTube, Kick, real live streams, or platform network availability. Mock/fake Streamlink and process boundaries; use isolated storage and later an isolated local test database. Never use real runtime-data or user media as fixtures.

Add database migration/unavailability tests in Wave 05; auth/ownership and user-isolation tests in 05.5; queue/job payload/retry tests in 06; Tags tests in 06.5; cloud provider/export and retention tests in their waves. Future test categories do not expand current implementation scope.

Keep these evidence levels distinct:

```text
container running
!= API healthy
!= probe successful
!= capture successful
!= playable media
```

Existing fake-Streamlink Docker smoke validates deterministic integration, not a real playable MP4. Report actual commands/results, historical evidence, and unperformed manual checks separately. Use existing test frameworks and focused tests before the required affected-suite validation.

## 26. Architecture Boundaries

Maintain Controller -> Service -> Repository -> Persistence separation. JSON adapters currently implement compatibility boundaries; future DB adapters must not move application rules into controllers.

Worker owns long-running operational execution and media/process helpers. API owns user-facing business rules and future orchestration policy. Current Worker polling is an explicit transitional responsibility.

External platform/cloud integrations belong behind appropriate helpers/providers. Frontend must not access shared JSON directly, run media tools, or become a second business-rule implementation.

Do not require every boundary to become a generic interface. Add seams where they support the actual migration, testability, or external dependency.

## 27. Naming Conventions

Use Creator, WatchTarget, Stream, and Recording consistently. Use User and CloudStorageConnection for their future domain concepts; use CloudExport consistently when it is formalized.

Streamer, Session, and channel_id may remain in legacy routes/adapters. Do not propagate legacy names into new domain objects without a distinct reason. Preserve existing session_id contracts until explicitly migrated.

Avoid alternative names such as Target, Monitor, Capture, or Video for the same entity unless they have a clearly different domain meaning.

## 28. Backward Compatibility

When modifying behavior:

1. Inspect the existing implementation.
2. Understand current API, persistence, and Worker contracts.
3. Preserve working behavior where possible.
4. Refactor incrementally.
5. Avoid unrelated module rewrites.
6. Add/update tests around changed behavior.

Do not replace working code for stylistic preference. Wave 05 must preserve current installations, route behavior, JSON compatibility where needed, and local recording operation during transition. Never assume all historical relationships can be reconstructed from incomplete legacy data.

## 29. Avoid Premature Abstraction

Before adding an abstraction, ask:

1. Does it solve an actual current problem?
2. Does it improve testability?
3. Does it isolate an external dependency?
4. Does it help the next real planned feature?
5. Does that benefit justify its complexity?

Prefer the smallest maintainable solution. Extensibility is a reason to preserve useful boundaries, not to build infrastructure for every hypothetical future feature.

## 30. Security and Compliance

Recordings are private local files. Do not publicly expose, index, create public media URLs for, stream publicly, or intentionally redistribute recordings through the application. Future cloud files must also remain private.

Users are responsible for ensuring their recording use complies with applicable copyright and platform rules. Provide appropriate Terms of Use/disclaimers before broader publication. These are product requirements, not a claim that compliance/release work is complete.

Prioritize credential protection, future user isolation, safe filesystem and temporary-file handling, controlled Worker execution, and secure OAuth when introduced. Local-first does not remove security obligations.

Preserve path containment, appropriate service permissions, and bounded subprocess handling. Do not treat the current unauthenticated local console as a hardened hosted service.

## 31. Infrastructure Constraints

Local Mode is the primary constraint. Keep operation economical and simple on the user's computer.

Docker Compose remains a supported development/local runtime workflow. Avoid Kubernetes, clusters, unnecessary microservices, expensive managed services, GPU requirements, and distributed workers without concrete need.

PostgreSQL and Redis may join the local topology in their respective waves; they are not current Compose services. Persist metadata/media across ordinary restarts and keep destructive cleanup explicit.

A future Hosted Mode may start with a simple single-VPS topology, but this is not a Local Mode prerequisite. Desktop service packaging remains a Wave 08.5 decision.

## 32. Roadmap and Development Priority

[PROJECT-STATUS.md](../../PROJECT-STATUS.md) is the human status/roadmap reference; these instructions retain durable rules rather than a duplicate full roadmap.

Near-term boundaries: Wave 05 PostgreSQL/domain persistence; 05.5 User/authentication/ownership; 06 Redis/BullMQ/Recording Jobs; 06.5 Tags; 07/07.5 local file lifecycle and management; 08 SSE/heartbeat; 08.5 Tauri 2; 09 onward optional cloud; Hosted Mode in later phases.

Use the [Wave 05 plan](../tasks/wave-05/README.md) for its concrete task scope. Future numbering may evolve. Planned diagrams and future security requirements are not evidence of implementation or permission to expand an active task.

## 33. AI Agent Behavior

When modifying the project, the AI agent must:

1. Inspect current implementation, task scope, branch, and working tree.
2. Follow the current architecture unless there is a concrete reason to change it.
3. Prefer incremental changes.
4. Avoid unrelated refactors.
5. Explain cross-module architectural changes and their compatibility effects.
6. Reuse existing utilities and patterns where appropriate.
7. Add/update relevant tests for behavioral changes and run appropriate validation.
8. Keep domain terminology consistent.
9. Consider applicable security, file/process safety, and future ownership boundaries.
10. Avoid unnecessary dependencies.
11. Avoid unjustified infrastructure or operational complexity.
12. Respect active-wave scope and defer later features.
13. Distinguish planned, implemented, tested, and unverified behavior.
14. Preserve pre-existing user changes, including staged work.

When ambiguous, choose the smallest solution that preserves real extensibility. Inspect entities, controllers, services, repositories, adapters, Worker code, and relevant tests before significant architectural work.

Documentation-only tasks require document/scope validation, not runtime changes to satisfy unrelated tests. Report contradictions outside scope instead of silently rewriting additional files.

## 34. Definition of Done

A feature is complete when, as applicable to its wave:

- Domain model and persistence relationships are correct.
- API validation exists and business rules are in the right layer.
- Worker behavior and required background-job behavior are correct.
- Errors are handled and logs support diagnosis safely.
- Relevant deterministic tests exist and required checks pass.
- Existing functionality and compatibility are preserved.
- Applicable authorization, credential, filesystem, and process security are preserved.
- Documentation/status is updated when necessary and limitations are explicit.
- No unrelated complexity or later-wave feature was introduced.

Do not make future auth, queue, cloud, realtime, or desktop capabilities premature acceptance prerequisites. Follow the task lifecycle/human acceptance rules below; no automatic commit or push is implied.

## 35. Frontend Responsibilities

The frontend is the management/monitoring interface. API validation and business rules remain authoritative.

Organize WatchTargets by Creator so several independent configurations are understandable. Present recording origin, state, timestamps, and local location with progressive filtering as planned. Do not turn the MVP into an advanced media library.

Preserve current loading, error, stale-data, mutation reconciliation, and polling behavior. The current browser/folder picker is server-storage metadata navigation, not a native folder dialog or media server. Open Stream is validated external browser navigation.

## 36. Real-Time Status

Current frontend and Worker status observation uses polling; no SSE, WebSocket, or Worker heartbeat exists.

Wave 08 plans SSE plus Worker heartbeat. Prefer SSE for that wave unless investigation justifies another transport; WebSocket remains a possible target capability, not an implemented or mandatory extra transport.

Keep persisted state consumable by future realtime updates. Polling is acceptable during transition. Do not infer Worker liveness from successful API requests or an old recording state.

## 37. Retention and Cleanup

Retention is configurable future policy, not a universal mandatory seven-day rule. File lifecycle/limits belong to Waves 07/07.5, with later local/cloud retention policy work.

Do not automatically delete valid recordings without a configured policy. Local and cloud policies may differ. Temporary/partial cleanup must have clear ownership and must not accidentally remove retained files.

Future cleanup should identify eligible files, perform deletion safely and idempotently, and update metadata according to the actual outcome. Keep enough metadata to locate the relevant local/remote object. Failed deletion must not be reported as successful deletion.

# 38. Project Language and Documentation

The project uses **English as the standard language for all technical artifacts and development-related content**.

## 38.1 Code, Comments, and Commits

All technical content committed to the repository must be written in English.

This includes:

* Code comments;
* Commit messages;
* TODOs and FIXMEs;
* Variable, function, class, method, and type names;
* Database/entity terminology;
* API documentation;
* Technical documentation;
* README files;
* Configuration descriptions;
* Error messages intended for developers;
* Log messages intended for developers.

Do not introduce new technical content in Portuguese or another language.

---

## 38.2 Agent Communication

The language used by the AI agent when communicating with the programmer should follow the language used by the programmer.

If the programmer asks a question or provides instructions in Portuguese, the agent should respond in Portuguese.

If the programmer communicates in English, the agent should respond in English.

This rule applies only to the **conversation between the agent and the programmer**.

It does not change the language requirements for project artifacts.

---

## 38.3 Existing Content in Other Languages

When modifying an existing technical file, if comments, documentation, or other non-UI technical text is found in Portuguese or another language, it should be translated into English when the relevant file is being modified.

Do not perform unrelated repository-wide language refactors unless explicitly requested.

The agent should avoid mixing languages within the same technical artifact.

---

## 38.4 User Interface Language

The language of user-facing UI content is independent from the technical language standard.

UI text may use Portuguese, English, or another language according to the product requirements.

For example:

```text
Technical code      → English
Code comments       → English
Commit messages     → English
Technical docs      → English
Developer logs      → English

User-facing UI      → Product-defined language
```

Do not translate user-facing UI text into English merely to satisfy this rule.

---

## 38.5 General Rule

When in doubt, use the following rule:

> **English for the project, the programmer's language for the conversation, and the product-defined language for the UI.**

The agent must preserve this distinction consistently across the codebase.

---

# 39. Task Status Lifecycle

Task files use a required operational `status` value:

```text
planned
implement
review/QA
fixing
coordinator-review
user-approve
done
```

The standard flow is:

```text
planned
  -> implement
  -> Coordinator validation
  -> review/QA
       |-> PASS -> user-approve -> done
       |-> CHANGES_REQUIRED -> fixing -> Coordinator validation -> review/QA
       |-> repeated failure or review limit -> coordinator-review
```

Rules:

1. `planned` means implementation has not started.
2. Coordinator or Delegate Coordinator updates `planned -> implement` before the approved plan enters Terra implementation.
3. Terra reports implementation completion while the task remains `implement` or `fixing`. Coordinator or Delegate Coordinator runs the mandatory objective validation gate and updates to `review/QA` only when green, immediately before Luna.
4. Luna `PASS` determines `review/QA -> user-approve`. The receiving Coordinator applies the metadata update after final validation. No commit is automatic.
5. Luna `CHANGES_REQUIRED` determines `review/QA -> fixing`. The receiving Terra applies the metadata update before corrections, then returns to the originating Coordinator; only a green Coordinator validation returns the task to `review/QA` before the next Luna review.
6. Repeated failure, review-limit exhaustion, an architectural conflict, or an unsafe correction loop determines `coordinator-review`. Coordinator retains authority over review limits, blockers, scope changes, re-planning, and whether Sol must be consulted again.
7. From `coordinator-review`, the task may return to `implement` or `fixing` with revised instructions, or become blocked under the existing workflow rules.
8. `user-approve` means implementation and QA are complete but the human gate has not yet accepted completion.
9. A task becomes `done` when the user commits its work or explicitly authorizes/starts the next task. Starting the next task is acceptance of the preceding `user-approve` task, and Coordinator must update it to `done` before or at the beginning of the new execution.
10. Agents must preserve pre-existing changes when updating metadata and must not skip directly from `planned` to `done` without concrete historical evidence for already integrated work.

---

# 40. Agent Workflow Efficiency and Safety

## 40.1 Mandatory Branch Pre-flight

Before the first delegation to Sol for every task:

```text
Task resolved
  -> Expected branch resolved
  -> Git status inspected
  -> Branch verified
  -> Create/switch branch if safe
  -> Sol
```

Coordinator determines the expected branch, checks the current branch and working tree, reuses the correct branch when it exists, and creates it only when absent and safe. Unrelated or unclear local changes require `coordinator-review` or user direction. Never stash automatically, reset, discard changes through checkout, or create a branch while assuming ownership of unclear changes. Wave 02.4 starting on `master` is the justification for this rule, not authorization to rewrite history.

## 40.2 Pipeline Validation Gate

The pipeline remains:

```text
Coordinator -> Sol -> Terra -> Coordinator validation -> Luna -> Coordinator
                                                    -> user-approve -> done
```

After Terra, Coordinator runs the task's objective validation, checks known test/type/syntax failures, unexpected artifacts, scope, and `git diff --check`, and performs required full validation once. Failure returns to `fixing -> Terra`; only a green implementation moves to `review/QA -> Luna`. After Luna `CHANGES_REQUIRED`, the same correction and Coordinator-validation gate repeats before the next Luna review.

```text
Luna CHANGES_REQUIRED
  -> fixing
  -> Terra
  -> Coordinator validation
  -> review/QA
  -> Luna
```

## 40.3 Debugging and Full-suite Budget

Terra follows `failure -> smallest reproducible case -> minimum relevant code -> focused test -> minimal patch -> focused test -> full affected suite once`. Terra may make at most three directed diagnostic attempts for the same cause without convergence; then the task moves to `coordinator-review`. Prefer `rg`, small ranges, one test per hypothesis, and minimal patches. Avoid repeated full-file reads, equivalent searches/commands, redundant temporary scripts, hypothesis-free exploration, and full-suite runs after each small edit.

Focused tests are preferred during implementation. Run the full affected suite once after focused behavior is green, then the required full validation once at the Coordinator gate before Luna.

## 40.4 Handoff Context Budget

> Context is a budget, not a transcript archive.

Use compact role-specific packages:

- Sol receives: `TASK`, `CURRENT RELEVANT STATE`, `ARCHITECTURAL CONSTRAINTS`, `KNOWN DEPENDENCIES`, `RELEVANT FILES`, `EXPECTED OUTPUT`.
- Terra receives: `TASK`, `APPROVED SOL PLAN`, `ACCEPTANCE CRITERIA`, `FILES / AREAS TO MODIFY`, `CONSTRAINTS`, `VALIDATION COMMANDS`, `KNOWN COMPATIBILITY REQUIREMENTS`.
- Luna receives: `TASK`, `APPROVED PLAN`, `FINAL DIFF / MODIFIED FILES`, `TEST RESULTS`, `ARCHITECTURAL DECISIONS`, `KNOWN LIMITATIONS`, `ACCEPTANCE CRITERIA`.

Summarize large outputs, reference specific files/ranges, and do not resend unrelated historical logs, repeated tool output, temporary scripts, failed intermediate attempts, or raw tool-call history. Preserve debugging as `problem`, `hypothesis`, `evidence`, and `result`. An intermediate issue with architectural impact may be summarized in a few lines.

## 40.5 Independent Limits and Luna Efficiency

Terra's limit is three directed diagnostic attempts for the same cause before `coordinator-review`. Luna's separate limit is three formal `review/QA -> fixing -> Coordinator validation -> review/QA` cycles before `coordinator-review`. Never combine these counters.

Luna performs independent QA without editing implementation and focuses on acceptance criteria, regressions, architecture, compatibility, final diff, and validation results. After a green Coordinator gate, Luna does not reconstruct Terra's entire investigation; any additional investigation must be narrowly targeted at the suspected point.
