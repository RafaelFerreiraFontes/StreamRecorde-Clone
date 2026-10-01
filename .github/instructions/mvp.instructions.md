---
description: Defines the concrete MVP scope, responsibilities of the API, Web frontend, Worker, and the long-term architectural goal of the StreamRecorder Clone.
applyTo: "**/*"
---

# StreamRecorder Clone — MVP Instructions

## 1. MVP Purpose

The current development phase is the **MVP foundation** of the StreamRecorder Clone.

The MVP is not intended to implement the entire final product.

Its purpose is to prove the core architecture and establish the domain model that the rest of the application will build upon.

The most important objective is to successfully connect:

```text
Web
  |
  v
API
  |
  +---- PostgreSQL
  |
  +---- Redis / Queue
  |
  v
Worker
  |
  +---- Streamlink
  +---- FFmpeg
  |
  v
Google Drive
```

The MVP should prove that a user can configure what they want to monitor, trigger a recording, process it through the worker, and save the resulting recording to their own Google Drive.

---

# 2. MVP Core Concept

The most important domain relationship in the MVP is:

```text
User
  |
  +-- Creator
        |
        +-- WatchTarget
        |      |
        |      +-- recording configuration
        |
        +-- Stream
               |
               +-- Recording
```

The distinction between these entities must be preserved.

### Creator

Represents **who** is being monitored.

### WatchTarget

Represents **how** that Creator should be monitored or recorded.

### Stream

Represents **an actual live broadcast/session** detected from a Creator.

### Recording

Represents **the recording job/result** generated from a Stream.

This distinction is the foundation of the application.

---

# 3. Critical MVP Requirement — Multiple WatchTargets

A single Creator must support multiple WatchTargets.

Example:

```text
Creator: ExampleStreamer

├── WatchTarget: Best Quality
│      └── quality = best
│
├── WatchTarget: 1080p
│      └── quality = 1080p
│
└── WatchTarget: 720p
       └── quality = 720p
```

Each WatchTarget must be independently configurable.

Changing:

```text
WatchTarget A
```

must not modify:

```text
WatchTarget B
WatchTarget C
```

Do not place multiple configurations directly inside Creator.

Incorrect:

```text
Creator
├── quality1
├── quality2
└── quality3
```

Correct:

```text
Creator
├── WatchTarget
├── WatchTarget
└── WatchTarget
```

This requirement must be respected by:

* database;
* API;
* Web frontend;
* queue;
* worker;
* tests.

---

# 4. MVP Scope

The MVP includes:

```text
Authentication
User ownership
Creator
WatchTarget
Stream
Recording
Queue
Worker
Streamlink
FFmpeg
Google Drive
Recording status
Basic Web UI
Tests
```

The MVP does not need to implement the complete production feature set.

The goal is a functional vertical slice rather than a large collection of unfinished features.

---

# 5. MVP End-to-End Flow

The complete MVP flow should eventually look like:

```text
1. User registers
        |
        v
2. User logs in
        |
        v
3. User connects Google Drive
        |
        v
4. User creates Creator
        |
        v
5. User creates one or more WatchTargets
        |
        v
6. WatchTarget becomes active
        |
        v
7. System detects a live Stream
        |
        v
8. API creates Recording
        |
        v
9. API places recording job in queue
        |
        v
10. Worker receives job
        |
        v
11. Worker resolves stream
        |
        v
12. Streamlink captures stream
        |
        v
13. FFmpeg processes recording
        |
        v
14. Worker uploads to Google Drive
        |
        v
15. Recording becomes COMPLETED
```

The MVP should be considered successful when this flow works reliably.

---

# 6. API Responsibility

The API is the application's primary business and orchestration layer.

The API is responsible for:

* authentication;
* authorization;
* user ownership;
* Creator management;
* WatchTarget management;
* Stream records;
* Recording records;
* queue/job creation;
* recording state management;
* Google Drive connection management;
* API validation;
* business rules.

The API must **not** perform long-running recording operations directly.

Do not make an HTTP request wait for the entire duration of a live stream.

Incorrect:

```text
HTTP Request
    |
    +-- start Streamlink
    |
    +-- wait several hours
    |
    +-- upload
    |
    +-- response
```

Correct:

```text
HTTP Request
    |
    +-- create Recording
    |
    +-- enqueue Job
    |
    +-- return
             |
             v
          Worker
```

---

# 7. API — MVP Resources

The MVP should expose resources similar to:

```text
/auth
/users
/creators
/watch-targets
/streams
/recordings
/cloud-storage
```

The exact routes must follow the existing project's conventions.

Do not unnecessarily redesign already-working endpoints.

---

# 8. API — Creator Responsibilities

The API must allow authenticated users to:

```text
Create Creator
List Creators
Get Creator
Update Creator
Delete Creator
```

Every Creator must belong to a User.

Queries must always respect user ownership.

A request from User A must never return Creator resources belonging to User B.

---

# 9. API — WatchTarget Responsibilities

The API must allow users to manage multiple WatchTargets under the same Creator.

Example:

```text
Creator
 |
 +-- WatchTarget A
 +-- WatchTarget B
 +-- WatchTarget C
```

The API must support:

```text
Create WatchTarget
List WatchTargets for Creator
Get WatchTarget
Update WatchTarget
Delete WatchTarget
Enable/Disable WatchTarget
```

At minimum, a WatchTarget should contain the information required to:

* identify the target;
* identify the platform;
* define the recording quality;
* determine whether monitoring is enabled;
* associate the target with its Creator.

---

# 10. API — Recording Responsibilities

When a recording is requested, the API should:

1. Authenticate the user.
2. Validate the WatchTarget.
3. Validate ownership.
4. Resolve the relevant configuration.
5. Create the Recording record.
6. Create the queue job.
7. Return the Recording/job information.

The API should not duplicate the worker's media-processing logic.

The queue payload should contain identifiers/configuration references necessary for the worker to execute the job.

Do not place OAuth credentials or secrets inside queue payloads.

---

# 11. Worker Responsibility

The Worker is the media execution layer.

The Worker should focus on executing recording jobs, not managing the application's entire business domain.

Conceptually:

```text
Queue
  |
  v
Worker
  |
  +-- Load job context
  |
  +-- Resolve stream
  |
  +-- Streamlink
  |
  +-- FFmpeg
  |
  +-- Upload
  |
  +-- Update Recording
```

The worker must be independently executable from the API.

The worker should be capable of restarting without requiring the API process to remain alive.

---

# 12. Worker — WatchTarget Configuration

The worker must receive or resolve the configuration associated with the specific WatchTarget.

This is important because the same Creator may have multiple configurations.

Example:

```text
Creator
 |
 +-- WatchTarget A → 1080p
 |
 +-- WatchTarget B → 720p
```

If a job was created from WatchTarget B, the worker must execute the 720p configuration.

It must not simply load the Creator and use some default quality.

The WatchTarget is the source of the recording configuration.

---

# 13. Worker — Streamlink

Streamlink is responsible for retrieving/capturing the live stream.

The worker should isolate Streamlink execution behind a clear service/helper where practical.

The worker should be able to:

* start Streamlink;
* select the requested quality;
* capture the stream;
* detect process failure;
* stop the process safely;
* clean up resources.

Platform-specific behavior should not be spread throughout the entire worker.

Prefer an architecture that allows:

```text
Stream Resolver
    |
    +-- Twitch
    +-- YouTube
    +-- Kick
```

without duplicating the entire recording pipeline.

---

# 14. Worker — FFmpeg

FFmpeg should be used when required by the recording pipeline.

Its responsibility may include:

* container conversion;
* stream processing;
* remuxing;
* format normalization;
* required transcoding.

Do not introduce expensive transcoding by default.

The MVP should prioritize:

```text
Capture
→ Minimal processing
→ Upload
```

rather than building a complete video-processing platform.

---

# 15. Worker — Cloud Upload

The MVP uses Google Drive as the first cloud-storage provider.

The worker should upload the completed recording to the authenticated user's Google Drive.

The worker must resolve the user's cloud connection securely.

Never:

* hardcode credentials;
* put OAuth tokens in queue payloads;
* log access tokens;
* log refresh tokens;
* expose credentials through API responses.

The final recording should belong to the user's connected cloud storage.

---

# 16. Recording State Machine

The API and Worker must use the same recording states.

Recommended states:

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

Any stage may transition to:

```text
ERROR
```

The Worker is responsible for updating execution-related states.

The API is responsible for maintaining the persistent Recording entity and exposing its state.

Do not create separate incompatible state systems for API and Worker.

---

# 17. Web Frontend Responsibility

The Web application is primarily a management and monitoring interface.

The MVP frontend should allow the user to:

```text
Register
Login
Manage Creators
Manage WatchTargets
Connect Google Drive
View Recordings
View Recording Status
```

The frontend should not contain business rules that belong to the API.

Frontend validation improves UX, but API validation remains authoritative.

---

# 18. Web — Creator Organization

Creators should be the primary organizational unit in the UI.

Example:

```text
ExampleStreamer

Watch Targets
────────────────────────

Best Quality
Platform: Twitch
Quality: Best
Status: Enabled

1080p
Platform: Twitch
Quality: 1080p
Status: Enabled

720p
Platform: Twitch
Quality: 720p
Status: Disabled
```

This grouping is important.

The user should clearly understand that several WatchTargets belong to the same Creator.

---

# 19. Web — Recording View

The frontend should display recordings grouped or filterable by:

* Creator;
* WatchTarget;
* status;
* date.

At minimum, the user should be able to understand:

```text
Creator
WatchTarget
Stream
Recording
Status
Date
Cloud destination
```

Do not build an advanced media library during the MVP.

---

# 20. Web — Real-Time Status

The final architecture should support real-time status updates.

Preferred:

```text
WebSocket / SSE
```

However, if implementing real-time communication would unnecessarily block the initial MVP, simple polling is acceptable temporarily.

The important architectural requirement is that Recording status is persisted centrally and can later be consumed through a real-time channel.

---

# 21. MVP Database

The MVP should establish the relational foundation around:

```text
users
creators
watch_targets
streams
recordings
cloud_storage_connections
```

The most important relationships are:

```text
User
 ├── Creator
 │     └── WatchTarget
 │            └── Stream
 │                   └── Recording
 │
 └── CloudStorageConnection
```

The exact cardinality may evolve as the implementation progresses, but ownership and domain boundaries must remain explicit.

---

# 22. MVP Security

Security is part of the MVP, not a future feature.

At minimum:

* passwords must be hashed;
* authenticated routes must require authentication;
* resources must enforce user ownership;
* OAuth credentials must be protected;
* secrets must not be logged;
* secrets must not be committed;
* recordings must not become publicly accessible through the application;
* temporary media must be cleaned up.

Never sacrifice basic security simply because this is an MVP.

---

# 23. MVP Testing Priorities

Testing should focus on the architectural boundaries that are most likely to cause problems.

Priority:

### Authentication

```text
Register
Login
Protected routes
User isolation
```

### Creator

```text
Create
Read
Update
Delete
Ownership
```

### WatchTarget

```text
Create multiple targets for one Creator
Different configurations
Update independently
Delete independently
Ownership
```

### Recording

```text
Create
State transitions
WatchTarget relationship
Stream relationship
```

### Queue

```text
Job creation
Correct job payload
```

### Worker

```text
Successful execution
Stream failure
FFmpeg failure
Upload failure
Cleanup
```

The most important domain test is:

```text
One Creator
    |
    +-- WatchTarget A
    +-- WatchTarget B
    +-- WatchTarget C
```

All three must operate independently.

---

# 24. What Is NOT Part of the MVP

The AI agent must not expand the scope without an explicit request.

Do not implement yet:

```text
Dropbox
OneDrive
Advanced tag system
Advanced scheduling
Smart collections
Public profiles
Public video sharing
Video indexing
Analytics dashboard
Viewer analytics
Advanced stream metadata
Kubernetes
Microservices
Distributed workers
Autoscaling
GPU processing
Advanced video transcoding
Email verification
Password recovery
2FA
Admin system
Complex permissions
Advanced notification system
```

These belong to later milestones.

---

# 25. MVP Infrastructure

The MVP should remain deployable using a simple Docker-based environment.

Conceptually:

```text
Docker Compose
 |
 +-- PostgreSQL
 |
 +-- Redis
 |
 +-- API
 |
 +-- Worker
 |
 +-- Web
```

Do not introduce Kubernetes or other orchestration systems.

The infrastructure should be cheap enough to operate on a small VPS.

---

# 26. MVP Definition of Done

The MVP is complete when a real user can perform this scenario:

```text
Register
   ↓
Login
   ↓
Connect Google Drive
   ↓
Create Creator
   ↓
Create WatchTarget A
   ↓
Create WatchTarget B
   ↓
Configure different qualities
   ↓
Detect/start a live stream
   ↓
Create Recording
   ↓
Queue recording job
   ↓
Worker receives job
   ↓
Streamlink captures stream
   ↓
FFmpeg processes recording
   ↓
Google Drive receives recording
   ↓
Recording becomes COMPLETED
   ↓
Web displays the result
```

And importantly:

```text
Creator
 |
 +-- WatchTarget A → configuration A
 |
 +-- WatchTarget B → configuration B
```

must remain independently functional.

---

# 27. Final Product Vision

Although the MVP is intentionally small, the AI agent must understand the intended final architecture.

The final application should become a private, multi-user stream recording platform where users can configure multiple monitoring targets for creators and store recordings directly in their own cloud storage.

The conceptual final architecture is:

```text
User
 |
 +-- Cloud Storage Connections
 |
 +-- Creators
       |
       +-- WatchTargets
       |      |
       |      +-- different platforms
       |      +-- different qualities
       |      +-- different recording configurations
       |      +-- tags
       |      +-- scheduling
       |
       +-- Streams
              |
              +-- Recordings
                     |
                     +-- Cloud files
```

The system should eventually support:

```text
Twitch
YouTube
Kick
```

and:

```text
Google Drive
Dropbox
OneDrive
```

with additional capabilities such as:

* 7-day retention;
* automatic deletion;
* tagging;
* filtering;
* scheduling;
* recording limits;
* multiple recording configurations;
* real-time monitoring;
* structured logs;
* controlled user invitations.

---

# 28. Most Important Architectural Principles

When making implementation decisions, prioritize these principles in this order:

## 1. Correct Domain Separation

Keep these concepts distinct:

```text
Creator
WatchTarget
Stream
Recording
```

Do not merge them for convenience.

---

## 2. WatchTarget Flexibility

A Creator can have many WatchTargets.

A WatchTarget defines how that Creator is monitored/recorded.

This is one of the core architectural requirements of the project.

---

## 3. User Isolation

Every user-owned resource must remain isolated.

```text
User A
  └── own resources

User B
  └── own resources
```

Never allow cross-user access.

---

## 4. API/Worker Separation

The API orchestrates.

The Worker executes.

```text
API
= business logic + orchestration

Worker
= long-running media execution
```

Do not move business logic unnecessarily into the Worker.

---

## 5. Cloud-First Storage

The application server is not the permanent home of recordings.

```text
Stream
   ↓
Worker
   ↓
Cloud Storage
```

Temporary local files are acceptable when necessary, but must be controlled and cleaned up.

---

## 6. Extensibility Without Overengineering

The architecture must allow future expansion, but the MVP should remain simple.

Design for:

```text
Twitch → YouTube → Kick

Google Drive → Dropbox → OneDrive
```

but only implement what is necessary for the current milestone.

---

## 7. Portfolio Quality

The MVP should demonstrate real engineering practices:

* clean architecture;
* domain modeling;
* background processing;
* queue-based jobs;
* media processing;
* cloud integration;
* authentication;
* database relationships;
* testing;
* structured logging;
* secure credential handling.

The goal is not merely to make the application work.

The goal is to establish a technically credible foundation that can evolve into the final product without requiring a major architectural rewrite.

---

# 29. AI Agent Execution Rule

Before implementing an MVP task, the AI agent should:

1. Inspect the existing codebase.
2. Identify which layer the change belongs to.
3. Check existing entities and relationships.
4. Check existing API conventions.
5. Check existing worker/queue conventions.
6. Reuse existing infrastructure where possible.
7. Implement the smallest change that satisfies the requirement.
8. Add/update tests.
9. Verify that existing functionality remains intact.
10. Avoid implementing features outside the current MVP scope.

When uncertain between a simple implementation and a complex abstraction, prefer the simple implementation unless the complex design is required to preserve the intended architecture.

The MVP should be built as a **vertical slice**, not as a collection of disconnected features.

The ultimate objective is:

```text
        ┌───────────────┐
        │      WEB      │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │      API      │
        │               │
        │ Domain Logic  │
        └───┬───────┬───┘
            │       │
            ▼       ▼
      PostgreSQL   Redis
                    │
                    ▼
             ┌─────────────┐
             │   WORKER    │
             │             │
             │ Streamlink  │
             │ FFmpeg      │
             └──────┬──────┘
                    │
                    ▼
             ┌─────────────┐
             │ Google Drive│
             └─────────────┘
```

Every implementation decision should move the project toward this architecture without prematurely implementing the entire final product.
