---
description: Project-wide architecture, domain model, coding standards, and implementation guidelines for the StreamRecorder Clone. Apply these instructions to backend, worker, database, API, and related project files.
applyTo: "**/*"
---

# StreamRecorder Clone — Project Instructions

## 1. Project Context

This project is a personal, portfolio-oriented web application inspired by StreamRecorder.

The application allows users to monitor live streams from supported platforms and record them directly to the user's connected cloud storage.

Supported platforms:

* Twitch
* YouTube
* Kick

Supported cloud storage providers:

* Google Drive
* Dropbox
* OneDrive

The application must avoid permanent video storage on the application server.

The server/workers should act primarily as an orchestration and media-processing layer, while the final recording is stored in the user's connected cloud storage.

The initial implementation should prioritize:

1. Low infrastructure cost.
2. Simple operation by a solo developer.
3. Clear domain separation.
4. Extensible architecture.
5. Reliable background processing.
6. Minimal server-side buffering.
7. Strong technical quality suitable for a professional portfolio.

---

# 2. Current Development Philosophy

This is a solo-developed project.

Do not introduce unnecessary enterprise-level complexity.

Prefer:

* simple and explicit architecture;
* well-defined domain entities;
* modular services;
* small functions;
* dependency injection where appropriate;
* repository abstractions;
* background jobs;
* structured logging;
* predictable error handling;
* testable components.

Avoid introducing technologies, abstractions, design patterns, or infrastructure merely because they are commonly used in large-scale systems.

Every architectural decision should justify its complexity.

---

# 3. High-Level Architecture

The project is divided into the following logical components:

```text
Frontend
   |
   | REST / WebSocket / SSE
   v
Backend API
   |
   +---- PostgreSQL
   |
   +---- Redis / Job Queue
   |
   v
Recording Worker
   |
   +---- Streamlink
   |
   +---- FFmpeg
   |
   v
Cloud Storage
   |
   +---- Google Drive
   +---- Dropbox
   +---- OneDrive
```

The backend is responsible for:

* authentication;
* user management;
* creators;
* watch targets;
* recordings;
* streams;
* tags;
* cloud storage connections;
* recording configuration;
* job creation;
* job status;
* retention management;
* API/WebSocket communication.

Workers are responsible for:

* executing recording jobs;
* monitoring streams;
* invoking Streamlink;
* invoking FFmpeg when required;
* processing the recording;
* uploading/storing the result in the user's cloud storage;
* reporting job progress and failures.

The worker must not become responsible for business-domain decisions that belong to the API/backend.

---

# 4. Domain Model

The system must use explicit domain entities.

Core entities include:

```text
User
Creator
WatchTarget
Stream
Recording
CloudStorageConnection
Tag
```

The relationships must remain explicit.

Conceptually:

```text
User
 |
 +-- CloudStorageConnection
 |
 +-- Creator
       |
       +-- WatchTarget
       |      |
       |      +-- Recording configuration
       |
       +-- Stream
              |
              +-- Recording
```

---

# 5. Creator

A `Creator` represents the streamer/content creator being monitored.

A Creator is independent from a specific recording configuration.

Examples:

```text
Creator
- name: ExampleStreamer
- platform: Twitch
- externalId: ...
```

The Creator should contain identity-related information about the streamer, but should not contain recording-specific configuration.

Do not store recording quality, resolution, bitrate, recording format, or other WatchTarget-specific settings directly on Creator.

---

# 6. WatchTarget

`WatchTarget` is a central domain entity.

A WatchTarget represents a specific monitoring/recording configuration for a Creator.

A single Creator may have multiple WatchTargets.

Example:

```text
Creator: ExampleStreamer

WatchTarget A
- Platform: Twitch
- Quality: Best Available
- Enabled: true

WatchTarget B
- Platform: Twitch
- Quality: 720p
- Enabled: true

WatchTarget C
- Platform: Twitch
- Quality: 480p
- Enabled: false
```

The purpose of this design is to allow the user to customize multiple recording strategies for the same Creator.

WatchTargets must therefore be modeled as independent entities related to Creator.

Conceptually:

```text
Creator 1
   |
   +---- WatchTarget 1
   |
   +---- WatchTarget 2
   |
   +---- WatchTarget 3
```

Never model multiple WatchTargets as duplicated fields inside Creator.

Avoid structures such as:

```text
Creator:
  quality1
  quality2
  quality3
```

Instead:

```text
Creator
  |
  +-- WatchTarget
  +-- WatchTarget
  +-- WatchTarget
```

---

# 7. WatchTarget Responsibilities

A WatchTarget should contain configuration related to monitoring and recording.

Possible configuration includes:

* creator relationship;
* platform;
* target/channel identifier;
* stream URL or external identifier when appropriate;
* enabled/disabled state;
* preferred quality;
* recording format;
* recording options;
* destination/cloud storage configuration;
* tags or metadata when applicable;
* monitoring preferences.

The exact fields should be implemented according to the current database/domain design.

Do not prematurely add fields that are not required by the current feature.

---

# 8. WatchTarget and Quality

Recording quality is a property of a WatchTarget, not a Creator.

This allows the same Creator to have different recording configurations.

For example:

```text
Creator
└── ExampleStreamer

    ├── WatchTarget
    │   └── Best Available
    │
    ├── WatchTarget
    │   └── 1080p
    │
    └── WatchTarget
        └── 720p
```

The worker should receive the resolved WatchTarget configuration when a recording job is created.

The worker should not independently decide which WatchTarget should be used.

The backend is responsible for resolving the configuration.

---

# 9. Creator Grouping

The UI and API should conceptually group WatchTargets by Creator.

Example:

```text
Creator: ExampleStreamer

  Watch Targets
  ├── Best Quality
  ├── 720p
  └── Audio/Low Bandwidth
```

The database should remain normalized.

Grouping is a presentation/query concern, not a reason to denormalize WatchTargets into Creator.

API responses may expose nested structures when useful for the frontend, but the persistence model should preserve separate entities.

---

# 10. Stream

A `Stream` represents an actual live-stream occurrence.

A Creator can have many Streams over time.

Conceptually:

```text
Creator
 |
 +-- Stream #1
 +-- Stream #2
 +-- Stream #3
```

A Stream should represent the actual event/session rather than the persistent monitoring configuration.

Do not use Stream as a replacement for WatchTarget.

Difference:

```text
Creator
    = who is being monitored

WatchTarget
    = how the system should monitor/record that creator

Stream
    = an actual live broadcast detected by the system

Recording
    = the recording produced from a stream
```

---

# 11. Recording

A `Recording` represents a concrete recording job/result.

A recording should preserve enough information to understand:

* which User initiated/owns it;
* which Creator was involved;
* which WatchTarget configuration generated it;
* which Stream it belongs to;
* current status;
* timestamps;
* output metadata;
* cloud storage destination;
* error information when applicable.

The relationship between WatchTarget and Recording is important.

A recording must retain the WatchTarget context that generated it.

This prevents historical recordings from becoming ambiguous if the WatchTarget configuration is later modified.

Prefer storing the relevant immutable/snapshot information in the recording/job context when necessary instead of assuming the WatchTarget will never change.

---

# 12. Recording Lifecycle

Recording jobs should use explicit states.

Recommended conceptual lifecycle:

```text
PENDING
   |
   v
RECORDING
   |
   v
UPLOADING
   |
   v
COMPLETED
```

Failure can occur from any processing stage:

```text
PENDING
RECORDING
UPLOADING
   |
   v
ERROR
```

The exact enum names should remain consistent throughout:

* database;
* backend;
* worker;
* queue;
* WebSocket/SSE;
* frontend.

Do not use different names for the same state in different layers.

---

# 13. Background Jobs

Recording must be asynchronous.

The API should not keep an HTTP request open for the entire duration of a live stream.

Expected flow:

```text
API
 |
 | create recording job
 v
Redis / Queue
 |
 v
Worker
 |
 +-- Streamlink
 |
 +-- FFmpeg
 |
 v
Cloud Storage
```

The API should return quickly after successfully scheduling the job.

Workers should be independently executable and restartable.

---

# 14. Worker Responsibilities

Workers should focus on execution.

A worker should:

1. Receive a recording job.
2. Load the required configuration.
3. Resolve the stream.
4. Start Streamlink.
5. Process/transcode through FFmpeg when required.
6. Upload/store the recording.
7. Update recording status.
8. Report errors.
9. Clean up temporary resources.

Workers should not contain large amounts of business logic.

Business decisions should remain in backend services.

---

# 15. Temporary Storage

The application server should not be used as permanent video storage.

Temporary files may exist when technically necessary for FFmpeg or cloud-upload operations.

Temporary media must:

* have a controlled lifecycle;
* be removed after successful processing;
* be removed after recoverable failures when possible;
* not become permanent application data.

Prefer streaming/progressive upload strategies when supported by the selected cloud provider and recording pipeline.

---

# 16. Database Principles

PostgreSQL is the primary persistent database.

Use normalized relational entities.

Prefer:

```text
users
creators
watch_targets
streams
recordings
cloud_storage_connections
tags
...
```

with explicit foreign-key relationships.

Do not duplicate domain data unnecessarily.

Foreign keys should enforce important relationships.

Use indexes for fields frequently used in:

* lookup;
* filtering;
* joins;
* status queries;
* background job processing.

---

# 17. Multi-User Architecture

The application must support multiple users from the beginning.

Every user-owned resource must have a clear ownership boundary.

At minimum, consider ownership for:

```text
User
 ├── Creators
 ├── WatchTargets
 ├── Recordings
 ├── CloudStorageConnections
 └── Tags
```

A user must never be able to access another user's resources through an API endpoint.

Authorization should be enforced at the service/query level rather than relying exclusively on frontend restrictions.

---

# 18. Authentication

The project uses basic authentication with multiple accounts.

User information includes:

* unique ID;
* username;
* unique email;
* password hash;
* creation date;
* relevant account timestamps.

Passwords must never be stored in plaintext.

Use a strong password hashing algorithm such as bcrypt/Argon2 according to the project's established dependencies.

Authentication tokens/sessions must not expose sensitive user information unnecessarily.

---

# 19. Cloud Storage

Cloud storage credentials belong to the authenticated User.

Conceptually:

```text
User
 |
 +-- Google Drive Connection
 +-- Dropbox Connection
 +-- OneDrive Connection
```

OAuth access tokens and refresh tokens are sensitive credentials.

They must:

* never be returned in normal API responses;
* never be logged;
* never be committed to Git;
* be encrypted at rest when persisted;
* be handled only by the appropriate backend/cloud-storage services.

Cloud providers should be abstracted behind a common interface where practical.

Example conceptual interface:

```text
CloudStorageProvider
  upload()
  delete()
  createFolder()
  ...
```

Provider-specific implementations should remain isolated.

---

# 20. Retention

The application has a 7-day retention policy.

Recordings older than the configured retention period should be automatically removed from the user's cloud storage.

The deletion process should be:

```text
Scheduled Job
      |
      v
Find expired recordings
      |
      v
Delete remote file
      |
      v
Update database
```

The database must preserve enough metadata to locate the remote file.

Deletion must be idempotent where possible.

A failed deletion should not silently appear as a successful deletion.

---

# 21. Tags

The database should support a flexible tagging system.

Tags may eventually be associated with:

* creators;
* watch targets;
* streams;
* recordings.

Tags should be modeled as reusable entities rather than duplicated strings everywhere.

Avoid prematurely creating many specialized tag tables if a generic relational tagging model is sufficient.

---

# 22. API Design

The API should follow REST principles where appropriate.

Use resources rather than action-heavy endpoints.

Prefer:

```text
GET    /creators
POST   /creators
GET    /creators/:id
PATCH  /creators/:id
DELETE /creators/:id
```

and:

```text
GET    /creators/:id/watch-targets
POST   /creators/:id/watch-targets
PATCH  /watch-targets/:id
DELETE /watch-targets/:id
```

The exact routes should follow the existing backend conventions.

Do not break established API contracts without a clear reason.

---

# 23. Validation

Validate input at the API boundary.

Do not trust frontend validation.

Validate:

* required fields;
* enum values;
* IDs;
* URLs;
* platform values;
* recording configuration;
* authentication input;
* pagination/filter parameters.

Invalid input should produce consistent HTTP errors.

---

# 24. Error Handling

Errors should be explicit and structured.

Avoid:

```text
catch (error) {
  console.log(error);
}
```

Prefer structured logging and meaningful application errors.

Errors should distinguish between:

* validation errors;
* authentication errors;
* authorization errors;
* not-found errors;
* external API errors;
* worker errors;
* cloud-storage errors;
* unexpected internal errors.

Never expose internal stack traces or secrets to API consumers in production.

---

# 25. Logging

Use structured logging.

Logs should provide enough information to diagnose:

* job creation;
* worker execution;
* stream detection;
* recording start;
* recording completion;
* upload;
* cloud provider failures;
* queue failures;
* cleanup;
* retention deletion.

Never log:

* passwords;
* OAuth access tokens;
* OAuth refresh tokens;
* JWT secrets;
* complete authorization headers;
* sensitive personal data unnecessarily.

---

# 26. Configuration

Configuration must come from environment variables or a dedicated configuration layer.

Never hardcode:

* secrets;
* database passwords;
* OAuth credentials;
* JWT secrets;
* cloud credentials;
* production URLs.

Provide sensible development defaults only when they are safe.

Environment-specific configuration should remain separate from application logic.

---

# 27. Testing

New domain logic should be testable independently.

Prioritize tests for:

* authentication;
* Creator ownership;
* WatchTarget creation/update;
* multiple WatchTargets per Creator;
* recording lifecycle;
* queue/job creation;
* worker error handling;
* cloud-storage abstraction;
* retention logic.

Particularly important:

```text
One Creator
   |
   +-- WatchTarget A
   +-- WatchTarget B
   +-- WatchTarget C
```

must be a supported and tested scenario.

Tests should verify that modifying or deleting one WatchTarget does not unintentionally modify other WatchTargets belonging to the same Creator.

---

# 28. Architecture Boundaries

Maintain clear separation between:

```text
Controller
   ↓
Service
   ↓
Repository
   ↓
Database
```

For worker-related functionality:

```text
Queue
   ↓
Worker
   ↓
Service / Provider
   ↓
External System
```

Controllers should remain thin.

Repositories should focus on persistence.

Services should contain application/domain logic.

Workers should orchestrate long-running background operations.

External integrations should be isolated behind provider/service abstractions.

---

# 29. Naming Conventions

Use consistent names throughout the project.

Domain terminology must remain stable.

Use:

* `Creator`
* `WatchTarget`
* `Stream`
* `Recording`
* `User`
* `CloudStorageConnection`

Do not introduce alternative names for the same concept, such as:

```text
Streamer
Target
Monitor
Capture
Video
```

unless there is a clearly distinct domain meaning.

The distinction between `Creator`, `WatchTarget`, `Stream`, and `Recording` is fundamental to the architecture.

---

# 30. Avoid Premature Abstraction

Do not create abstractions simply to follow a design pattern.

Before adding an abstraction ask:

1. Does it solve an actual current problem?
2. Does it improve testability?
3. Does it isolate an external dependency?
4. Will it make the next feature easier?
5. Does the complexity justify itself?

Prefer simple code over unnecessary abstraction.

---

# 31. Backward Compatibility

When modifying existing functionality:

1. Inspect the current implementation.
2. Understand existing API contracts.
3. Preserve working behavior whenever possible.
4. Refactor incrementally.
5. Avoid rewriting unrelated modules.
6. Add tests before changing behavior when practical.

Do not replace functioning code merely for stylistic reasons.

---

# 32. Security and Compliance

The application must not publicly expose recorded videos.

Recordings should not be:

* publicly indexed;
* exposed through public application URLs;
* intentionally redistributed by the application.

The user is responsible for ensuring that their recordings comply with applicable copyright and platform rules.

The application should provide appropriate Terms of Use/disclaimers before broader publication.

Security decisions must prioritize:

* credential protection;
* user isolation;
* private cloud files;
* secure OAuth handling;
* safe temporary-file handling;
* controlled worker execution.

---

# 33. Infrastructure Constraints

The application is designed to run economically, potentially on a single VPS during the initial stages.

Do not assume:

* Kubernetes;
* multiple production clusters;
* expensive managed services;
* GPU infrastructure;
* large persistent media storage.

Redis, PostgreSQL, API, and workers should be deployable with Docker Compose during the initial stages.

Architecture should remain capable of scaling later without requiring that scaling infrastructure immediately.

---

# 34. Development Priority

The current development priority is:

```text
1. Domain model
2. Creator
3. WatchTarget
4. Stream
5. Recording
6. User ownership
7. Queue integration
8. Worker integration
9. Cloud storage
10. Retention
11. Frontend/dashboard
12. Invitation/public release
```

Do not implement later-stage features prematurely if they block the core domain model.

---

# 35. Current Architectural Goal

The immediate goal is to establish a clean domain foundation around:

```text
User
  |
  +-- Creator
        |
        +-- WatchTarget
        |      |
        |      +-- Recording configuration
        |
        +-- Stream
               |
               +-- Recording
```

The most important architectural rule is:

> A Creator identifies who is being monitored. A WatchTarget defines how that Creator should be monitored or recorded. A Stream represents an actual live session. A Recording represents the resulting recording/job.

A Creator may have multiple WatchTargets.

Different WatchTargets may use different recording qualities or configurations.

All WatchTargets belonging to the same Creator must remain independently configurable and manageable.

This separation should guide the database schema, API design, worker jobs, frontend organization, and future features.

---

# 36. AI Agent Behavior

When modifying the project, the AI coding agent must:

1. Inspect the existing implementation before proposing changes.
2. Follow the current architecture unless there is a concrete reason to change it.
3. Prefer incremental changes.
4. Avoid unrelated refactors.
5. Explain architectural changes when they affect multiple modules.
6. Reuse existing utilities and patterns when appropriate.
7. Add or update tests for changed behavior.
8. Keep domain terminology consistent.
9. Consider multi-user isolation for every user-owned resource.
10. Consider security implications of every authentication, OAuth, worker, and file-storage change.
11. Avoid adding unnecessary dependencies.
12. Avoid introducing infrastructure that increases operational complexity without clear benefit.

When a requirement is ambiguous, prefer the smallest implementation that preserves future extensibility.

Before implementing a significant architectural change, inspect the relevant entities, repositories, services, controllers, queue/worker code, and tests.

---

# 37. Definition of Done

A feature should generally be considered complete only when:

* the domain model is correct;
* database relationships are correct;
* ownership/security is enforced;
* API validation exists;
* business logic is implemented in the appropriate service;
* background work is queued when necessary;
* worker behavior is handled appropriately;
* errors are handled;
* logs are useful;
* relevant tests exist;
* existing functionality continues to work;
* no unnecessary architectural complexity was introduced.

---

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
