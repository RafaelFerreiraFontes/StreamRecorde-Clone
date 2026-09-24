# StreamRecorder integration frontend

This is a technical API + Worker testing console, not the final product UI. It provides a foundation for inspecting the current domain and debugging local integration without adding future infrastructure.

## Architecture

Browser → Next.js `/api/backend/*` → NestJS → shared JSON adapters.
The independent Python Worker reads `watchlist.json` and persists runtime state to `channels_status.json`, `streams.json`, and `sessions.json`. NestJS translates these into domain responses. The frontend never reads these files, starts the Worker, invokes media tools, or serves recorded media.

Next.js App Router, TypeScript, React, Tailwind CSS and native fetch. A shared provider polls the four domain collections every 5 seconds while the document is visible. Navigation reuses the same provider. Overlapping refreshes are deduplicated; mutations wait for an in-flight refresh and then request fresh data. Each collection has independent loading/error/stale-data handling. Request diagnostics retain the latest 80 requests in memory.

## Requirements and setup

Use the repository's Node.js requirement (>=25.9.0) and pnpm. No UI framework, authentication, database, queue, or realtime transport is required. For the supported Docker Compose workflow, service lifecycle commands, shared-state behavior, and Windows notes, see the [root development guide](../README.md).

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

`API_BASE_URL` is server-only. The proxy reads it at request time; restart development after environment-file changes. Never prefix it with `NEXT_PUBLIC_`. The proxy allowlists current routes and GET/POST/DELETE/PATCH operations, forwards JSON bodies and the Recording filter, preserves upstream HTTP errors, disables caching and times out upstream calls after 10 seconds. It rejects cross-origin mutations and does not proxy cookies, credentials, filesystem resources, or arbitrary destinations. No backend CORS changes are needed. This unauthenticated console is intended for a trusted local development environment.

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
DELETE /watch-targets/:id
GET /streams
GET /recordings
GET /recordings?watchTargetId=<id>
```

Diagnostics only: `GET /streamer` and `GET /session`. Individual entity GET routes are supported by the proxy but not currently needed by these collection views. No legacy types enter the main domain model. The proxy supports the API's `PATCH /watch-targets/:id` recording-subdirectory update, but the current UI does not present edit, enable, or disable controls.

## Current limitations

- Creator identity is derived from display name. The selected/new name is submitted as `creator_id` and translated at the legacy boundary; no Creator mutation exists.
- `enabled` is enforced by the Worker, but the current UI has no toggle or general update control.
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

Implementation evidence includes deterministic Worker coverage (161 tests) and the root `pnpm test:smoke` Docker Gates A-D: classification, lifecycle, persistence denial/recovery, API/Worker cross-writer cycles, active-child SIGTERM/reaping, and secret-safe logs. The smoke uses deterministic fake Streamlink; it does not validate a real platform, network, captured media, or playable MP4. Browser automation timed out repeatedly, so visual rendering, responsive layout and browser-driven create/delete/polling interactions still require the manual workflow above.
