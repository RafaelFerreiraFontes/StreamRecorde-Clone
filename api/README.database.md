# Wave 05 PostgreSQL Persistence And Operations

## Post-Wave 05.5 Production Operations

Approved checkpoint modes B/C add `compose.relational.yml` to base Compose for PostgreSQL 17 and Worker bridge persistence. C also adds `compose.authenticated.yml`. See the [root operational guide](../README.md#1-operational-checkpoint-status). B/C require private `POSTGRES_PASSWORD` and matching API/Worker `INTERNAL_API_TOKEN`; C requires exact `AUTH_TRUSTED_ORIGINS`.

For a built production API image run `node dist/database/migrate.js`, then `node dist/auth/users-cli.js create <username> [--email <email>]` with interactive no-echo password entry. Approved production wrappers are `db:migrate:prod` and `users:prod`. Existing source scripts remain `pnpm --dir api db:migrate` and `pnpm --dir api users ...`. Do not run source/ts-node scripts in the production image. Use a one-off container if the API cannot start before migration/account enrollment; the CLI does not require the HTTP server to be healthy.

Authenticated startup fails closed for missing relational configuration, unreachable database, missing ownership schema/constraints or lack of an enabled password-enrolled account. It does not migrate or import automatically. Back up and quiesce writers before the legacy migration procedure below. After cutover, PostgreSQL is authority; operational `channels_status.json` is not a domain backup and stale JSON is not rollback.

Preserve the bridge named volume `worker-outbox` mounted at `/outbox`, including pending events and active checkpoints, alongside database/media backups. Stop new work, allow or account for active captures, and record pending state before backup. Recover by restoring database/API connectivity and observing durable event acknowledgment; never delete outbox files to make a backlog disappear. Use the [unfilled stability matrix](../docs/DOCKER-STABILITY-TESTING.md) for outage/restart evidence. No new human recovery test is claimed here.

## Wave 05.5 Operations: Supported Modes And Activation Gate

| Persistence / identity     | Normal startup  | Operator contract                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON / local               | Default         | `RELATIONAL_STORAGE=false`, `IDENTITY_MODE=local`, `PERSISTENCE_MODE=direct_json`; no login, DB or User creation.                                                                                                                                                                                                                   |
| PostgreSQL / local         | Opt-in          | `RELATIONAL_STORAGE=true`, `IDENTITY_MODE=local`, explicit migrations and `DATABASE_URL`; one persistent bootstrap `local` User. Use `PERSISTENCE_MODE=bridge` on API and Worker for relational authority.                                                                                                                          |
| JSON / authenticated       | Unsupported     | Fails closed; never switches persistence or invents an owner.                                                                                                                                                                                                                                                                       |
| PostgreSQL / authenticated | Explicit opt-in | Set `IDENTITY_MODE=authenticated`, `RELATIONAL_STORAGE=true`, valid PostgreSQL `DATABASE_URL` and non-empty exact `AUTH_TRUSTED_ORIGINS`. Startup validates reachability, Wave 05.5 ownership schema/composite constraints and an enabled password-enrolled user before JSON initialization or HTTP listening; any failure exits 1. |

Local remains the default. Apply migrations and provision an enabled password user
before explicitly opting into authenticated startup. Validation does not migrate
or enroll users automatically; account provisioning alone does not activate login. Keep `DATABASE_URL` and `INTERNAL_API_TOKEN` server-side; never
commit them or put them in browser configuration/logs. `AUTH_TRUSTED_ORIGINS`
configures exact browser origins, not internal Worker identity. See account,
cookie and Origin policy below. There is no public signup or default credential.

### Clean Installation, Upgrade And Recovery Checkpoints

- Clean relational installation: set an explicitly selected database connection,
  run `pnpm --dir api db:migrate` (checked-in migrations 0000–0004), then start
  relational/local API and bridge Worker. Migrations are not startup side effects.
- Existing relational installation: quiesce writers and retain a tested,
  known-good database backup before applying the ownership migration. Existing
  domain rows belong to bootstrap `local`; IDs, history, raw timestamps,
  unknown `stream_id` links and media metadata must survive. Do not import a
  legacy snapshot into a populated destination.
- Legacy JSON: follow dry-run -> quiesced backup -> SHA-256 manifest verification
  -> explicit schema migration -> transactional import -> verify -> cutover-check
  below. Drain Worker `pending/` and reconcile `active/` checkpoints explicitly;
  `--quiesced` is an operator assertion, not a remote writer detector.
- Before writes switch authority, retain source snapshots, DB backup, outbox and
  private media. After relational writes, prefer forward repair. Never silently
  switch to JSON, downgrade migrations or discard events to make a gate pass.

### Approved Relational/Local Rollback (Decision Section 12)

This is a rehearsal/runbook, not authorization for normal-installation changes.
If authenticated operation is separately activated later:

1. Stop new launches and quiesce API/Worker writers. Finish accepted captures,
   drain pending events and reconcile active checkpoints. Preserve media/outbox.
2. Take and verify a known-good relational backup with the deployment's PostgreSQL
   backup tooling. Test restoration only into a separate disposable database;
   a backup command returning zero does not establish restore correctness.
3. Revoke sessions before reopening access. Against the explicitly selected,
   quiesced relational database, an approved operator can execute
   `UPDATE sessions SET revoked_at = NOW() WHERE revoked_at IS NULL;` and verify
   no unrevoked sessions remain. This is not a public API or automatic startup
   action. CLI disablement also transactionally revokes that account's sessions.
   Disable other accounts via `pnpm --dir api users disable <username>` when
   their monitoring must stop; re-enabling does not restore revoked sessions.
   Preserve the bootstrap account and verify its identity rather than
   deleting/recreating it.
4. Explicitly select `IDENTITY_MODE=local`, retain `RELATIONAL_STORAGE=true`,
   `PERSISTENCE_MODE=bridge` and the verified relational database. Restart services
   only after writer/outbox reconciliation. Do not select direct JSON authority.
5. Verify bootstrap `local` domain visibility. Other-owner rows remain stored,
   unchanged and invisible to local-principal domain routes. The Worker still
   receives enabled targets of all non-disabled owners: local human identity
   is not a Worker ownership filter.

**Privacy warning:** local filesystem browsing is a trusted single-operator view
of the shared recording root and can reveal other users' filenames. Returning
to local mode is not a private multi-user deployment. No rollback reassigns or
deletes owners, moves media, drops volumes or automatically restores a backup.
Any restore that loses committed metadata requires an explicit reconciliation
and human decision before writers resume.

### Troubleshooting And Evidence Limits

- 401: expired/revoked session or disabled account; sign in again only after the
  cause is resolved. Domain 404 includes foreign/missing IDs and does not mean
  logout. Invalid unsafe Origin/Referer is 403; rate limiting can return 429.
- 503 in relational mode: restore PostgreSQL connectivity/schema availability;
  never select JSON or bootstrap fallback to hide an outage. Frontend proxy
  transport errors/timeouts are not successful local-session discovery.
- API/DB restart: valid sessions and committed domain ownership are durable.
  Worker restart: retain its single-owner `OUTBOX_DIR`; replay pending events
  and recover active checkpoints before new work. Acknowledgement follows commit.
- Human logout/expiry does not cancel an accepted capture. Account disablement
  blocks new launches but permits already accepted work to finish durably.
- Startup failure: check the selected mode, explicit migrations, connection and
  internal-token prerequisites without printing secrets. Authenticated startup's
  fixed guard is expected in Phase A/C, not an installation defect to bypass.

Regression gates: root `pnpm lint`, `pnpm format:check`, `git diff --check`;
API typecheck/test/build; frontend typecheck/test/build and guarded HTTP
integration; Worker unittest/pytest; `node scripts/test-db-foundation.mjs`,
`node scripts/test-wave05-rehearsal.mjs`, Compose config and `pnpm test:smoke`.
Use only disposable resources. Required skipped/blocked checks are not PASS.
Synthetic Streamlink output does not establish playable MP4 or live-platform
recovery. No public media, per-user physical folders, hosted deployment, Redis,
Tags, SSE or cloud export is introduced.

## Wave 05.5 Task 04: Domain Authorization

Task 04 propagates the verified human principal through modern domain and
legacy `/streamer` and `/session` routes. Owner IDs are explicit request-local
arguments, never shared singleton state. Relational reads, filters, updates
and archives are scoped in SQL; creation and automatic Creator grouping use
the resolved owner, including owner-scoped advisory locks. Client-supplied
`owner_id` and `ownerId` mutation fields are rejected with 400. Identity claims
in query parameters or headers never select the owner.

JSON/local behavior remains single-user and creates no database user.
Relational/local routes resolve only the bootstrap `local` owner; other
accounts' rows remain stored and invisible. Direct relational service calls
without an owner retain this bootstrap-local behavior. An explicitly supplied
invalid owner fails rather than falling back to local.

In isolated authenticated testing apps, domain routes require a valid
`sr_session`; missing, expired, revoked, or disabled-user sessions return 401.
The internal Worker token is not a human credential. Unsafe POST/PATCH/DELETE
requests additionally require a trusted Origin or Referer (403 otherwise).
Unknown and foreign resources or parent filters return 404. Same-name Creators
are independent across owners; ambiguous active names within one owner return 409. Database failures return a bounded `503 Database unavailable`, without SQL
details or a JSON fallback.

History retains its original owner after configuration archival. Recording
and Session detail reads include legacy recordings with NULL `stream_id`.
`GET /recordings?watchTargetId=...` and `GET /session/channel/:id` first authorize
the target, including archived owned targets; foreign or unknown filters
return 404 rather than an empty list. Existing IDs, raw timestamps and
`finished` success states are unchanged.

Authenticated filesystem listing is unavailable: `GET /recordings/filesystem`
returns 404 after authentication. `GET /recordings/:id/location` checks ownership
first (foreign/missing IDs return 404) and returns only owner-safe metadata,
without sibling filenames or absolute server paths. Local mode retains the
existing trusted single-operator browser; relational/local location lookup
authorizes the bootstrap owner's recording.
No media is moved, exposed or deleted. Privileged internal Worker operations
retain their existing token-based contracts and are not human-owner-scoped.

Phase B now permits `IDENTITY_MODE=authenticated` only after the fail-closed
startup prerequisites above pass. JSON/authenticated remains unsupported.
The two-user HTTP authorization suite uses real login sessions, an isolated
PostgreSQL database and temporary filesystem fixtures. It is registered in
`test:db:integration` and the disposable foundation harness below.

## Wave 05.5 Task 03: Accounts And Sessions

Task 03 adds CLI-only account provisioning and `/auth/session`, `/auth/login`,
and `/auth/logout`. Phase B enables explicitly configured authenticated startup
with the fail-closed prerequisites above. Tests exercise authenticated paths using
isolated Nest testing apps.
There is no registration endpoint, default password or automatic data cutover.

Apply the explicit migrations first and configure `DATABASE_URL` for the
intended database. Run these commands from the repository root:

```bash
pnpm --dir api users create alice --email alice@example.test
pnpm --dir api users set-password local
pnpm --dir api users disable alice
pnpm --dir api users enable alice
pnpm --dir api users list
```

`create` and `set-password` read one password from a no-echo TTY prompt or
piped stdin. Never put a password in argv, shell history or a committed file;
password flags and extra positional arguments are rejected. Passwords are
12-256 characters, stored as salted asynchronous scrypt hashes (N=32768,
r=8, p=1, 64-byte key, 16-byte salt). Username and optional email are trimmed,
NFKC-normalized and lowercased. Username must match
`^[a-z0-9][a-z0-9._-]{2,31}$`. Email is not a login identifier. The `list`
command exposes account status, not password hashes. `set-password local`
preserves the bootstrap UUID and bootstrap key. Disablement revokes all
sessions transactionally without deleting domain history; enablement clears
lockout state. Password enrollment also clears failed-login/lockout state.

In default JSON/local mode, `GET /auth/session` returns local/json with
`user: null` and creates no database identity. Relational/local mode resolves
the stable bootstrap local user. Login/logout are 404 in local mode. Database
failure in relational mode returns a bounded 503, never JSON/local fallback.
Public identities contain only `id`, `username`, and `email`.

For the future authenticated mode, configure `AUTH_TRUSTED_ORIGINS` as a
comma-separated list of exact HTTP/HTTPS origins, for example
`http://localhost:3000,https://app.example.test`. Paths, trailing slashes,
wildcards, credentials, queries and fragments are invalid. Every unsafe
cookie request (including login/logout) requires a matching Origin, with
Referer-origin fallback only when Origin is absent. Missing/untrusted origins
or an empty allowlist return 403. CORS remains disabled. T04 uses
`AuthService.requireUnsafeOrigin` and `resolvePrincipal` for domain guards.
Human identity never accepts `x-internal-token` or client-supplied owner IDs;
Worker service authentication remains separate.

Sessions use 32-byte random opaque tokens, stored only as SHA-256 hashes.
The host-only `sr_session` cookie is HttpOnly, Path=/, SameSite=Lax and Secure
only for a validated HTTPS origin. All auth responses are no-store. Sessions
expire after 24 idle hours or seven absolute days; use extends idle expiry at
most once per five minutes without exceeding the absolute deadline. Login
rotates any supplied previous session and opportunistically purges expired
sessions. Logout revokes the current session and clears the cookie; repeated
logout is 401. Disabled users cannot use existing sessions. Valid sessions
survive API/database restarts; no signing secret is required.

Unknown users, wrong passwords, disabled accounts and locked accounts receive
the same `401 {"message":"Invalid credentials"}`. Ten consecutive account
failures produce a 15-minute database lock; concurrent failures serialize on
the account row. Successful login resets the counter. The additional bounded
in-process source-IP limiter permits 20 attempts per 15 minutes, uses the
socket address rather than forwarded headers, and is best effort across API
instances/restarts. It returns 429 when exhausted.

Deterministic auth unit tests run with the API suite. The auth PostgreSQL
integration suite is registered in `test:db:integration` and runs with
`node scripts/test-db-foundation.mjs` against the disposable test database,
including lifecycle, lockout, outages and API/database restart durability.
These tests never use normal runtime data or recordings.

Tasks 01-06 implement the persistence transition: Drizzle/PostgreSQL schema,
stable Creator/WatchTarget CRUD, relational Stream/Recording history, internal
Worker events, durable outbox recovery, and explicit legacy migration/cutover.
Task 07 integrates QA/documentation; implementation does not imply final wave
acceptance or automatic activation of an existing installation.

Default Compose remains JSON-authoritative (`RELATIONAL_STORAGE=false`, Worker
`PERSISTENCE_MODE=direct_json`). Opt-in relational bridge mode makes PostgreSQL
the single authority for all four domain entities; JSON is retained for backup
and compatibility, not fallback. `channels_status.json` may remain operational,
but is not imported as domain history. Media remains private local filesystem data.

For a clean synthetic container rehearsal run
`node scripts/docker-bridge-smoke.mjs` from the repository root. This uses real
PostgreSQL/API/Worker/frontend containers, fake Streamlink, disposable named
volumes and random loopback ports. It checks migrations, fresh capture/Stream
linkage and database/API restart durability, not the full outage/migration matrix.
Use `node scripts/test-db-foundation.mjs` for the isolated repository/import,
failure/recovery and migration suites described below. Neither command may use
normal runtime-data, recordings or database volumes.

## Legacy JSON Migration And Authority Cutover (Task 06)

Migration is explicit and opt-in. Startup never imports or changes authority.
Rehearse only with synthetic files and the isolated test database, never normal
runtime data, recordings, or Docker volumes. The CLI never reads media, changes
source files, exports DB state to JSON, or changes service environments. Import
requires an empty domain database; it is not a merge/upsert tool.

### Quiesce And Capture

1. Prevent new launches (disable targets through the current API if necessary),
   wait for existing captures and terminal persistence to finish, and record any
   configuration changes. Disabled targets remain disabled after migration.
2. If an outbox exists, drain pending events and resolve active checkpoints.
   Never delete pending events to force a gate. Stop API and Worker writers.
3. Retain original JSON, outbox/checkpoints and media. Back up any existing DB;
   use a new empty destination rather than dropping existing data for import.
4. Run dry-run and resolve every error. Exact repeated Creator names group
   sibling targets. Different trimmed spellings with the same lowercase key are
   ambiguous: correct an explicitly reviewed source copy rather than guessing
   by channel or URL. No automatic mapping override is provided.
5. Capture a new backup outside the source directory. `--quiesced` attests that
   writers are stopped and the outbox is drained; it cannot prove remote process
   state. The CLI rereads all bytes to reject observed movement during capture.

Examples from the repository root (placeholder private synthetic directories):

```bash
pnpm --dir api migrate:legacy dry-run --source /private/synthetic-source
pnpm --dir api migrate:legacy backup --source /private/synthetic-source --destination /private/synthetic-backup --quiesced
```

watchlist.json, streams.json and sessions.json are required. Missing files,
malformed shapes, duplicate object keys/IDs, invalid UUIDs/states/configuration,
orphan history, ambiguous Creators and multiple open Streams fail validation.
channels_status.json is optional, validated/backed up, and never imported as
domain history. An open Stream has neither typed nor raw finish evidence.

manifest.json records origin paths, sizes, SHA-256 checksums, capture time, tool
version, expected counts, destination schema (`public`) and quiescence attestations.
A fingerprint binds all fields. Checksums detect drift, not malicious replacement
of both manifest and files. Protect snapshots with OS permissions/ACLs; never
commit them. Backup directories/files are created exclusively with restrictive
POSIX modes; configure private directory ACLs on Windows. An interrupted backup
leaves its partial directory for inspection; retry with a new destination.

### Import And Verify

Set DATABASE_URL explicitly to the disposable destination for rehearsals. Apply
checked-in migrations first, including 0004_user_ownership. The CLI never
migrates the schema implicitly.

```bash
pnpm --dir api db:migrate
pnpm --dir api migrate:legacy import --snapshot /private/synthetic-backup --manifest /private/synthetic-backup/manifest.json --quiesced
pnpm --dir api migrate:legacy verify --snapshot /private/synthetic-backup --manifest /private/synthetic-backup/manifest.json
```

All source constraints, digests and counts are checked before database access.
Creators, targets, Streams, Recordings and the manifest ledger commit in one
transaction with table locks, or all roll back. Creator UUIDs derive from a
versioned SHA-256 namespace and trim/lowercase key. Target/Stream/session UUIDs
are preserved with canonical lowercase encoding. Missing enabled defaults to
true; preferences and sibling independence remain intact. Safe folder separators
normalize to `/`.

Legacy timestamps remain verbatim raw strings with typed columns NULL; no timezone
conversion is attempted, even for text with offsets. Legacy Recording stream_id
and unavailable historical configuration snapshots remain NULL. Current target
settings are not historical facts. Output paths are metadata only.

Identical replay checks ledger digests/counts and returns `idempotence-verified`
without overwriting newer domain state. Snapshot drift, conflicting manifests,
pre-existing destination rows or ledger conflicts fail explicitly. `verify`
checks exact counts, IDs, imported fields and relationships in a repeatable-read
transaction. Run it before activation: legitimate later edits cause exact
snapshot verification to fail. No lossy repair is attempted.

### Activate And Observe

After verification, configure both stopped services as one checkpoint:

- API: RELATIONAL_STORAGE=true, PERSISTENCE_MODE=bridge, DATABASE_URL and a
  non-empty INTERNAL_API_TOKEN.
- Worker: PERSISTENCE_MODE=bridge, matching INTERNAL_API_TOKEN, persistent
  OUTBOX_DIR and PERSISTENCE_BRIDGE_URL pointing at the internal API base URL.

Use a private Compose override/service configuration. Default Compose deliberately
does not forward these flags or tokens; host shell variables alone do not configure
containers. Never put tokens in command arguments, Git, snapshots or printed
Compose output. API PERSISTENCE_MODE=bridge retires watchlist projection after
mutations; without it the Task 03 projection remains enabled. Never run a JSON
Worker alongside relational writers. Start API, check readiness, then start the
bridge Worker. Retain original files read-only for recovery.

In a shell with matching flags/token and the destination DB:

```bash
pnpm --dir api migrate:legacy cutover-check --source /private/synthetic-source --api-url http://127.0.0.1:3000 --observation-ms 65000 --outbox /private/worker-outbox
```

The optional `--outbox <path>` must point to the Worker's actual outbox directory.
The directory and its `pending/` and `active/` subdirectories must exist and be
directories; the check fails closed if any are missing or are not directories.
Complete cutover readiness requires verifying that both `pending` and `active`
contain no `.json` events/checkpoints; unresolved work fails the check. A drained
outbox returns `cutover-readiness-verified` with `outboxStatus: "drained"`.
Without `--outbox`, the result is only `api-database-ready` with
`outboxStatus: "unverified"`, not complete Worker bridge cutover readiness.

This checks DB connectivity, the authenticated execution-configs response and
unchanged domain JSON hashes during a bounded observation (1 second to 10 minutes).
Operational channels_status.json may change. Redirects are rejected; non-local
token transport requires HTTPS. It does not prove Worker liveness, actual remote
process environments, or permanent absence of writers. In an isolated rehearsal,
exercise a synthetic lifecycle and target edit, verify DB/outbox acknowledgement
and unchanged domain files. Do not use live platform calls as fixtures.

Operational guarantees: `cutover-check` is a diagnostic read-only probe; it does
not pause, stop, or reconfigure running API or Worker containers. The operator
must manually stop services, apply configuration flags, restart containers in
coordinated order, and monitor bridge operation. Atomicity across separate
container environments is an operational procedure requiring manual coordination,
not a single automated CLI transaction.

### Rollback And Forward Repair

Before activation/new relational writes: stop both services, retain DB/backup for
diagnosis, unset RELATIONAL_STORAGE, PERSISTENCE_MODE and PERSISTENCE_BRIDGE_URL,
then restart in JSON mode. Import did not change originals. Only the owning
harness may remove disposable database resources.

After any post-cutover write: never reverse-export to legacy JSON or switch back
to stale snapshots. Freeze launches, preserve PostgreSQL, migration ledger,
outbox/checkpoints and media, repair the component and resume/replay through the
existing idempotent bridge. Disaster restore requires a full consistent DB backup
and reviewed outbox reconciliation, not an automatic migrator action. There is
no destructive rollback or media cleanup command.

### Validation

`node scripts/test-db-foundation.mjs` includes the migration integration suite
through the API test harness, using temporary fixtures and the isolated DB.
It covers identity, raw timestamps, unknown Stream links, late-failure rollback,
conflicts, verification and checkpoint preservation. The `migrator` Jest suites
cover non-destructive parsing, duplicate keys, checksums and cutover failures.

Task 02 originally introduced the inert foundation. Tasks 03-06 now provide
opt-in relational repositories, bridge events and cutover tooling. JSON remains
the default authority until explicit activation. The database service is lazy;
HTTP liveness alone does not prove relational readiness. Check database-backed
routes and authenticated execution configuration before launching the Worker.

## Wave 05.5 Task 02: Local User And Ownership Foundation

Migration `0004_user_ownership` adds User and session storage and explicit
`owner_id` on Creators, WatchTargets, Streams, Recordings and migration manifests.
It does not activate authentication, implement sessions/login, scope all API
queries, or change normal installation authority. Authorization and authenticated
startup gating remain successor-task work; this checkpoint is not a multi-user
security boundary. JSON remains the unchanged, single-user default and creates
no User. Do not enable authenticated operation at this checkpoint.

The bootstrap account has `bootstrap_key='local'`, canonical username `local`
and no password. Its UUID is generated once, not derived from its username.
Migration creates it and runtime insertion paths repair a missing bootstrap via
insert-on-conflict followed by reselect. Concurrent bootstrap calls converge on
the same persistent UUID. A username collision without the designated bootstrap
key fails rather than adopting an arbitrary account. No password, login route,
account-management CLI, automatic downgrade or ownership transfer is supplied.
Usernames must match `^[a-z0-9][a-z0-9._-]{2,31}$`; optional email is unique when
present. Account input normalization belongs to the forthcoming account writer.
The new `sessions` table is an inert authentication foundation, distinct from
legacy Recording/session resources and JSON files.

### Synthetic Fresh Install And Repeat Migration

From the repository root in Bash, use only the disposable Compose project:

```bash
docker compose -f compose.test-db.yml -p streamrecorder-test-db up -d --wait
export DATABASE_URL='postgresql://streamrecorder_test:streamrecorder_test_local@127.0.0.1:55432/streamrecorder_test'
pnpm --dir api db:migrate
pnpm --dir api db:migrate
docker compose -f compose.test-db.yml -p streamrecorder-test-db exec -T postgres-test psql -U streamrecorder_test -d streamrecorder_test -c "SELECT id, bootstrap_key, username, password_hash IS NULL AS passwordless FROM users;"
```

Expect one passwordless local User and empty domain/session tables on a fresh
database. Rerunning the migration runner is a no-op; do not execute raw migration
SQL twice. Applied Wave 05 migrations are unchanged. All migration statements
and ledger advancement run in the existing Drizzle migration transaction.

### Populated Relational Upgrade And Recovery

No real installation upgrade is authorized by this task. For any separately
authorized upgrade, first quiesce all API/Worker writers, drain/reconcile outbox
work, and take a verified consistent PostgreSQL backup. Record domain and
manifest counts, IDs and historical fields before applying `db:migrate` to the
explicit destination. The same migration assigns all existing rows/manifests to
the designated local UUID, then enforces NOT NULL and composite parent/owner
foreign keys. Existing IDs, typed/raw timestamps, NULL Stream links, archival
state, configuration and output paths remain unchanged; no media is accessed.

Rehearse populated upgrade and late-failure recovery with synthetic data only:

```bash
node scripts/test-db-foundation.mjs
```

The harness uses port 55432, temporary schemas/source files and the test-only
volume. It checks fresh/repeated migrations, concurrent bootstrap, populated
Wave 05 backfill, late-failure rollback, cross-owner FK rejection, imports and
restart durability, then removes only its disposable project/volume. Do not run
it while another process owns that test project or database. A failed migration
does not switch authority: retain diagnostics/backup, inspect migration state,
repair forward and rerun the runner, or restore the verified backup while
writers remain stopped. Never manually mark a failed migration applied, remove
normal volumes, reassign owners, or fall back to stale JSON after relational
writes.

### Legacy Import And Owner-Aware Replay

Keep `TOOL_VERSION=legacy-json-v1` and the existing manifest file format. With
`DATABASE_URL` still pointing at the disposable database, use a new empty domain
database and synthetic private paths:

```bash
pnpm --dir api migrate:legacy dry-run --source /private/synthetic-source
pnpm --dir api migrate:legacy backup --source /private/synthetic-source --destination /private/synthetic-backup --quiesced
pnpm --dir api migrate:legacy import --snapshot /private/synthetic-backup --manifest /private/synthetic-backup/manifest.json --quiesced
pnpm --dir api migrate:legacy verify --snapshot /private/synthetic-backup --manifest /private/synthetic-backup/manifest.json
pnpm --dir api migrate:legacy import --snapshot /private/synthetic-backup --manifest /private/synthetic-backup/manifest.json --quiesced
```

Import resolves bootstrap inside the import transaction and assigns it to every
row and manifest. Existing destination rows still reject first import, including
foreign-owner ID collisions. Replay compares manifest provenance and ownership
of surviving imported IDs without overwriting later edits. Unrelated new owners
are not imported identities. Read-only verification compares bootstrap owner,
ledger, counts and all imported fields. A conflicting owner or ledger fails
without reassignment; do not edit manifests/owners to force acceptance. Preserve
the database, snapshot and outbox for diagnosis/forward repair. Cleanup is only
for resources created by the isolated rehearsal:

```bash
docker compose -f compose.test-db.yml -p streamrecorder-test-db down --volumes
unset DATABASE_URL
```

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
Task 06 supplies the explicit existing-installation checkpoint above. Until
that checkpoint is complete, use disposable compatibility fixtures. Apply migrations
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
automatic import or cutover. After the Task 06 checkpoint, or in disposable relational environments, apply
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

| Scenario                   | Automated evidence                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unavailable before capture | Actual stopped test PostgreSQL returns 503; Worker unit tests prevent launch without start acknowledgement/config refresh.                                       |
| Unavailable during capture | A fake-process Worker stays managed through actual PostgreSQL shutdown; output remains local.                                                                    |
| Terminal write outage      | The same Worker retains its checkpoint/event and pending runtime state, then retries after PostgreSQL returns.                                                   |
| Worker restart             | A terminated Python process's verified-dead PID is reconciled through the real API/database; unit tests cover ambiguous ownership and immutable saved terminals. |
| API restart                | The API application/pool is recreated and returns the original committed response without duplicate rows.                                                        |
| PostgreSQL restart         | Terminal replay succeeds after actual test PostgreSQL restart; the foundation harness also recreates the container and verifies retained data.                   |
| Duplicate/out-of-order     | Concurrent/exact replay, conflicting payloads, pre-start terminals, cross-target updates and terminal regressions use the real database.                         |

Fake subprocesses and fixture bytes do not prove real-platform behavior, MP4
validity, or playability. This stage does not modify the media pipeline.
