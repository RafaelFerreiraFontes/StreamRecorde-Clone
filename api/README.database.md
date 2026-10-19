# PostgreSQL Foundation

Wave 05 Task 02 adds an inert PostgreSQL foundation. The current JSON adapters
and `StreamsRepository` remain the sole production authority until the explicit
cutover task. The API starts without connecting to PostgreSQL; connection and
migration failures are reported only when the database service is used.

## Local database

Start the normal local stack with `docker compose up -d`. PostgreSQL listens
only on `127.0.0.1:${POSTGRES_PORT:-5432}` and uses the local development
defaults documented in `compose.yml`. Set `DATABASE_URL` when running database
commands outside Compose, then apply checked-in migrations with:

```bash
pnpm --dir api db:migrate
```

The migrations are SQL files under `api/drizzle/migrations`. Drizzle tracks
applied migrations in `__drizzle_migrations`; rerunning the command is a no-op
after a successful application. `pnpm --dir api db:generate` creates a new
reviewable migration from `src/database/schema.ts` when a future scoped task
changes the schema.

## Isolated foundation validation

Run the following command from the repository root:

```bash
node scripts/test-db-foundation.mjs
```

It starts only the `streamrecorder-test-db` Compose project on port `55432`,
applies migrations, runs integrity and transaction integration tests, stops and
recreates the test database while retaining its dedicated volume, verifies persistence,
then removes that project and its `postgres_test_data` volume. It does not use
the normal database volume, `runtime-data`, or recording directories.

The schema stores metadata only. Recording media stays on the local recording
mount and is never inserted into PostgreSQL.

## Opt-In Relational Configuration (Task 03)

Default API startup still uses JSON for all domain operations. Setting
`RELATIONAL_STORAGE=true` selects PostgreSQL for Creator, WatchTarget, Stream,
and Recording operations.
This flag is for disposable, isolated compatibility fixtures at this stage,
not an existing-installation migration or production cutover. Apply migrations
first and point `DATABASE_URL` and `CONFIG_DIR` (or the individual file overrides)
at test-owned storage. Never point this mode at normal runtime data.

Relational mode adds `POST /creators`, `PATCH /creators/:id`, and
`DELETE /creators/:id`. Creator names are trimmed; UUIDs remain stable on rename.
Name lookups are case-insensitive and return 409 when ambiguous. Duplicate
display names are permitted as distinct identities; use UUIDs to disambiguate.
Renaming replaces the current name lookup rather than keeping an old alias.
Existing name-based WatchTarget creation resolves an unambiguous Creator or
creates one when absent; an unknown Creator UUID returns 404. Independent
Creator mutations return 400 in default JSON mode.

Deleting a target archives its configuration. A Creator with non-archived
targets cannot be deleted, including when those targets are disabled. Neither
operation deletes Stream/Recording history or media.

Target mutations commit to PostgreSQL before atomically projecting all active
targets into `watchlist.json` for the current polling Worker. Creator rename
also refreshes that projection. The projection includes the Creator display
name, target UUID, authoritative URL, preferred quality, enabled flag and
optional relative output folder. Runtime state is still read separately from
`channels_status.json`. Do not edit the projected watchlist as a second primary.

A projection failure returns HTTP 500 explicitly stating that the database
committed. Do not blindly retry creation: inspect committed configuration and
invoke `RelationalStreamsRepository.reprojectWatchlist()` through an
administrative application context after fixing the filesystem failure. This
method regenerates configuration without repeating the mutation. No public
reconciliation endpoint is introduced. Until reconciliation, the polling
Worker can still observe stale projected configuration. Mutations and
projection are serialized inside the API process; this is not multi-instance
coordination, and this checkpoint supports only one configuration-writing API.

### Focused Validation

From the repository root, start a uniquely named disposable database:

```bash
docker compose -f compose.test-db.yml -p streamrecorder-t03-validation up -d --wait
```

From `api`, set `RELATIONAL_TEST_DATABASE_URL` to that disposable database's
connection URL (database name must be `streamrecorder_test`) and run:

```bash
pnpm test --runInBand relational-persistence.integration.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

The integration suite truncates only the explicitly selected test database and
uses temporary JSON directories. It checks Creator/target persistence, names,
three-sibling independence, HTTP validation, archive/history safety, projection
recovery, reconnect and unavailable-DB behavior. It also reads the actual
projection with the current Python Worker adapter; `python` must be installed,
or set `PYTHON` to the Python executable. Without the dedicated test URL, DB
cases are skipped rather than connecting to normal `DATABASE_URL`.

After validation, remove only this test-owned project and its volume:

```bash
docker compose -f compose.test-db.yml -p streamrecorder-t03-validation down --volumes
```

## Relational History (Task 04)

The opt-in repository reads Stream and Recording history from PostgreSQL,
including legacy `/session` mappings and `watchTargetId` filters. Default JSON
mode is unchanged. Worker history still writes JSON; Task 05 supplies its
bridge, and Task 06 alone authorizes existing-installation cutover/import.

Migration `0001_recording_context` adds nullable channel name, platform, and
quality snapshots. New recordings capture these from the locked WatchTarget
(or explicit execution context). Later edits and archives never rewrite them.
Legacy rows with no snapshots use target name/platform only for session
compatibility reads. Recording IDs retain the `session_id` API contract;
unknown historical Stream links remain NULL rather than being inferred.

Stream creation locks the target, reuses a Stream only when both typed and raw
finish timestamps are NULL, and resolves active-index conflicts without a
second broadcast. Each capture attempt receives its own Recording ID. The
composite FK rejects Stream/Recording target mismatches. Archived targets
cannot start new work, but existing history remains readable and finalizable.

`createStreamAndRecording` and `finalizeRecordingAndStream` each commit in one
database transaction. Failure rolls back both operations; a combined finish
must name the Recording's actual Stream. Standalone lifecycle writes are also
transactional. Database errors propagate without stale JSON fallback. Media
bytes and watchlist projection are not part of these transactions; no history
operation deletes files. Location browsing continues to resolve persisted
`output_file` through the existing read-only containment checks.

New Stream and Recording starts require a valid Date or ISO timestamp with explicit Z or
offset. Typed timestamps serialize as ISO UTC. Legacy raw start/finish text is
returned unchanged when no typed instant exists; timezone-free values are
never silently assigned UTC. Raw-only historical Streams and Recordings enter
exclusively via historical import or direct database fixtures, not `createStream`
or `createRecording`. The isolated integration suite covers
concurrent reuse, retries, later broadcasts, both transaction rollback paths,
immutable snapshots, HTTP/session reads, file locations, reconnect and outage.

## Opt-In Worker Bridge (Task 05)

Existing installations remain JSON-authoritative by default. Task 05 adds no
automatic import or cutover. In disposable relational environments only, apply
migrations (including `0002_worker_events`), set API `RELATIONAL_STORAGE=true`
and `DATABASE_URL`, then opt the Worker in with `PERSISTENCE_MODE=bridge` or a
non-empty `PERSISTENCE_BRIDGE_URL` (the API base URL, without `/internal/v1`).
With only the mode set, the base URL defaults to `http://api:3000`.
Set matching, explicitly configured, non-empty `INTERNAL_API_TOKEN` values on both
services. Unset, empty, or whitespace-only tokens fail closed: the API rejects
internal requests with 401 and the Worker bridge refuses initialization. There is no fallback token;
it is not secure hosted authentication. Keep the internal routes off public
networks and outside the frontend proxy. Redirects are rejected to avoid
forwarding the token to another destination.

`GET /internal/v1/watch-targets/execution-configs` returns non-archived targets,
including disabled configurations. The Worker uses this endpoint on every
poll and immediately before launch, never the projected watchlist. An API/DB
failure blocks new probes/captures rather than falling back to JSON. Both
internal routes require the token and return 503 when relational mode is off
or its database is unavailable. Idle pool disconnects are handled with safe
warnings and subsequent operations reconnect.

`POST /internal/v1/events` accepts `recording.start`, `recording.terminal`, and
`stream.offline` with UUID event/entity IDs and explicit-offset timestamps.
Each event and its SHA-256 canonical-payload fingerprint commit together with
the domain changes in one PostgreSQL transaction. Per-event and per-target
transaction locks serialize concurrent deliveries. Exact replay returns the
stored acknowledgement, including after an API restart; conflicting ID reuse
returns 409. A start creates/reuses the active Stream and creates one Recording
with immutable target context. A terminal cannot precede its start, change
targets, or regress an already-terminal Recording. It does not by itself prove
the broadcast ended. Only confirmed OFFLINE closes an open Stream with no
active Recording. Out-of-order terminals return 409 without acknowledgement;
the retained event requires start delivery/reconciliation before retry.

### Outbox And Recovery

The Worker alone owns `OUTBOX_DIR` (default: `outbox` alongside the resolved
status file, normally `/data/outbox`). Keep it on persistent storage and run
only one Worker against it. API/PostgreSQL alone own domain history; the Worker
does not initialize, read, or write watchlist/Stream/Recording JSON in bridge
mode. `channels_status.json` remains a replaceable runtime projection, not a
heartbeat or a durability receipt.

Events use atomic same-directory temporary writes, file fsync, rename, and
directory fsync where supported. `pending/{timestamp_ms}_{sequence}_{event_id}.json`
is replayed FIFO. Bounds are 1,000 pending events and 64 KiB per event/checkpoint.
Any pending delivery blocks new launches; existing captures and terminal writes
continue. Delivery/config reads use exponential backoff with jitter (up to 90
seconds between attempts), with a 10-second HTTP timeout. An invalid event or
persistent HTTP error remains on disk and requires operator reconciliation;
it is never silently discarded. The outbox contains private output metadata
and must be protected like the other local runtime files.

`active/{session_id}.json` is written before enqueueing a start. Only a durable
API acknowledgement allows child launch; the canonical Stream ID, child PID,
and launch-time observation are checkpointed. A terminal event is saved in the
checkpoint before enqueueing, keeping its ID immutable across restart and
lost acknowledgements. Local output is retained, and operational state does not
claim `finished` until the terminal acknowledgement. A disk error leaves the
checkpoint or managed in-memory terminal pending; fix storage before restarting
or declaring persistence successful.

Startup replays pending events before scanning active checkpoints:

- A verified-dead recorded PID produces `error` with reason
	`worker_restart_interruption`; its checkpoint is removed only after terminal
	acknowledgement. Windows uses read-only process queries, never `os.kill`.
- Missing/live/uncertain PIDs block only that target and retain its checkpoint.
	PID reuse also remains blocked; no unknown process is terminated. Other
	targets can proceed once pending deliveries are drained.
- A saved terminal event replays its original outcome and ID, not a fabricated
	interruption. A corrupt checkpoint refuses Worker startup; corrupt pending
	events block launches instead of losing data.

For ambiguous ownership, stop new work, preserve outbox/media, identify the
actual capture process and corresponding database Recording, and reconcile the
attempt explicitly. Do not delete a checkpoint or kill a PID solely because
its numeric value appears in the file. There is no automated/public reconciler
in this task. Rollback requires quiescing and reconciling pending events before
changing authority; never replay them into stale JSON as a fallback.

### Recovery Evidence

`node scripts/test-db-foundation.mjs` includes the internal bridge integration
suite, enables its guarded real test-database restart, checks retained metadata
after container recreation, and removes only its disposable project/volume.
Python must be available (`PYTHON` can select its executable). The seven matrix
rows are covered by internal API and fake-process Worker tests:

| Scenario | Automated evidence |
| --- | --- |
| Unavailable before capture | Actual stopped test PostgreSQL returns 503; Worker unit tests prevent launch without start acknowledgement/config refresh. |
| Unavailable during capture | A fake-process Worker stays managed through actual PostgreSQL shutdown; output remains local. |
| Terminal write outage | The same Worker retains its checkpoint/event and pending runtime state, then retries after PostgreSQL returns. |
| Worker restart | A terminated Python process's verified-dead PID is reconciled through the real API/database; unit tests cover ambiguous ownership and immutable saved terminals. |
| API restart | The API application/pool is recreated and returns the original committed response without duplicate rows. |
| PostgreSQL restart | Terminal replay succeeds after actual test PostgreSQL restart; the foundation harness also recreates the container and verifies retained data. |
| Duplicate/out-of-order | Concurrent/exact replay, conflicting payloads, pre-start terminals, cross-target updates and terminal regressions use the real database. |

Fake subprocesses and fixture bytes do not prove real-platform behavior, MP4
validity, or playability. This stage does not modify the media pipeline.