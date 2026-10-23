# StreamRecorder integration frontend

## Wave 05.5 Operational Boundary

The default JSON/local dashboard needs no account or database. Opt-in
PostgreSQL/local uses bootstrap `local`; PostgreSQL/authenticated is explicitly
opt-in. API startup validates relational storage, a valid PostgreSQL URL, exact
non-empty trusted origins, database reachability, ownership schema/composite
constraints and an enabled password-enrolled user before listening. JSON/authenticated is unsupported. There is no signup,
default credential, public media or hosted deployment.

Account administration, exact `AUTH_TRUSTED_ORIGINS`, host-only session cookies,
Origin/Referer CSRF policy and rollback checkpoints live in
[API operations](../api/README.database.md). Session expiry/revocation or account
disablement clears protected state on 401; a domain 404 does not log out the user.
A backend outage remains an error, never a switch to local mode. Logout/account
changes discard old asynchronous snapshots and callbacks; do not remove these
generation/cancellation guards. Authenticated folders use manual relative entry,
not shared-root listing. Local browsing assumes a trusted single operator.

Run typecheck, unit/component/proxy tests and build before the HTTP integration
script. The latter intentionally requires `TEST_FRONTEND_URL` pointing to a
separately started disposable stack and `TEST_ALLOW_MUTATIONS=true`. Never point
it at the ordinary installation. A missing fixture is blocked evidence, not a
passing HTTP test. Keep `API_BASE_URL` server-side and never expose
`INTERNAL_API_TOKEN` or `DATABASE_URL` to the browser.

This is a technical API + Worker testing console, not the final product UI. It provides a foundation for inspecting the current domain and debugging local integration without adding future infrastructure.

## Architecture

Browser → Next.js `/api/backend/*` → NestJS → JSON adapters (default) or PostgreSQL repositories (opt-in relational mode).
In JSON mode the independent Python Worker reads `watchlist.json` and persists runtime state/history in shared JSON. In bridge mode it obtains execution configuration and submits durable events through the internal API, backed by PostgreSQL and its local outbox. The frontend never reads these files, connects to PostgreSQL, starts the Worker, invokes media tools, or serves recorded media.

Wave 05 relational mode makes stable Creator CRUD available in the API. The
existing frontend remains a grouping/target-management console, not a standalone
Creator CRUD interface. It must not infer relational capability from API liveness
or claim a name-derived JSON identity is a stable relational UUID. The public
proxy does not expose `/internal/v1/*` or forward `INTERNAL_API_TOKEN`.
Polling, independent collection errors/stale data and mutation reconciliation
remain unchanged across persistence modes. Use
`node scripts/docker-bridge-smoke.mjs` from the root for isolated bridge frontend
health checks; this is not browser interaction coverage of every relational flow.

Next.js App Router, TypeScript, React, Tailwind CSS and native fetch. A shared provider polls the four domain collections every 5 seconds while the document is visible. Navigation reuses the same provider. Overlapping refreshes are deduplicated; mutations wait for an in-flight refresh and then request fresh data. Each collection has independent loading/error/stale-data handling. Request diagnostics retain the latest 80 requests in memory.

## Requirements and setup

Use the repository's Node.js requirement (>=25.9.0) and pnpm. Local JSON mode requires no interactive login, database, queue, or realtime transport. For the supported Docker Compose workflow, service lifecycle commands, shared-state behavior, and Windows notes, see the [root development guide](../README.md).

```sh
# API terminal (from repository root)
cd api
pnpm install
pnpm start:dev

# Frontend terminal (from repository root)
cd frontend
pnpm install
# Copy .env.example to .env.local if changing the API address
pnpm dev
```

Open http://localhost:3001. NestJS defaults to port 3000. The Worker is optional for configuration CRUD and empty-history inspection.

```env
API_BASE_URL=http://localhost:3000
```

`API_BASE_URL` is server-only. The proxy reads it at request time; restart development after environment-file changes. Never prefix it with `NEXT_PUBLIC_`. The proxy allowlists domain routes plus `GET /auth/session`, `POST /auth/login`, and `POST /auth/logout`. It forwards JSON bodies, `watchTargetId` filters and relative filesystem `path` queries, preserves upstream HTTP errors, disables caching and times out upstream calls after 10 seconds. Unreachable upstreams produce a controlled 502 without exception details.

## Identity and session flow

The frontend verifies `/auth/session` before mounting domain pages or fetching collections. Local JSON and local relational sessions open the dashboard directly, without a login prompt or sign-out control. Authenticated mode requires a non-null user and displays their username and Sign out. Missing or expired identity shows a username/password form; backend unavailability shows a retryable error and never falls back to local mode. This frontend support does not enable authenticated production startup or provision accounts.

Only one valid `sr_session` cookie is forwarded to NestJS. Other cookies, Authorization, identity headers and internal service tokens are not forwarded. Upstream `Set-Cookie` headers are relayed only on login/logout, preserving the backend's host-only HttpOnly, SameSite=Lax, Path=/, conditional Secure and logout-clearing attributes. The proxy rejects cross-origin mutations and forwards incoming Origin/Referer unchanged for backend `AUTH_TRUSTED_ORIGINS` validation; it never invents a trusted origin. Configure the browser origin in the backend policy when using authenticated mode.

Logout immediately removes protected views and clears collections and diagnostics. Login success, identity changes and 401 responses invalidate the request generation and abort older requests; delayed results cannot restore the previous user's data. Failed logout reports that revocation could not be confirmed and offers retry or session verification. A resource 404 does not end the session. Login bodies and responses are excluded from in-memory request diagnostics. Passwords and session tokens are not persisted in browser storage.

Local mode retains read-only recording-directory browsing and the folder picker. Authenticated recording locations show only availability, filename, safe relative subdirectory and size in bytes when provided. Authenticated target folders are entered manually; the UI does not request `/recordings/filesystem`. Neither mode serves recorded media or opens native folders.

## Pages and API coverage

- Overview: real collection counts, API refresh status and observed Worker activity.
- Watch Targets: list, create and confirmed deletion; existing Creator selection or new display name; supported platform and quality options.
- Creators: grouped identities with expandable API-loaded WatchTargets.
- Streams: broadcast history, WatchTarget/state filters, timestamps and completed duration.
- Recordings: capture attempts, server-side WatchTarget filtering, optional Stream ID and plain-text local output path.
- Diagnostics: request method/path/status/duration/time/errors, collapsible domain JSON, opt-in read-only legacy inspection.

Main UI requests:

```text
GET /creators
GET /creators/:id/watch-targets
GET /watch-targets
POST /watch-targets
PATCH /watch-targets/:id
DELETE /watch-targets/:id
GET /streams
GET /recordings
GET /recordings?watchTargetId=<id>
```

Diagnostics only: `GET /streamer` and `GET /session`. Individual entity GET routes are supported by the proxy but not currently needed by these collection views. No legacy types enter the main domain model. WatchTarget rows provide an Enabled switch, Quality selector, recording-folder editor/browser, URL editor, and Open Stream for validated HTTP(S) URLs. Each edit uses `PATCH /watch-targets/:id`. Open Stream is ordinary external browser navigation, not proxying, playback, or a public recording URL.

## Current limitations

- In JSON mode Creator identity is derived from display name. The existing create-target form submits the selected/new name as `creator_id`; relational API Creator CRUD is available separately, but a complete relational Creator-management UI is not implemented.
- `enabled` is enforced by the Worker, and can be changed using the row-level Enabled switch.
- There is no Worker heartbeat. API success cannot prove the Worker process is alive, and persisted recording state can be stale.
- Worker polling defaults to 60 seconds plus probe time; faster browser refreshes do not speed up detection. No WebSocket or SSE is used.
- Recording `stream_id` is not persisted by the current legacy adapter and is shown as “Not persisted”.
- Output paths are local technical information. There are no download links, public media URLs, indexing or playback.
- Worker timestamps omit timezone offsets. The UI preserves the original wall-clock text and computes duration only for completed records.
- JSON storage lacks cross-process locking. Empty arrays and missing history files are valid empty states; malformed/zero-byte JSON is an API error and remains visible.

## Open Design MCP

Before implementation, the available Open Design MCP tool descriptions were inspected. Calls to the default-project `get_artifact`, `search_files` (dashboard), and `get_file` failed during active-context lookup. `list_projects` also reported that the local daemon was unreachable. No project, artifact, token file or component was retrieved; no configuration or Open Design data was modified.

No applicable Open Design artifact was available through the MCP; a neutral technical dashboard was used as fallback.

The fallback uses a restrained forest/neutral palette, compact tables, small status badges, system sans-serif typography, monospace technical fields and responsive navigation. No remote fonts or image assets are needed.

## Validation and test workflow

```sh
cd frontend
pnpm install
pnpm build
pnpm typecheck
pnpm start
```

No mutating backend lint command is required. Next.js setup follows the [official App Router documentation](https://nextjs.org/docs/app/getting-started/installation).

For safe manual integration tests, start a separate NestJS process with `PORT=3100` and `CONFIG_DIR` pointing at a new, existing temporary directory. Set the frontend `API_BASE_URL=http://localhost:3100`. Leave the real Worker stopped for CRUD tests. This avoids changing an existing watchlist.

1. With missing history files or valid empty arrays (`[]`), open every page and confirm loading resolves to an empty state.
2. Create two WatchTargets under one test Creator. Confirm both appear, initial state is idle, and Creator expansion shows both platforms.
3. Delete one target, accept the confirmation, and verify the sibling remains. Cancel another deletion to verify no change.
4. Inspect request logs, raw JSON and the explicit legacy section.
5. Stop the test API. Verify errors and retry controls appear, then restart it and confirm automatic recovery.
6. To test a real Worker manually, set `CONFIG_DIR` to the same test directory, or explicitly configure the higher-priority Worker path overrides: `WATCHLIST_PATH`, `CHANNELS_STATUS_PATH`, `STREAMS_PATH`, and `SESSIONS_PATH`. Set `OUTPUT_DIR` to a private test output directory. Start `python worker.py` from `worker/` in a separate terminal.
7. Choose an authorized valid channel manually and allow the Worker polling interval. If live, verify state transitions, Stream/Recording rows, timestamps and plain-text output paths appear without reloading. A live transmission is conditional, not guaranteed.

Automated tests must not depend on a real channel. Existing deterministic Worker lifecycle coverage can be run from the repository root with `python -m pytest worker/test_worker.py -q`. Do not point test fixtures at the normal Worker configuration or media directories.

### Repeatable HTTP smoke test

```sh
pnpm test
# Set TEST_FRONTEND_URL=http://localhost:3102 and TEST_ALLOW_MUTATIONS=true
# Only use a separate frontend/API with an isolated CONFIG_DIR.
pnpm test:integration
```

The integration test creates two disposable targets at example.invalid, checks grouping, filtering and deletion, verifies proxy restrictions, and cleans up only its own targets. Keep the Worker stopped for this test. It does not use real channels or edit runtime files directly.

Implementation evidence includes deterministic Worker coverage (180 tests) and the root `pnpm test:smoke` Docker Gates A-D: classification, lifecycle, persistence denial/recovery, API/Worker cross-writer cycles, active-child SIGTERM/reaping, and secret-safe logs. The smoke uses deterministic fake Streamlink; it does not validate a real platform, network, captured media, or playable MP4. Browser automation timed out repeatedly, so visual rendering, responsive layout and browser-driven create/delete/polling interactions still require the manual workflow above.


## Wave 04.5 recording storage controls

Watch Targets has an Enabled switch between Recording Folder and State. Saving
disables that row's switch, displays progress, reconciles the dashboard on success,
and restores the previous value with error feedback on failure. Existing Wave 04
Worker behavior skips new probes for disabled targets and lets active captures
finish; this wave does not change that behavior.

Recordings offers Browse location by recording ID. The shared modal displays
Available, File not found or Directory unavailable without breaking history.
It navigates server storage with breadcrumbs; it does not open desktop Explorer,
serve media, or use file URLs.

Creation and inline Recording Folder editing retain manual text input and add
Browse. The same modal shows directories only and returns a relative path.
Select current directory confirms; Cancel/Escape closes without changing the
field. Empty root selection means no override and retains the existing
channel-name fallback. Missing, loading, empty and API error states are explicit.
No directory creation is offered, so API storage access stays read-only.

The browser knows only logical relative paths. RECORDINGS_ROOT belongs to the API;
Compose maps it to the Worker's recordings volume. Client-side folder/file inputs
and showDirectoryPicker are deliberately not used. Browsing is bounded to 1,000
immediate entries, hides dot entries and excludes symlinks.

## Linting and Formatting

See [repository linting and formatting](../README-LINTING.md) for setup, read-only checks, explicit fixes and coverage.
