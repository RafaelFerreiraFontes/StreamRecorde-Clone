# Wave 05.5 — Authentication and Ownership Decisions

**Status:** Accepted for implementation pending human acceptance of T01; nothing here is implemented.

## 1 Decision Status and Scope

This is the binding, documentation-only decision record for Wave 05.5 tasks [T02](02-user-schema-migration.task.md) through [T07](07-wave-integration-qa-documentation.task.md). It preserves the accepted Wave 05 persistence decisions in [persistence-architecture-decisions.md](../wave-05/persistence-architecture-decisions.md) and [the database runbook](../../../api/README.database.md). Proposed tables, routes, environment variables, CLI commands, migrations, and behavior below are **PLANNED / not implemented**. No application code, schema, dependency, runtime setting, or user data changes are authorized by this document.

Local mode is the default single-user compatibility mode. Authenticated mode is an explicitly gated, local-validation capability, not a hosted/public-service authorization. All mode selection, database migration, account bootstrap, and activation remain explicit operator actions.

## 2 Verified Repository Baseline

| Boundary | Verified current behavior | Evidence link |
|---|---|---|
| Modern and internal stream controllers | Modern stream routes are public today. Internal routes compare `x-internal-token` to `INTERNAL_API_TOKEN` in constant time and fail closed when the token is unavailable or unequal. | [streams.controller.ts](../../../api/src/streams/streams.controller.ts); [internal-streams.controller.ts](../../../api/src/streams/internal-streams.controller.ts) |
| Filesystem browser | The browser is read-only, limits listings to 1,000 entries, rejects symlinks, and enforces canonical containment. `location()` currently returns sibling entries. | [recordings-filesystem.controller.ts](../../../api/src/streams/recordings-filesystem.controller.ts); [recordings-filesystem.service.ts](../../../api/src/streams/recordings-filesystem.service.ts) |
| Stream persistence | The service uses repository selection; relational legacy name lookup can be ambiguous (409) and uses an owner-to-be-scoped advisory lock. | [streams.service.ts](../../../api/src/streams/streams.service.ts); [streams.repository.ts](../../../api/src/streams/streams.repository.ts); [relational-streams.repository.ts](../../../api/src/streams/relational-streams.repository.ts) |
| Worker event bridge | Internal Worker events use the existing internal-events service bridge. | [internal-events.service.ts](../../../api/src/streams/internal-events.service.ts) |
| Database and migrations | There are no users or owners. `recordings.stream_id` is nullable and `(stream_id, watch_target_id)` is a foreign key. Database migration is explicit; migrations 0000–0003 exist. | [schema.ts](../../../api/src/database/schema.ts); [database.service.ts](../../../api/src/database/database.service.ts); [migrate.ts](../../../api/src/database/migrate.ts); [migrations](../../../api/drizzle/migrations/) |
| Migrator | The CLI/migrator use snapshots and cutover; snapshot import strictly requires matching `TOOL_VERSION`. | [cli.ts](../../../api/src/migrator/cli.ts); [migrator.ts](../../../api/src/migrator/migrator.ts); [snapshot.ts](../../../api/src/migrator/snapshot.ts); [cutover.ts](../../../api/src/migrator/cutover.ts) |
| API startup | Startup configures neither CORS nor migrations. | [main.ts](../../../api/src/main.ts) |
| Frontend proxy and API client | The current proxy GET allowlist includes creators, watch-targets, streams, recordings, streamer, session, and filesystem/location shapes. Writes are limited to watch-target POST/PATCH/DELETE; Origin is checked only on mutations when present; cookies are not forwarded. | [proxy route](<../../../frontend/app/api/backend/[...path]/route.ts>); [api.ts](../../../frontend/lib/api.ts) |
| Dashboard and recording browser | Provider snapshots survive request errors; the recording browser consumes the current filesystem/location behavior. | [provider.tsx](../../../frontend/components/provider.tsx); [recording-browser.tsx](../../../frontend/components/recording-browser.tsx) |
| Worker and deployment defaults | The Worker/outbox use the internal bridge. Compose defaults are `RELATIONAL_STORAGE=false` and `PERSISTENCE_MODE=direct_json`. | [worker.py](../../../worker/worker.py); [outbox.py](../../../worker/outbox.py); [compose.yml](../../../compose.yml) |

Current limitations: there is no User, session, or ownership model; filesystem `location()` discloses sibling filenames; and the proxy carries no session.

Implementation must follow [project instructions](../../instructions/project.instructions.md) and [MVP instructions](../../instructions/mvp.instructions.md). Skills applied for this record: [streamrecorder-domain-contracts](../../../.agents/skills/streamrecorder-domain-contracts/SKILL.md), [streamrecorder-postgres-persistence](../../../.agents/skills/streamrecorder-postgres-persistence/SKILL.md), [streamrecorder-security-compliance](../../../.agents/skills/streamrecorder-security-compliance/SKILL.md), [streamrecorder-api-frontend](../../../.agents/skills/streamrecorder-api-frontend/SKILL.md), and [streamrecorder-worker-lifecycle](../../../.agents/skills/streamrecorder-worker-lifecycle/SKILL.md). Successor tasks select these per project-instructions section 40.6.

## 3 Architecture Impact Map

| Area | Frozen decision | Downstream owner |
|---|---|---|
| Identity/persistence selection | **PLANNED** `IDENTITY_MODE=local|authenticated`, default `local`; invalid values fail startup | T02, T07 |
| Schema and existing relational data | **PLANNED** additive user/session/owner migration; bootstrap local owner; no rewritten Wave 05 migration | T02 |
| Credentials and sessions | **PLANNED** CLI-only account administration, scrypt, database-backed opaque cookie sessions | T03 |
| Resource access | Principal derived only from selected local identity or validated session; every domain query owner-scoped | T04 |
| Worker | Existing execution-config/event shapes retained; owner is resolved server-side from persisted relations | T05 |
| Filesystem | No physical per-user media directories or moves; authenticated API reveals only owner-authorized file metadata | T05 |
| Browser integration | **PLANNED** auth proxy forwarding rules and UI activation only after backend gate | T06 |
| Release | T07 is sole remover of authenticated startup guard after integrated validation and human approval | T07 |

## 4 Persistence and Identity Mode Matrix

| Mode | Support status | Identity resolution | Data authority | Ownership guarantees / limitations | Configuration | Startup validation | Activation prerequisites | Failure behavior / recovery | Safe rollback |
|---|---|---|---|---|---|---|---|---|---|
| JSON + local | Supported existing default | No User; implicit single local user | Existing JSON files | Single-user only; no account/row ownership | Existing JSON selection; **PLANNED** `IDENTITY_MODE=local` is compatible | Existing startup only | None | Preserve current behavior; no User created | Continue JSON; no media/data conversion |
| JSON + authenticated | Unsupported / **PLANNED** prohibition | None | JSON | No safe multi-user ownership boundary | `IDENTITY_MODE=authenticated` with JSON | Fail closed: fixed `authenticated mode not yet available` through T06; after T07 relational validation still fails | T07, relational storage, DB/schema/users/origins all valid | Process exits; never fall back to local | Set local only before authenticated activation; JSON remains intact |
| relational + local | **PLANNED** T02 checkpoint | Resolve only `users.bootstrap_key='local'`; idempotent insert then reselect on race | PostgreSQL | Only bootstrap `local` is visible through local-principal domain routes; other-owner rows remain stored and unmodified. Worker execution-config includes every non-disabled owner's enabled targets in either mode; operator disables other accounts via CLI to stop their monitoring. Shared-root filesystem browsing remains trusted single-operator privacy limitation. | `RELATIONAL_STORAGE=true`, `IDENTITY_MODE=local` | DB/schema required by relational mode; bootstrap repair is idempotent | Explicit migration plus verification; no normal-install cutover | DB error is unavailable/error, never JSON fallback after relational writes | Restore a verified pre-activation database backup; no owner reassignment, auto-downgrade, or media move |
| relational + authenticated | **PLANNED**, disabled through T06 | Validated `sr_session` resolves enabled User | PostgreSQL only | All domain access and associations owner-scoped; unknown/other owner is hidden | `IDENTITY_MODE=authenticated`, `AUTH_TRUSTED_ORIGINS` | Through T06 fixed fail-closed guard. After T07 require relational storage, reachable DB, T02-or-later schema, enabled password user, non-empty trusted origins | T02–T06 complete, integrated T07 validation, human approval | Any failed prerequisite exits; session/auth failure 401; DB failure 503; no local fallback | Before activation retain local mode and backup. After activation, disable authenticated mode only by approved rollback to verified relational local state; revoke sessions, do not delete/reassign data |

## 5 User Identity and Local Account Contract

**PLANNED tables:** `users` has UUID `id`, `bootstrap_key` nullable unique, `username`, nullable optional `email`, `password_hash`, `disabled_at timestamptz NULL` (NULL = enabled), `failed_login_count integer NOT NULL default 0`, `locked_until timestamptz NULL`, `created_at`, and `updated_at`. Username is the login identifier: NFKC then lowercase, `^[a-z0-9][a-z0-9._-]{2,31}$`, unique. Email is optional, trimmed/NFKC/lowercase, unique only when present (partial unique index), and is neither a login identifier nor verified. No optional `display_username` preserving original spelling is added; only the canonical username is retained.

T02 creates the idempotent bootstrap account with `bootstrap_key='local'`, username `local`, `password_hash NULL`, `gen_random_uuid()`, and `ON CONFLICT DO NOTHING`. JSON creates no User. In relational local mode, runtime repeats the insert-and-reselect safely so concurrent starts converge on that one row.

The local user may enroll a password with the **PLANNED** CLI `npm run users -- create|set-password|disable|enable|list` (the exact script name is T03's implementation choice). Password entry is interactive no-echo or stdin, never argv; accepted length is 12–256 characters. Additional accounts are CLI-only. There is no public signup, default password, ownership transfer, or hard deletion in this wave; disabling is the only lifecycle action.

## 6 Credential and Session Architecture

T03 implements **PLANNED** password hashes using `node:crypto.scrypt`: N=2^15, r=8, p=1, 64-byte key, 16-byte random salt, maxmem 64 MiB, encoded `scrypt$v1$N$r$p$salt_b64$hash_b64`; comparison uses `timingSafeEqual`. Unknown users receive dummy verification. DB account throttling is 10 consecutive failures to a 15-minute lock, reset on success; an in-process per-source-IP 20 attempts/15 minutes limit is explicitly best effort. Unknown, wrong, disabled, and locked login outcomes are the uniform `401 {"message":"Invalid credentials"}`.

**PLANNED routes:** `POST /auth/login` accepts `{username,password}`, `POST /auth/logout`, and `GET /auth/session` returns `{identityMode,persistence,user|null}` without secrets. Local mode returns 404 for login/logout and a local principal summary (relational) or `user:null` (JSON) for session.

**PLANNED `sessions` table:** UUID id, user FK, unique SHA-256 token hash, created/last-used/idle-expiry/absolute-expiry/revoked timestamps. A 32-byte random base64url token is only sent as host-only `sr_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` is set only when the trusted request origin is HTTPS (not loopback HTTP). Login rotates sessions; idle expiry is 24h and sliding writes are throttled to five minutes; absolute expiry is seven days; logout revokes and clears; disabling revokes all; expiry purge is opportunistic. No signing secret is added.

Every unsafe cookie-authenticated request, including login/logout, requires Origin (Referer fallback) exactly in **PLANNED** `AUTH_TRUSTED_ORIGINS`; missing/mismatch is 403. CORS stays disabled. The proxy forwards Origin and Cookie for allowlisted routes, relays Set-Cookie only for `/auth/*`, strips client-supplied identity headers, never caches authenticated responses (`Cache-Control: no-store`), and never forwards/trusts identity headers. Direct clients obey the identical cookie and origin rules.

**PLANNED T06 frozen frontend decision:** on login, logout, 401/session loss, or identity change, the dashboard provider clears every cached creators/targets/streams/recordings/location snapshot, aborts or ignores polling responses issued under the prior request-generation token, stops polling while unauthenticated, and displays a login view. `GET /auth/session` drives mode detection. Local-mode UX remains unchanged and has no login screen.

## 7 Domain Ownership Model and Constraints

| Entity | owner_id (explicit) | inherited-from parent | constraint(s) | indexes | query rule | archived/history | legacy notes |
|---|---|---|---|---|---|---|---|
| creators | Yes, NOT NULL User FK | None | `UNIQUE(id, owner_id)` | non-unique `(owner_id, normalized_key)`; preserve ID lookup | Filter every select/mutate by owner | Preserve archival state | Duplicates remain possible per owner; legacy name lookup is non-archived, 409 when ambiguous, owner-scoped advisory lock `hashtext(owner_id || ':' || lower(key))` |
| watch_targets | Yes, NOT NULL | creator | `(creator_id, owner_id) -> creators(id, owner_id)`; `UNIQUE(id, owner_id)` | owner/id and creator/owner access indexes | Principal owner must equal row and creator owner | Preserve enabled/archive behavior | Legacy creation may name-create only within owner; cross-owner creator rejected |
| streams | Yes, NOT NULL | watch_target | `(watch_target_id, owner_id) -> watch_targets(id, owner_id)`; keep `UNIQUE(id, watch_target_id)` | owner/watch-target reads | Principal owner must equal target owner | Preserve stream history | Worker event rejects cross-owner stream/target |
| recordings | Yes, NOT NULL | watch_target; NULL stream follows target | `(watch_target_id, owner_id) -> watch_targets(id, owner_id)`; keep existing `(stream_id, watch_target_id)` FK | owner/watch-target/stream reads | Principal owner must equal recording/target owner | Preserve raw timestamps, finished state, archive/output fields | `NULL stream_id` remains valid and is authorized through watch_target |
| migration_manifests | Yes, provenance | imported bootstrap owner | User FK, replay owner comparison | owner/import lookup | Import/verify compares owner | Preserve manifest records | Manifest format and `TOOL_VERSION` remain unchanged |

Owner IDs are never accepted from DTOs, query strings, cookies other than validated session, or identity headers. Cross-owner relations fail before persistence. Ownership checks and inserts of referencing rows occur in the same transaction, with composite FKs as the race backstop: concurrent requests from different principals cannot attach to each other's parents because `FK (parent_id, owner_id)` fails. T04 scopes list queries in SQL rather than listing then post-filtering.

## 8 API/Legacy/Proxy Route Authorization Matrix

Current behavior is verified from the controllers/proxy named in section 2. “Local” preserves that behavior after T04; authenticated scope is **PLANNED**. For all authenticated domain rows, absent/invalid session is 401; an unknown or other-owner object/filter is 404, including legacy names and `session/channel/:id`; DB unavailability is 503. “Proxy” describes the **PLANNED T06** final rule, not current implementation.

| Route | Current behavior | Class | Local mode | Authenticated mode principal & ownership scope | Unauthorized / not-found | Proxy | Task |
|---|---|---|---|---|---|---|---|
| GET /health | `{status:ok}` | health | unchanged | no principal; health only | n/a | not proxied | T07 |
| GET /creators | list | domain | implicit local | session owner list | 401 | planned allow | T04/T06 |
| POST /creators | create | domain | implicit local | session owner becomes owner | 401/403 origin | not proxied (unchanged; Creator mutation UI out of scope) | T04/T06 |
| PATCH /creators/:id | update | domain | implicit local | owner row only | 401/404/403 origin | not proxied (unchanged; Creator mutation UI out of scope) | T04/T06 |
| DELETE /creators/:id | remove | domain | implicit local | owner row only | 401/404/403 origin | not proxied (unchanged; Creator mutation UI out of scope) | T04/T06 |
| GET /creators/:id | read | domain | implicit local | owner row only | 401/404 | planned allow | T04/T06 |
| GET /creators/:id/watch-targets | list child | domain | implicit local | owner creator and children | 401/404 | planned allow | T04/T06 |
| GET /watch-targets | list | domain | implicit local | owner list | 401 | planned allow | T04/T06 |
| GET /watch-targets/:id | read | domain | implicit local | owner row only | 401/404 | planned allow | T04/T06 |
| POST /watch-targets | create | domain | implicit local | session owner; creator same owner | 401/403 origin/404 | planned allow | T04/T06 |
| DELETE /watch-targets/:id | remove | domain | implicit local | owner row only | 401/404/403 origin | planned allow | T04/T06 |
| PATCH /watch-targets/:id | update | domain | implicit local | owner row only | 401/404/403 origin | planned allow | T04/T06 |
| GET /streams | list | domain history | implicit local | owner list | 401 | planned allow | T04/T06 |
| GET /streams/:id | read | domain history | implicit local | owner row only | 401/404 | planned allow | T04/T06 |
| GET /recordings?watchTargetId= | list/filter | domain history | implicit local | owner list/filter owner-scoped | 401/404 | planned allow | T04/T06 |
| GET /recordings/:id | read | domain history | implicit local | owner row only | 401/404 | planned allow | T04/T06 |
| GET /recordings/filesystem | filesystem listing | filesystem | existing browser | always 404; listing deferred | 404 | current allow in local mode; API returns 404 in authenticated mode | T05/T06 |
| GET /recordings/:id/location | filesystem metadata | filesystem | existing browser | owner recording; basename, existence/size, safe relative subdir only | 401/404 | planned allow, no absolute paths | T05/T06 |
| GET /streamer | legacy list | legacy | unchanged shape | owner list | 401 | planned allow | T04/T06 |
| GET /streamer/:id | legacy read | legacy | unchanged shape | owner row/name semantics | 401/404 | planned allow | T04/T06 |
| POST /streamer | legacy create | legacy | unchanged shape | session owner | 401/403 origin/404 | planned allow | T04/T06 |
| DELETE /streamer/:id | legacy remove | legacy | unchanged shape | owner row/name semantics | 401/404/403 origin | planned allow | T04/T06 |
| GET /session | legacy list | legacy | unchanged shape | owner sessions only | 401 | planned allow | T04/T06 |
| GET /session/:id | legacy read | legacy | unchanged shape | owner session only | 401/404 | planned allow | T04/T06 |
| GET /session/channel/:id | legacy channel lookup | legacy | unchanged shape | owner scope before lookup | 401/404 | planned allow | T04/T06 |
| GET /internal/v1/watch-targets/execution-configs | worker config | internal | internal token | token, excludes disabled owners | 401 token; 503 DB | never browser proxy | T05 |
| POST /internal/v1/events | worker event | internal | internal token | token; derive owner transactionally | 401 token; cross-owner safe error/no ack | never browser proxy | T05 |
| GET /health (frontend) | frontend health | frontend | unchanged | no principal | n/a | direct frontend | T07 |
| /api/backend/[...path] | frontend proxy route | proxy | current allowlist behavior | only explicit T06 allowlist; auth cookie/origin relay rules | 404 unsupported; 403 mutation origin | this route | T06 |
| POST /auth/login | **PLANNED** | auth | 404 | credential attempt + trusted origin | 401/403 | planned allow; relay Set-Cookie | T03/T06 |
| POST /auth/logout | **PLANNED** | auth | 404 | validated session + trusted origin | 401/403 | planned allow; relay Set-Cookie | T03/T06 |
| GET /auth/session | **PLANNED** | auth | local summary/null | session principal summary | 401 when authenticated session invalid | planned allow; no Set-Cookie relay | T03/T06 |

## 9 Internal Worker Trust and Recovery

The existing internal token contract and execution-config/event response shapes remain unchanged; no owner field is required by Worker. T05 excludes disabled-owner targets from execution configs (no new probes/captures), while the existing refresh-before-launch guard blocks launch. Accepted in-flight captures and terminal events for subsequently disabled users still persist.

On events, the API resolves ownership from the persisted WatchTarget/Stream in the same transaction. A cross-owner Stream/WatchTarget combination is rejected without acknowledgement or partial write. Pending outbox events without owner fields replay unchanged. No Worker code change is required unless T05 tests prove it necessary. Recovery keeps the current retry/outbox flow and never derives authority from worker-supplied owner data.

## 10 Filesystem Isolation and Privacy

T05 preserves the recordings mount as read-only and all existing containment/symlink protections. Authenticated mode has no filesystem tree browsing: `/recordings/filesystem` is 404. `/recordings/:id/location` first owner-authorizes via Recording/WatchTarget and returns only the file basename, existence/size status, and owner-safe relative subdirectory—never directory entries or absolute paths.

There are no per-user physical directories and no media moves. Two owners choosing the same `recording_subdir` must not learn each other's filenames through any API response. The accepted residual risk is that the operating-system account with direct disk access can see a shared physical directory; this is documented rather than hidden.

## 11 Fresh Installation and Migration Paths

**Fresh relational install (PLANNED T02):** explicitly set relational storage, run `npm run db:migrate`, creating additive migration 0004 (or additive 0004/0005 in the same run). It creates users/sessions, inserts local bootstrap, creates/backfills owner IDs for creators/watch_targets/streams/recordings and migration-manifest provenance, then enforces NOT NULL/composite constraints. Verify empty domain tables, one local user, and migration state; do not activate authenticated mode.

**Populated relational upgrade (PLANNED T02):** take a verified backup; quiesce writers; run the same explicit migration transaction; assign every existing domain row and manifest to bootstrap local while preserving UUIDs, counts, raw timestamps, NULL stream links, archival state, and output paths. Verify counts/foreign keys/ownership before reopening local relational operation. On failure, retain the backup and repair forward or restore it; never fall back to JSON after relational writes.

**Legacy JSON import (PLANNED T02):** preserve the existing quiesced backup, dry-run, import, verify, cutover procedure and unchanged manifest/`TOOL_VERSION`. In the import transaction resolve bootstrap local, assign it to every imported row/manifest, and reject any existing ID with a different owner without writing. Replay/verify compare owner as well. No automatic import or cutover is permitted, and no media is moved.

## 12 Activation and Rollback Gates

1. T02 may establish relational local ownership only after explicit migration and isolated verification.
2. T03–T06 must retain an authenticated startup guard: `IDENTITY_MODE=authenticated` exits with the fixed error `authenticated mode not yet available`; tests alone may exercise those paths.
3. T07 may remove that guard only after integrated validation and human approval. Its retained startup checks are relational storage true, reachable DB, schema at/after T02, at least one enabled password-bearing user, and non-empty `AUTH_TRUSTED_ORIGINS`; any failure exits with no local fallback.
4. Before any separately authorized real upgrade, back up and quiesce. Activation is explicit; neither migration nor import changes normal-install authority automatically.
5. Rollback is an approved return to verified relational local state/database backup and session revocation. Relational local resolves only bootstrap `local`; other-owner rows remain stored, unmodified, and invisible to local-principal domain routes. The Worker still receives all non-disabled owners' enabled targets, so the operator must disable other accounts via CLI to stop monitoring. Shared-root local filesystem browsing remains a trusted single-operator privacy limitation and T07 documents its operator warning. Rollback does not auto-downgrade migrations, delete users, reassign owners, remove volumes, move media, or restore direct JSON authority after relational writes.

## 13 Compatibility and Security Invariants

- JSON default mode stays single-user and unchanged; authenticated JSON is never enabled.
- Legacy route shapes, `session_id`, finished state, raw legacy timestamps, and `NULL stream_id` remain compatible.
- Manifest format, `TOOL_VERSION`, strict import procedure, and owner-aware replay/verify remain compatible.
- Worker execution-config/event contracts stay unchanged; internal token remains required.
- No CORS enablement, JWT/stateless token, identity header trust, public recording endpoint, secret logging, or credential argv is introduced.
- Owner-scoped SQL queries hide cross-owner existence as 404; unsafe cookie requests require trusted Origin/Referer validation.
- Read-only recordings mount, containment/symlink protections, and no-media-move rule remain invariant.

## 14 T02–T07 Implementation and Validation Mapping

| Requirement | Decision | Evidence/Rationale | Implementation Task | Validation Case | Activation Gate |
|---|---|---|---|---|---|
| Four mode cells and startup validation | JSON+auth fails; T02–T06 guard remains; no local fallback | No safe JSON multi-user boundary | T02/T07 | Start each mode cell; assert JSON+auth exit and DB failure 503/no fallback | T07 human approval |
| Local-principal bootstrap concurrency | One `local` row via insert/reselect | Concurrent starts must converge | T02 | Parallel bootstrap transactions yield one bootstrap user | Relational local verification |
| Session lifecycle and persistence | 24h idle expiry; 7d absolute expiry; sliding-window writes throttled to 5m; logout revokes the session; disablement revokes all user sessions; sessions persist across restarts | Database-backed sessions enforce bounded, revocable access | T03 | Exercise idle/absolute expiry and 5m write throttling; assert logout/disablement revocation and valid-session survival after DB restart | T03 complete; auth guard remains |
| Cookie attributes and token security | Host-only `sr_session`; `HttpOnly`; `SameSite=Lax`; `Path=/`; `Secure` on HTTPS trusted origin; only SHA-256 token hash stored in DB | Keep opaque bearer tokens out of persistent plaintext storage and restrict browser transport | T03/T06 | Inspect direct API and proxy cookie headers across trusted HTTP/HTTPS origins; verify DB stores the token hash, not the raw token | T06 complete; auth guard remains |
| Trusted-Origin enforcement | Mandatory Origin or Referer fallback validation against `AUTH_TRUSTED_ORIGINS` on all unsafe cookie-authenticated requests, including login, logout, and mutations; missing/mismatch returns 403 | SameSite alone does not replace request-origin validation | T03/T04/T06 | Test valid, invalid, and missing Origin/Referer on login, logout, and mutations through direct API and proxy | T06 complete; auth guard remains |
| Credential entry safety and normalization | CLI interactive no-echo or stdin input, never argv; passwords 12-256 characters; usernames NFKC/lowercase with `^[a-z0-9][a-z0-9._-]{2,31}$`; uniform failed-login 401 message | Prevent credential exposure and inconsistent account lookup | T03 | Execute CLI no-echo prompt and stdin entry; test password length and normalized username format; assert unknown/wrong/disabled/locked login returns uniform `401 {"message":"Invalid credentials"}` | T03 complete; auth guard remains |
| Cross-owner relationships and forged-owner rejection | Strictly ignore client-supplied owner IDs as authority; derive owner server-side; transactional parent checks and composite FKs `(creator_id, owner_id)` and `(watch_target_id, owner_id)` fail closed on mismatches | Query scoping alone cannot prevent forged associations or parent-check races | T02/T04 | Attempt target/stream/recording creation referencing foreign parents or injecting owner IDs; assert authorization/constraint rejection for mismatched parents and no client-directed ownership or partial writes | T04 complete; auth guard remains |
| Account disablement | Revoke sessions; keep data; persist accepted Worker work | Disable stops new work, not terminal persistence | T03/T05 | Disable account; sessions fail, rows remain, accepted event persists | T05 complete; auth guard remains |
| Legacy name/ID/channel isolation | Owner-scoped lookup; 409 ambiguity within owner | Preserve compatibility without cross-user discovery | T04 | Two owners share name/ID/channel; foreign lookup 404 and same-owner ambiguity 409 | T04 complete; auth guard remains |
| NULL stream recording authorization | Authorize through watch target | Nullable stream is existing schema contract | T02/T04 | Owner can read NULL-stream recording; other owner receives 404 | T04 complete; auth guard remains |
| Every route class | Public health; local principal; authenticated user; internal service | Explicit trust boundaries | T04/T05/T07 | Exercise health, local domain, authenticated domain, and internal-token routes | T07 integrated validation |
| Internal token isolation | Human cookie never accepted on `/internal/v1`; Worker holds no human tokens | Separate machine and human authority | T05 | Cookie-only internal request 401; Worker config contains no session token | T05 complete; auth guard remains |
| Logout/session expiry during capture | Capture continues; session revocation affects only user access | Capture lifecycle is not browser session lifecycle | T03/T05 | Logout/expire during capture; terminal event persists | T05 complete; auth guard remains |
| Frontend cache and stale response safety | Clear snapshots and reject prior-generation polling responses | Identity changes must not leak UI state | T06 | Login/logout/401 switches identity; old delayed poll cannot repopulate cache | T06 complete; auth guard remains |
| Populated relational upgrade | Additive migration preserves existing rows | No Wave 05 rewrite | T02 | Upgrade populated relational fixture and verify owner assignment | Relational local verification |
| JSON import | Explicit owner assignment, replay verification, conflict handling | Import changes authority only by explicit action | T02 | Import fixture; replay is idempotent and conflict reports safely | Explicit migration/import verification |
| Interrupted migration recovery | Recover or fail safely without partial authority switch | Operator can retry from verified backup | T02/T07 | Interrupt migration, restart, and verify recovery instructions/state | T07 integrated validation |
| Rollback | Relational local resolves only bootstrap `local` (section 12); Worker rules unchanged; no reassignment | Preserve other-owner rows and media | T07 | Roll back authenticated relational DB; local sees only `local`, Worker still receives enabled other owner | Human acceptance + T07 green |
| Safe errors and logging redaction | Uniform login error; no passwords/tokens/cookies/Authorization logs | Prevent secret disclosure | T03/T07 | Assert log capture excludes credentials and login failures are indistinguishable | T07 integrated validation |
| DB unavailable | 503 and no fallback | Relational authority must fail closed | T04/T07 | Disconnect DB; domain route returns 503 and process never selects JSON | T07 integrated validation |

## 15 Risks, Alternatives and Rejected Approaches

**Risks:**
- Shared historical media on disk — owner-safe metadata only and no authenticated listing; **T05**.
- Owner-assignment conflicts — explicit assignment and replay/conflict validation; **T02**.
- Concurrent startups/import — idempotent bootstrap, locks, and transactional verification; **T02**.
- Cross-user legacy name resolution — owner-scoped lookup and same-owner 409 ambiguity; **T04**.
- Proxy credential loss — Cookie/Origin forwarding and auth-only Set-Cookie relay tests; **T06**.
- Worker replay after disablement — accepted terminal events persist while configs exclude disabled owners; **T05**.
- DB downtime — return 503 with no JSON fallback; **T04/T07**.
- Multi-process brute-force limiter is best-effort — database lockout remains authoritative; **T03**.
- Local-mode visibility after rollback — only bootstrap `local` routes are visible; T07 documents the trusted shared-root warning; **T07**.

Rejected: mandatory local login (breaks low-friction local mode); authenticated JSON (no row ownership); public signup/default password (uncontrolled accounts); argon2/bcrypt native modules (dependency/container cost; scrypt chosen); JWT/stateless tokens (cannot promptly revoke/disable); trusting owner IDs or identity headers (client-forgeable); per-user physical directories/moving media (compatibility and I/O risk); path-prefix-only isolation (not authorization); listing then post-filtering (leaks); logout cancelling accepted work (breaks capture lifecycle); rewriting migrations or manifest format (Wave 05/import incompatibility); automatic import/cutover (unsafe authority switch); Redis/new services (unneeded infrastructure); and inherited-only owner/join-only model (insufficient database-enforced association safety).

Coordinator note: successor task names/scopes reviewed are T02 schema/migration, T03 authentication/session, T04 authorization, T05 worker/filesystem ownership, T06 frontend authentication, and T07 integration QA. No conflict requiring a spec edit was found. The deferred owner-scoped filesystem listing belongs to Wave 07/07.5, not this wave.

## 16 Decision Summary and Acceptance Checklist

- [x] Four persistence/identity cells freeze support, authority, recovery, and rollback behavior.
- [x] Local default, explicit relational migration, and authenticated fail-closed activation are unambiguous.
- [x] Account, credential, session, origin, ownership, worker, filesystem, and legacy decisions are assigned to T02–T07.
- [x] Section 14 explicitly maps session expiry, sliding-write throttling, revocation and restart persistence; cookie attributes and hashed tokens; trusted-Origin enforcement; safe credential entry and normalization; and transactional cross-owner/forged-owner protections to implementation tasks and validation cases.
- [x] Route and ownership matrices enumerate current/planned boundaries and hide cross-owner existence.
- [x] Fresh install, populated upgrade, and JSON import have explicit no-automatic-cutover recovery paths.
- [x] The traceability table includes the Luna Review 1 security/compatibility controls with implementation, validation, and activation gates; these are planned downstream checks, not evidence of implemented runtime controls.
- [x] This record changes no runtime artifact; human acceptance remains required before successor implementation.
