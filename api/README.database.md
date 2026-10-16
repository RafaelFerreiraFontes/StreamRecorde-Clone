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