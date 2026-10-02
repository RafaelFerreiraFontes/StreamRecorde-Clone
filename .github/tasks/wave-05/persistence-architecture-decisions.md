# Wave 05 Persistence Architecture Decisions

**Decision status:** Accepted for Wave 05 implementation planning. This is the
canonical decision record for tasks 05-T02 through 05-T07. It freezes design
constraints; it does not add PostgreSQL, an ORM, migrations, an outbox, or a
runtime API endpoint. Any change to a frozen decision requires an impact review
of the dependent task before implementation proceeds.

**Scope:** Replace JSON as the primary durable store for `Creator`,
`WatchTarget`, `Stream`, and `Recording` while preserving the local-first
capture flow and current API compatibility. Local recording files remain user
data and are not database blobs. `channels_status.json` remains an operational
projection during the transition; it is not a source for historical domain
imports.

## 1. Decision Status and Document Scope

This document is the Wave 05 Task 01 deliverable. It makes the following
decisions for later tasks:

- PostgreSQL is the future primary authority for the four domain entities.
- Drizzle ORM with checked-in SQL migrations is the selected schema/query
  layer.
- A stable UUID, not a creator display name, identifies a future Creator.
- A new Recording must reference its actual Stream; an old session with no
  persisted `stream_id` remains unknown (`NULL`).
- The Worker reaches durable domain persistence through a narrow internal API
  boundary and a local durable outbox (option A), rather than opening its own
  database connection or making `channels_status.json` an event log.
- 05-T06 is the sole existing-installation cutover point. Earlier relational
  paths operate only in disposable/opt-in test environments.

No decision here authorizes a queue, cloud export, public media, authentication,
or a change from the existing `finished` success state to `COMPLETED`.

## 2. Evidence Baseline

The baseline was inspected at commit `c11fb0f9e62782e0564384b4285e7edaf5dd24d9`
(`docs(wave-05): split PostgreSQL migration into staged tasks`). The task file
was already in `implement` state before this document was written; it is not
modified by this task.

| Evidence | Observed facts used by this decision |
| --- | --- |
| [domain.model.ts](../../../api/src/streams/domain.model.ts#L15-L70) | Current state vocabulary is `idle`, `offline`, `recording`, `finished`, `error`; Recording uses `session_id`; `stream_id` is optional. |
| [streams.repository.ts](../../../api/src/streams/streams.repository.ts#L39-L51) | The API reads all four shared files; it writes only `watchlist.json`. Its mutex is process-local. |
| [streams.repository.ts](../../../api/src/streams/streams.repository.ts#L72-L191) | Creator identity is derived from `display_name`/`channel_name`; WatchTarget creation and deletion mutate the watchlist. |
| [json-compatibility.adapters.ts](../../../api/src/streams/json-compatibility.adapters.ts#L185-L283) | Legacy `sessions.json` maps `channel_id` to `watch_target_id` and drops `stream_id`. |
| [worker.py](../../../worker/worker.py#L446-L591) | The Worker loads the four files and writes status, streams, and recordings; it reloads disk state while preserving active work. |
| [worker.py](../../../worker/worker.py#L887-L1082) | A capture creates an in-memory stream link, persists initial state before accepting a child, and retries terminal persistence from memory. |
| [worker.py](../../../worker/worker.py#L1120-L1375) | Polling reloads configuration, blocks disabled/invalid targets, refreshes before launch, and keeps probe `ERROR` distinct from `OFFLINE`. |
| [streams.controller.ts](../../../api/src/streams/streams.controller.ts#L20-L128) | Current modern and legacy route shapes are explicit. |
| [streams.service.ts](../../../api/src/streams/streams.service.ts#L13-L145) | Service-layer input rules include strict PATCH handling and safe folder normalization. |
| [watch-target.dto.ts](../../../api/src/streams/dto/watch-target.dto.ts#L5-L79) | Platform, quality, and credential-free absolute HTTP/HTTPS URL rules are established. |
| [recordings-filesystem.service.ts](../../../api/src/streams/recordings-filesystem.service.ts#L19-L130) | Recording browsing is read-only and validates containment/symlinks. |
| [compose.yml](../../../compose.yml#L1-L47) | API has `/recordings` read-only; Worker writes it; both share `/data`. No PostgreSQL service exists. |
| [Wave 05 README](README.md#L26-L75) | T02--T07 order and the requirement for a single authority/cutover are defined. |

The current Worker dependency is `streamlink==8.6.1`; no PostgreSQL driver,
ORM, migration tool, or database service was observed or added by this task.

## 3. JSON Responsibility Matrix

| File | Responsibility and authoritative fields | Readers / writers | Startup and mutation timing | IDs / derived fields | Failure and restart behavior | Compatibility role and Wave 05 destination |
| --- | --- | --- | --- | --- | --- | --- |
| `watchlist.json` | Current WatchTarget configuration: target `id`, `display_name`, `channel_name`, platform, authoritative URL, quality, optional `enabled`, optional `recording_subdir`. `display_name` derives Creator identity today. | API repository reads and writes for create/update/delete. Worker reads at every poll and refreshes immediately before launch. | Worker initializes a missing file as `[]`; API performs atomic read-modify-write under only its Node mutex. Worker does not write it. | `id` is target UUID for modern creation. `creator_id` and Creator are derived from display name (channel fallback), not persisted independently. Absent `enabled` means true. | Both adapters read missing file as empty and retry transient parse/I/O errors. Worker treats missing/invalid configuration as no new work; existing captures continue. Worker restart reloads it. | Configuration compatibility projection until T06. T03 creates relational Creator/WatchTarget authority; a one-way projection to this file keeps the existing Worker working until T05/T06. |
| `channels_status.json` | Mutable operational snapshot keyed by target ID: current `channel_name`, `platform`, and state. It is neither broadcast history nor proof that a Worker is alive. | API reads/merges it into WatchTarget and legacy Streamer responses. Worker reads, preserves active states, and writes it. | Initialized as `{}`. Worker updates around probes, launch, terminal states, offline observations, and shutdown. | Map key is `watch_target_id`; names/platform are copied operational context. State is derived runtime data. | Adapter retries/atomic replaces; Worker logs load failure and preserves active in-memory entries. A restart reloads whatever snapshot remains, without proving a capture is still running. | Remains Worker-owned runtime projection. It is not bulk-imported as durable Stream/Recording history. T05 may publish status through the internal boundary only as a replaceable operational projection; no heartbeat is introduced. |
| `sessions.json` | Legacy Recording attempt history: `session_id`, `channel_id`, timestamps, output path, state. | API reads it through `RecordingJsonAdapter`; Worker reads/reloads and writes it at recording start, terminal persistence, and shutdown. | Initialized as `[]`. Worker persists the initial `recording` attempt before retaining a running child, then writes terminal `finished`/`error`; pending terminal writes retry on later polling. | `session_id` is the Recording ID. `channel_id` is the legacy wire/storage name for `watch_target_id`. `stream_id` is intentionally dropped by both adapters. | Read errors are logged; active in-memory attempts are preserved. A write failure prevents a new child from being retained and terminates it; terminal failure remains pending in memory. Restart reloads only persisted records. | T04 relational Recording authority plus compatibility reads/projection. T06 imports valid legacy data with `stream_id = NULL`; legacy routes retain `session_id` and `channel_id`. |
| `streams.json` | Detected Stream/broadcast history: `id`, `watch_target_id`, state, `started_at`, optional `finished_at`. | API reads it; Worker reads/reloads and exclusively writes new/finalized streams. | Initialized as `[]`. Worker creates it on first LIVE observation, reuses an open stream, finalizes only on confirmed offline when no capture is active. | `id` is a UUID. A stream belongs to one WatchTarget. Stream state is Worker lifecycle data, not WatchTarget configuration. | Read failure is logged and polling continues; write failure prevents that lifecycle operation. Worker restart merges persisted streams with in-memory streams. | T04 relational Stream authority plus compatibility reads/projection. T06 imports records after referential validation; no name/time inference supplies missing Recording links. |

All current JSON writes are atomic replacement with bounded retries, but the
Node mutex and Python lock do not provide cross-process transactions. Therefore
the files cannot remain independently writable primary authorities after
cutover.

## 4. API Compatibility Contracts

The relational implementation must preserve these externally visible contracts
until an explicit, separately reviewed versioning decision changes them.

| Surface | Compatibility decision |
| --- | --- |
| Creator reads | Preserve `GET /creators`, `GET /creators/:id`, and `GET /creators/:id/watch-targets`. Current IDs are name-derived; T03 must provide a compatibility lookup/mapping while stable UUIDs become authoritative. Creator mutation is not added by this decision. |
| WatchTarget | Preserve `GET /watch-targets`, `GET /watch-targets/:id`, `POST`, `PATCH`, and `DELETE`. Create remains enabled by default. A target’s configuration remains independent of its siblings. |
| Streams and Recordings | Preserve `GET /streams`, `GET /streams/:id`, `GET /recordings`, `GET /recordings/:id`, and optional `watchTargetId` filtering. Preserve `session_id` as the Recording API ID. |
| Legacy routes | Preserve `/streamer`, `/streamer/:id`, `POST`/`DELETE /streamer/:id`, `/session`, `/session/:id`, and `/session/channel/:id` while clients use them. Legacy session `channel_id` maps to domain `watch_target_id`. |
| Lifecycle values | Continue exposing exactly `idle`, `offline`, `recording`, `finished`, and `error`. `finished` remains current capture success; `COMPLETED` is not introduced. Probe `LIVE`, `OFFLINE`, and `ERROR` remain separate classifications. |
| PATCH | Omitted fields are unchanged. Only `enabled`, `recording_subdir`, `quality`, and `url` are accepted. `enabled` is strict boolean. Empty `recording_subdir` clears the override; omission does not clear it. |
| Validation | Platform is `youtube`, `twitch`, or `kick`; quality uses the existing supported list. URL must be absolute HTTP/HTTPS with no embedded credentials. `recording_subdir` rejects controls, absolute/drive/UNC paths and traversal, is normalized to `/`, and is bounded to 255 characters. |
| Filesystem browsing | Preserve `GET /recordings/filesystem?path=` and `GET /recordings/:id/location` as metadata-only, read-only access. It must continue root containment, symlink/junction rejection, unavailable-directory and missing-file states; it is not download, playback, or public media serving. |

The database is an implementation replacement below Controller -> Service ->
Repository; controllers remain thin and must not expose internal outbox events.

## 5. ORM / Query Layer Comparison

| Criterion | Prisma | Drizzle | TypeORM | Kysely / direct SQL |
| --- | --- | --- | --- |
| Solo maintainability | Good documentation and familiar CRUD, but a separate generated-client/schema workflow. | Small TypeScript-first schema/query surface with close SQL correspondence. | Mature NestJS ecosystem, but decorators, entity lifecycle behavior, and broad configuration add moving parts. | Maximum explicitness, but migrations/schema conventions and mapping must be assembled deliberately. |
| NestJS/PostgreSQL fit | Works through a service provider; generated client needs lifecycle handling. | Straightforward injected database client/repositories; PostgreSQL dialect is first class. | Strong conventional NestJS integration. | Straightforward injection, but no ORM entity boundary. |
| Migrations/reproducibility | Prisma schema plus generated migration artifacts. | SQL migrations can be checked in and applied reproducibly; schema stays typed in source. | CLI/configuration and migration discipline are viable but decorator metadata can obscure schema changes. | Excellent SQL reproducibility, but requires selecting/maintaining a migration tool. |
| Type safety / SQL clarity | Strong generated model typing; query behavior is farther from SQL. | Strong inferred types while retaining visible SQL-shaped queries. | Entity typing is useful but relation/loading behavior is more runtime-driven. | Excellent query typing with Kysely; raw SQL has only manually maintained types. |
| Transactions / test isolation | Capable, with generated-client setup and database-per-test/schema management. | Explicit transaction API and small test seam; supports isolated DB/schema strategies. | Capable but unit-of-work/entity manager semantics increase test setup. | Fully explicit and excellent for isolation, at more local boilerplate. |
| Tooling/runtime/Docker overhead | Code generation, client engine/binaries, and schema tooling increase image/setup concerns. | Lightweight runtime and migration tooling; no generated engine. | Reflection/decorator metadata and larger ORM behavior surface. | Lowest runtime abstraction; migration tooling is an extra decision. |
| Debugging / lock-in / longevity | Product-specific schema/client lock-in; good diagnostics but generated SQL is less direct. | SQL is inspectable; migrations are portable SQL; low conceptual lock-in. | Long-lived ecosystem, but ORM metadata can complicate SQL diagnosis. | Lowest lock-in and clearest SQL; more custom conventions to own long term. |
| Future User ownership and Tags | Models relations easily, but does not justify adding them now. | Supports later FKs/join tables without placeholder columns now. | Supports later relations but invites entity graph expansion early. | Supports later relations explicitly, but each mapping is manual. |

**Decision criteria:** the project needs reproducible SQL migrations, clear
review of FKs/indexes, a low-overhead local Docker workflow, typed repository
queries, and no premature generic persistence framework. These criteria favor
Drizzle over the alternatives.

## 6. Selected ORM Decision

**Selected:** Drizzle ORM with PostgreSQL and checked-in SQL migrations.

Drizzle is selected because it keeps the schema typed in TypeScript while the
applied migration history remains reviewable PostgreSQL SQL. It has sufficient
transaction and query support for the four current entities, exposes SQL-shaped
queries for debugging and indexes, avoids a generated query engine in local
containers, and does not force future User/Tag abstractions now.

**Rejected for this wave:**

- **Prisma:** capable, but generated client/engine and an additional schema DSL
  impose more tooling/runtime workflow than this local-first migration needs.
- **TypeORM:** capable and familiar in NestJS, but entity decorators and implicit
  ORM behavior are a larger operational/debugging surface for a small migration.
- **Kysely/raw SQL:** technically viable and least lock-in, but would require the
  project to create and maintain its own mapping/migration conventions. Drizzle
  offers comparable SQL clarity with less repeated repository typing.

**Risks and mitigations:** Drizzle is a new dependency only in T02; pin versions
in the package lock and use a clean local PostgreSQL test database. Keep raw
SQL migrations as the executable source of schema truth, avoid ORM-specific
database features without a migration, and place all queries behind repository
implementations. No runtime fallback may silently write JSON as if the DB write
had succeeded.

## 7. Proposed Relational Model

All primary keys are UUIDs. Existing valid WatchTarget IDs, Stream IDs, and
Recording `session_id` UUIDs are preserved during import. PostgreSQL stores
timestamps as `timestamptz`; UUID values are passed as text at legacy API
boundaries.

| Entity | Columns and constraints | Relationships and indexes |
| --- | --- | --- |
| `creators` | `id uuid PK`; `display_name text NOT NULL`; normalized identity key `text NOT NULL`; `created_at timestamptz NOT NULL`; `updated_at timestamptz NOT NULL`; `archived_at timestamptz NULL`. Unique active identity key only after explicit collision resolution. | One Creator has many WatchTargets. Index active identity key and `archived_at`. Display name is not the primary key. |
| `watch_targets` | `id uuid PK`; `creator_id uuid NOT NULL FK creators(id)`; `channel_name text NOT NULL`; platform constrained to current values; `url text NOT NULL`; `quality text NOT NULL`; `enabled boolean NOT NULL DEFAULT true`; `recording_subdir text NULL`; creation/update/archive timestamps. DB checks mirror safe enum/boolean/path boundary where practical; API remains authoritative for full URL/path validation. | Index `creator_id` and active-target queries. Use `ON DELETE RESTRICT`; archive rather than cascade delete. No uniqueness is imposed on channel name/URL because distinct configurations for one Creator are required. |
| `streams` | `id uuid PK`; `watch_target_id uuid NOT NULL FK watch_targets(id)`; current state constrained to the existing vocabulary; `started_at timestamptz NOT NULL`; `finished_at timestamptz NULL`; `created_at`/`updated_at`. Check `finished_at >= started_at` when both are valid timestamps. | One WatchTarget has many Streams. Index `(watch_target_id, started_at DESC)`. Enforce the strict one-open-Stream-per-WatchTarget invariant with `CREATE UNIQUE INDEX uq_streams_active_per_target ON streams (watch_target_id) WHERE finished_at IS NULL;`. |
| `recordings` | `id uuid PK` exposed as `session_id`; `watch_target_id uuid NOT NULL FK watch_targets(id)`; `stream_id uuid NULL FK streams(id)`; `started_at timestamptz NOT NULL`; `finished_at timestamptz NULL`; `output_file text NULL`; state constrained to current vocabulary; immutable execution-context snapshot fields required by T04; timestamps. | A WatchTarget has many Recordings; a Stream has many attempts. Index `(watch_target_id, started_at DESC)`, `(stream_id, started_at DESC)`, and state/terminal queries. A DB trigger or service transaction validates that non-null `stream_id` belongs to the same `watch_target_id`. |

Transaction boundaries are deliberately narrow:

1. Creator/WatchTarget create, update, archive, and compatibility-projection
   bookkeeping each commit atomically in the API repository.
2. Creating a Stream and the initial Recording attempt commits in one API
   transaction when the Worker event supplies both. The Worker launches media
   only after durable acknowledgement.
3. Terminal Recording update and related Stream finalization are one
   transaction when the event proves both changes. Runtime-status projection is
   outside that transaction and is explicitly best-effort.
4. Outbox acknowledgement is committed only after the corresponding idempotent
   domain transaction commits.

The transaction model does not make media bytes transactional. A valid local
file is retained even when metadata persistence needs replay.

`find_active_stream` already treats `finished_at IS NULL` as the active
Stream for a WatchTarget. If an idempotent event attempts to create another
open Stream, the API transaction handler catches the unique-index conflict or
resolves it before insert, then returns the existing open Stream ID. It never
returns an unhandled conflict or creates a second active Stream.

## 8. Creator Identity and Historical Policy

T03 creates stable Creator UUIDs. The current creator string is a legacy
mapping input, not a future foreign key. Import creates a normalized legacy
name key from trimmed display name, using channel name only when display name
is absent, while preserving the original display text for presentation.

- Exact normalized legacy-name matches map deterministically to one Creator.
- Duplicate/conflicting legacy names are reported by dry-run and require an
  explicit mapping file or operator decision; the importer never guesses by
  URL, channel spelling, or recording timestamps.
- A rename updates only the Creator display data. It does not rewrite historical
  snapshots, target IDs, stream IDs, or recording links.
- Current display-name-derived route IDs remain supported through a compatibility
  lookup while clients move to UUID IDs. Ambiguous names must return an explicit
  conflict rather than choosing an arbitrary Creator.
- Deletion is history-safe: Creator and WatchTarget deletion becomes archive/
  soft-delete (or a deliberate restricted operation) and never cascades to
  Streams, Recordings, or local files. The legacy DELETE compatibility behavior
  is reconciled in T03/T06 with an archive projection, not destructive history
  removal.

T04 records immutable originating configuration context sufficient to avoid
presenting a historical Recording as though it used a later target edit. The
exact snapshot column set is designed there; it must not duplicate mutable
configuration without an identified historical need.

## 9. Historical `stream_id` and Recording Relationships

For new Worker-originated work, the Worker already keeps `stream_id` in memory
when it starts a recording. The option-A event therefore contains the new
Stream UUID and Recording `session_id`; the API transaction validates that the
Stream and Recording share the same WatchTarget.

Both current adapters explicitly omit `stream_id` in `sessions.json`. During
T06 import, every legacy session gets `recordings.stream_id = NULL` unless a
separate, durable source explicitly supplied a verified link. The importer must
not infer links from time overlap, name, target, output filename, or an open
stream because such inference changes historical meaning. API/UI presentation
of `NULL` is “unknown/not persisted,” never a fabricated Stream.

## 10. Timestamp Policy

New rows use PostgreSQL `timestamptz`, generated/accepted as UTC ISO-8601 with
an explicit `Z` or offset. Repository/API serializers emit ISO-8601 UTC for new
timestamps. Ordering and lifecycle checks operate on typed instants only.

Existing Worker values use `datetime.now().isoformat()` without a timezone.
They are legacy wall-clock strings. Import preserves the original value in a
raw legacy timestamp field/audit payload and does not silently label it UTC or
compute a different instant. A T06 migration may populate typed timestamps
only when trusted installation-level timezone provenance is supplied explicitly
and records that conversion. Otherwise the normalized timestamp remains NULL
and legacy API formatting returns the preserved raw text. This is intentional:
honest unknown time is safer than false chronological precision.

## 11. Worker Persistence Strategy: Options A/B/C

| Criterion | A. Worker -> internal API + local outbox | B. Worker -> JSON event bridge -> API | C. Worker -> direct PostgreSQL adapter |
| --- | --- | --- | --- |
| Boundary and language coupling | Worker uses a narrow versioned request/event contract; API owns DB mapping. | Retains shared-file transport, requiring a bridge protocol and file coordination. | Python duplicates schema/query/transaction knowledge from the NestJS side. |
| Trust/local exposure | Internal-only API listener/path with explicit authentication or local network restriction when introduced. | Shared mount is writable by Worker and bridge; tamper/corruption boundary remains broad. | Worker holds DB credentials and network authority. |
| DB/API outage | Outbox durably accepts an event before work is acknowledged; replay waits for API/DB recovery. | Event files can survive API downtime, but compaction/order/corruption semantics become a second persistence system. | Worker needs its own reconnect/retry/migration compatibility and handles DB outage directly. |
| Restart/replay/idempotence | Event ID plus aggregate IDs enable API idempotency; Worker replays FIFO per target/recording. | Same requirements plus file cursor/atomic append/compaction/reconciliation complexity. | Same idempotency requirements in two language-specific adapters. |
| Ordering and durability | Acknowledgement means API transaction committed; local outbox protects the interval before acknowledgement. | Atomic file replacement is unsuitable for an append-only ordered event log without new protocol work. | Direct transactions are durable, but an unavailable DB blocks Worker behavior and increases coupling. |
| Configuration propagation | Worker fetches/refreshes approved target execution data through an internal API read boundary. | Watchlist remains primary or must gain a separate projection protocol. | Worker queries tables directly and learns all relational model changes. |
| Testability and operations | Fake API/outbox tests isolate Worker; API tests own DB semantics; one database adapter. | Requires two file protocols and cross-process tests. | Requires PostgreSQL integration in Python tests and duplicate diagnostics/migrations. |
| Solo cost | One durable contract and one DB owner. | Lower initial code appearance, higher long-term reconciliation cost. | Lowest hop count, highest schema/security/maintenance duplication. |

## 12. Selected Worker Persistence Strategy

**Selected:** Option A, Worker -> internal API persistence boundary with a
local durable outbox.

The Worker remains responsible for polling, Streamlink, local files, child
process control, and operational status. The API owns all PostgreSQL writes and
relational validation through repositories. The bridge is an internal-only,
versioned persistence endpoint/service contract, not a public capture endpoint
and not a queue/Recording Job.

**Acknowledgement and durability semantics**

1. Before a new capture is accepted, the Worker writes a small outbox event to
   a Worker-owned durable directory on the local persistent volume, fsyncs it,
   then submits it to the internal API.
2. API acknowledgement means the event’s idempotency key and all required
   Stream/Recording state were committed in PostgreSQL. A network success alone
   is not acknowledgement.
3. The Worker removes/marks the local event acknowledged only after that API
   acknowledgement is durably received. Replays use the same immutable event
   ID, `session_id`, and Stream ID.
4. Terminal events follow the identical sequence. If delivery fails, the local
   media file remains; status may say non-durable/pending internally, never
   falsely `finished` durably.

The outbox uses **one-event-per-file JSON** only. Each event is written to the
Worker-owned `outbox/pending/` directory with `mkstemp`, `json.dump`, `fsync`,
and `replace`. Its filename is `{timestamp_ms}_{sequence}_{event_id}.json`,
which provides lexicographical FIFO replay order. Each JSON object includes a
schema version, opaque event UUID, entity IDs, event type, attempt number,
occurred-at raw value, and minimum execution context. It contains no URL
credentials, OAuth material, or raw sensitive diagnostics. On API
acknowledgement, moving or unlinking that individual file is the per-event
atomic lifecycle transition; this needs neither multi-process append locks nor
log compaction. After a crash or restart, the Worker validates event schemas
and replays `outbox/pending/` sequentially in filename order. The outbox is
bounded by documented count/size limits; saturation blocks *new* launches with
an explicit operational error but does not kill an active capture.

**Configuration path:** T05 disposable bridge activation and T06 cutover both
activate the internal read-only endpoint
`GET /internal/v1/watch-targets/execution-configs`. In relational mode, the
Worker reads configuration exclusively from this endpoint on every poll and
immediately before launch. Its response is an array of WatchTarget execution
configs: `{ id: string, channel_name: string, platform: string, url: string,
quality: string, enabled: boolean, recording_subdir?: string }`.
`watchlist.json` is an API-generated legacy compatibility projection and is
never read by the Worker while the bridge is active. Rolling back to
pre-cutover JSON mode reverts the Worker to reading `watchlist.json` directly.

**`channels_status.json`:** the Worker may continue to write it as a bounded
runtime projection for current API/frontend compatibility. Its fields are
replaceable observations, not durable event history, and it supplies neither a
Worker heartbeat nor an implicit successful capture acknowledgement.

## 13. Authority and Cutover Ledger

“Projection” is one-way from the listed primary authority. No stage permits
two independently writable primaries.

| Stage / entity | Primary authority | Readers | Writers | Compatibility projection | Activation condition | Rollback checkpoint |
| --- | --- | --- | --- | --- | --- | --- |
| T02 foundation / all domain entities | Existing JSON remains primary. PostgreSQL schema is empty and inert. | Existing API/Worker. | Existing API/Worker. | None. | Clean schema/migrations and isolated DB tests pass; no installation switch. | Drop disposable test DB only; production JSON untouched. |
| T03 Creator + WatchTarget | JSON remains primary on existing installations; relational path is primary only in disposable opt-in fixtures. | API repositories; Worker still reads watchlist. | API writes JSON in compatibility mode; relational repository writes DB in fixture mode. | DB -> `watchlist.json` only in an explicitly activated disposable compatibility test; never dual-primary. | T03 relational tests, legacy mapping/collision tests, and explicit mode guard pass. | Disable fixture mode and return to JSON; no migrated installation data exists. |
| T04 Stream + Recording | Same split: JSON primary for existing installation; DB primary only in isolated relational environment. | API reads selected authority; Worker still reads/writes JSON. | Worker remains JSON writer in compatibility mode; fixture adapter supplies controlled DB test events. | Relational read adapter may render existing API/legacy shapes; no live JSON backfill. | T04 FK, null legacy link, state, and transaction tests pass. | Dispose isolated data; JSON remains source for live installation. |
| T05 Worker bridge | Existing installation remains JSON primary. Disposable integration environment uses PostgreSQL domain authority via option-A bridge. | Worker exclusively reads `GET /internal/v1/watch-targets/execution-configs` on every poll and before launch; API reads DB; current UI uses API. | Worker writes one-event-per-file outbox events; API exclusively writes DB; Worker may write runtime status projection. | API projects current compatibility response shapes and generates `watchlist.json` only as a legacy projection, never as a bridge-active Worker input. | Endpoint, outbox replay/idempotency, outage, restart, and fake Streamlink tests pass. | Stop bridge, preserve outbox/media for inspection, switch Worker back to direct `watchlist.json` reads, discard isolated DB; do not replay into normal JSON automatically. |
| T06 migration / Creator, WatchTarget, Stream, Recording | PostgreSQL becomes primary only for explicitly opted-in, verified installation. | API and Worker read approved DB-backed config/domain state; Worker reads execution config exclusively from `GET /internal/v1/watch-targets/execution-configs`; migration tooling reads a consistent JSON snapshot. | API writes DB; Worker writes one-event-per-file outbox events to API; migrator writes DB during import only. | DB -> legacy API shapes and, while required, an API-generated read-only `watchlist.json` projection that the bridge-active Worker never reads. Sessions/streams are not independently writable projections. | Dry-run, backup checksums, import validation, endpoint/outbox DB/Worker/API restart rehearsal, and operator activation succeed. | Pre-activation: restore JSON-only mode and direct Worker `watchlist.json` reads. Post-activation: forward-repair/reconciliation; no lossy automatic reverse export. |
| T07 integration / all entities plus runtime status | PostgreSQL is sole domain authority; `channels_status.json` remains Worker runtime projection. | API/frontend read API; Worker reads bridge config; diagnostics may read runtime projection. | API writes DB; Worker sends outbox events; Worker writes status projection. | Legacy routes are API serialization only; any temporary watchlist projection is API-generated and read-only to Worker. | Clean-install and upgrade-path evidence, compatibility, Docker/Windows, outage/replay checks pass. | Use reconciler from DB/outbox/audit data; retain backups and preserve local media. |

Deletion propagation follows the same direction: DB archive/restrict decisions
project to compatibility configuration; a worker-side deletion or stale
watchlist entry never deletes database history. Replays are idempotent by event
ID and aggregate version/state rules. Per-recording events are ordered; an
out-of-order terminal event is retained/retried or rejected explicitly, never
silently applied to an unrelated attempt.

## 14. Failure and Recovery Policy

| Failure point | Required behavior |
| --- | --- |
| PostgreSQL/API unavailable before probe | Worker may use the last successfully acknowledged, bounded-age configuration snapshot only if T05 explicitly implements it; otherwise it performs no new probe/capture and logs safe diagnostics. It retries bridge/config reads with bounded exponential backoff. No JSON fallback becomes an independent authority. |
| Unavailable during pre-launch refresh | Block launch. Re-read/retry according to bounded policy; never start from stale/unvalidated configuration after a target was removed, disabled, made invalid, or changed URL. |
| Unavailable during capture start | Persist a durable outbox start event before treating the attempt as accepted. If no acknowledgement arrives within the defined launch policy, terminate/reap a newly launched child and preserve any owned partial according to the current cleanup policy. Do not report a durable recording start. |
| Unavailable during active capture | Do not terminate a healthy capture solely because terminal metadata cannot be delivered. Retain terminal event/output locally and retry. Outbox saturation prevents *future* launches first. |
| Unavailable at terminal write | Keep local output and unacknowledged terminal event. State remains pending/non-durable operationally; never claim `finished` in durable history until API transaction acknowledgement. Retry with bounded backoff and survive Worker restart. |
| API restart | API must accept the same event ID/idempotency key and return the original committed result. It must not create duplicate Recording attempts or Streams. |
| Worker restart | Scan/replay unacknowledged outbox events before new launches; rebuild only persisted active/terminal metadata. Orphaned local media is not declared successful without its linked event/record. |
| PostgreSQL restart | Health/readiness gates bridge delivery. The API retries/rejects transient failure explicitly; outbox replay resumes after recovery. PostgreSQL durability, not a retained HTTP response, is the acknowledgement source. |

Retries are bounded with jitter and safe diagnostics. Persistent failure becomes
observable and requires intervention; it must not become infinite hot looping,
false durable success, blind duplicate capture, or automatic deletion of media.

## 15. Migration and Cutover Design for T06

T06 implements this design as an explicit operator-controlled import:

1. Require opt-in migration mode; default startup continues the approved
   pre-cutover authority, never auto-importing a user installation.
2. Run a dry-run that parses all four files, validates shapes/IDs/foreign keys,
   reports malformed records, duplicate IDs, invalid states, ambiguous Creator
   names, unknown `stream_id` policy, and expected import counts.
3. Create immutable backups of all source JSON files and manifest checksums,
   plus tool version, timestamp, path, and migration configuration. Never use
   normal runtime data as a test fixture.
4. Obtain a consistent snapshot by stopping/pausing Worker mutation through a
   documented maintenance procedure, copying files after atomic-replace
   quiescence, and recording checksums. A live multi-file copy is not assumed
   transactionally consistent.
5. Deterministically map valid IDs: preserve target/stream/session UUIDs;
   map Creators using the approved legacy mapping; retain `channel_id` as the
   compatibility representation of `watch_target_id`; set legacy
   `recordings.stream_id` to NULL.
6. Reject or quarantine malformed/ambiguous rows with an explicit report. Do
   not silently skip an unknown relationship, merge Creator collisions, or
   manufacture timestamps. Operator correction/mapping occurs before rerun.
7. Insert idempotently in dependency order: Creators, WatchTargets, Streams,
   Recordings. Store migration-source fingerprint/row identity to make reruns
   no-op only when values agree; conflicts fail visibly.
8. Validate counts, IDs, FK integrity, state distribution, sample API legacy/
   modern responses, file-location metadata, and Worker bridge configuration
   before activation.
9. Activate PostgreSQL and option-A bridge together through a documented
   authority flag. Stop JSON domain writers before the switch. Preserve
   `channels_status.json` as runtime projection only.

## 16. Rollback Checkpoints and Design

| Checkpoint | Rollback action and accounting |
| --- | --- |
| Before schema/migrator activation | Remove disposable database resources; no user installation state has changed. |
| After dry-run, before import | Correct mapping/input and rerun. Source files and checksums are unchanged. |
| After import validation, before authority switch | Drop/recreate imported DB data or restore from the verified snapshot; Worker/API remain JSON-authoritative. |
| Immediately after cutover, before any acknowledged post-cutover writes | Stop bridge/API, restore JSON-only configuration from the verified backup, and record aborted activation. |
| After any post-cutover DB/outbox write | Do **not** automatically export database rows back to JSON and claim a full rollback. JSON lacks stable Creator identity, Recording `stream_id`, immutable context, typed-time provenance, and outbox acknowledgement semantics; reverse export is lossy. Freeze new launches if necessary, retain DB/outbox/media, diagnose, then forward-repair with idempotent reconciliation or restore a complete DB backup plus replay its outbox. |

Forward repair is the default post-cutover recovery: reconcile committed DB
event IDs against durable outbox events, apply missing idempotent events, and
report conflicts for operator action. A temporary compatibility projection may
be regenerated from DB, but it is never treated as equivalent semantic backup
or independently writable authority.

## 17. Decisions Frozen for Downstream Tasks

| Task | Directive |
| --- | --- |
| T02 PostgreSQL foundation/schema | Install/configure Drizzle and PostgreSQL only here. Use checked-in SQL migrations, UUID PKs, UTC `timestamptz`, isolated test DBs, and no User/Tag/queue tables. |
| T03 Creator/WatchTarget | Implement stable Creator UUID identity, explicit legacy-name mapping/collision handling, target independence, archive/restrict history policy, and configuration compatibility projection. Do not cut over existing installations. |
| T04 Stream/Recording | Implement FKs/indexes/transactions, `CREATE UNIQUE INDEX uq_streams_active_per_target ON streams (watch_target_id) WHERE finished_at IS NULL;`, valid new same-target `stream_id`, nullable legacy unknowns, immutable historical context, and current lifecycle strings. Resolve duplicate open-Stream events idempotently by returning the existing Stream ID. Do not infer old links or change `finished`. |
| T05 Worker bridge | Implement option A only: internal persistence endpoint plus `GET /internal/v1/watch-targets/execution-configs`, one-event-per-file JSON outbox under `outbox/pending/`, idempotent acknowledgement/replay, and status projection. Activate this bridge in disposable environments; while active, the Worker exclusively reads the endpoint on every poll and before launch. Do not give Worker direct DB credentials or introduce Redis/BullMQ. |
| T06 migration/cutover | Implement opt-in dry-run, backup/checksum, quiesced snapshot, deterministic mapping, idempotent import, validation, single-authority activation, and post-cutover forward repair. Activate the same Worker configuration endpoint at cutover; retain API-generated `watchlist.json` only for legacy compatibility and restore direct Worker JSON reads only when rolling back to pre-cutover JSON mode. |
| T07 integration QA/docs | Validate clean and upgrade paths, Windows/Docker local workflow, API/legacy compatibility, Worker outages/restarts/replay, DB restart, local media preservation, and authority audit. |

## 18. Deferred and Out-of-Scope Concerns

This Wave 05 decision does not implement or reserve placeholder schema for:

- Users, authentication, passwords, password hashes, JWT/session handling, or
  ownership (Wave 05.5).
- Redis, BullMQ, Recording Jobs, queues, or distributed workers (Wave 06).
- Tags (Wave 06.5).
- SSE, WebSocket, or a Worker heartbeat (Wave 08).
- Cloud providers, OAuth, CloudStorageConnection, CloudExport, uploads, or
  cloud retention.
- Tauri packaging, public media/download/playback/indexing, hosted mode, or
  external deployment.
- General retention policy, automatic deletion, media transcoding/finalization
  changes, or a claim that an `.mp4` suffix proves playable media.

The document preserves future feasibility through normal FKs and repository
boundaries, not speculative `user_id` fields, generic event infrastructure, or
cloud tables.

## 19. Source and Evidence References

All source observations are from commit
`c11fb0f9e62782e0564384b4285e7edaf5dd24d9` unless stated otherwise. The
following ranges form the complete primary evidence set for this decision:

- [Wave 05 task](01-persistence-architecture-decisions.task.md#L1-L103): task
  objective, required investigation, decisions, and acceptance criteria.
- [Wave 05 plan](README.md#L1-L154): stages T02--T07, authority constraints,
  exclusions, and wave acceptance evidence.
- [API domain model](../../../api/src/streams/domain.model.ts#L15-L70): entities,
  state strings, and legacy terminology boundary.
- [API repository](../../../api/src/streams/streams.repository.ts#L1-L403):
  JSON reads/writes, derived Creator grouping, WatchTarget mutation, Recording
  reads, legacy session mapping, and Stream reads.
- [API JSON adapters](../../../api/src/streams/json-compatibility.adapters.ts#L1-L344):
  config-path precedence, atomic I/O/retries, defaults, and session link loss.
- [API controller](../../../api/src/streams/streams.controller.ts#L1-L128):
  modern and legacy REST routes.
- [API services](../../../api/src/streams/streams.service.ts#L1-L197): service
  boundary and PATCH/path/URL enforcement.
- [WatchTarget DTOs](../../../api/src/streams/dto/watch-target.dto.ts#L1-L79)
  and [recording query DTO](../../../api/src/streams/dto/recording-query.dto.ts#L1-L8):
  platform, quality, URL, and `watchTargetId` contracts.
- [Filesystem controller](../../../api/src/streams/recordings-filesystem.controller.ts#L1-L24)
  and [filesystem service](../../../api/src/streams/recordings-filesystem.service.ts#L1-L130):
  read-only local recording browsing contract.
- [Worker JSON adapters](../../../worker/json_adapters.py#L1-L118): retrying
  reads, atomic writes, and the legacy `stream_id` omission.
- [Worker configuration/runtime initialization](../../../worker/worker.py#L78-L285),
  [Worker persistence helpers](../../../worker/worker.py#L432-L591),
  [capture/terminal persistence](../../../worker/worker.py#L887-L1118), and
  [poll/shutdown flow](../../../worker/worker.py#L1120-L1520): all current
  reader/writer, lifecycle, restart, and failure observations.
- [Compose topology](../../../compose.yml#L1-L47): shared runtime-data mount,
  Worker write access, API read-only recording mount, and absence of PostgreSQL.

Secondary evidence includes the existing deterministic API and Worker tests
under `api/src/streams/test/` and `worker/test_worker.py`, which exercise
configuration paths, adapters, lifecycle persistence, reload, shutdown, and
filesystem constraints. T02--T07 must add their own executable evidence; this
decision document itself makes no runtime claim.