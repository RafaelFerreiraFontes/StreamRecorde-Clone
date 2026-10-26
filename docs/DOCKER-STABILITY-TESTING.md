# Post-Wave 05.5 Docker Stability Testing

## Status and scope

Human execution worksheet: **all result fields are intentionally unfilled**. This is not evidence of a passed test or a change to wave status. Container health, API readiness, probe success, capture completion and playable media are separate claims.

Use the [root checkpoint](../README.md#1-operational-checkpoint-status) and exact tracked Compose selections below. Configuration rendering is not runtime or stability evidence.

## Executable PowerShell setup

Copy `.env.example` to a private environment file outside Git, configure unique disposable runtime/recordings paths, unused ports, a private URL-safe database password and bridge token. Never reuse personal data. For C set the exact browser origin. Keep the same file for every command. After confirming the project name is unused:

```powershell
$project = "sr-checkpoint-" + [guid]::NewGuid().ToString("N").Substring(0, 10)
$privateEnv = "C:/private/checkpoint.env" # replace with your private file
# Select exactly ONE mode per isolated exercise:
$files = @("-f", "compose.yml") # A
# $files = @("-f", "compose.yml", "-f", "compose.relational.yml") # B
# $files = @("-f", "compose.yml", "-f", "compose.relational.yml", "-f", "compose.authenticated.yml") # C
$selection = @("compose", "--env-file", $privateEnv, "-p", $project) + $files
docker @selection config --quiet
# B/C only, before starting the rest:
# docker @selection up -d --wait postgres
# docker @selection build api
# docker @selection run --rm --no-deps api node dist/database/migrate.js
# C only: interactive no-echo password enrollment (never pass password arguments):
# docker @selection run --rm --no-deps api node dist/auth/users-cli.js create checkpoint-user
docker @selection up --build -d
docker @selection ps
docker @selection logs --tail 100 api worker frontend
```

Open `http://127.0.0.1:<FRONTEND_HOST_PORT>` (default 3001). Verify A/B work without login and C gates data until login. Repeat each mode with a fresh project and fresh host paths; preserve evidence before stopping.

For D, use the existing disposable B/C selection and the observation matrix below:

```powershell
docker @selection restart worker
# Observe outbox replay and stable event/recording IDs before continuing.
docker @selection stop api
# Allow a fixture capture/terminal event; inspect durable backlog, then recover:
docker @selection start api
docker @selection stop postgres
# Observe bounded retries and retained events; restore:
docker @selection start postgres
docker @selection logs --tail 100 api worker
# Account revocation exercise after login with this test user:
# docker @selection run --rm --no-deps api node dist/auth/users-cli.js disable checkpoint-user
# Verify the existing browser session loses access; test logout after re-enabling.
# docker @selection run --rm --no-deps api node dist/auth/users-cli.js enable checkpoint-user
docker @selection down # retains named volumes and host bind data
```

Do not run outage exercises on a personal capture. After verifying labels and retaining evidence/backups, `docker @selection down -v` removes ONLY this disposable project's named PostgreSQL/outbox volumes. It does not delete host runtime/recordings bind directories. Never use it against unbacked-up retained data.

## Preparation and isolation

1. Inventory the normal stack without changing it. Record branch/SHA, Docker/Compose versions, image IDs, available disk space and initial container/volume identities. Never collect secrets or private media URLs.
2. Select a unique project, for example `sr-checkpoint-owned`, and project-relative directories `./checkpoint-data/runtime` and `./checkpoint-data/recordings`. Verify these are disposable and not links to normal data. Set `RUNTIME_DATA_DIR` and `RECORDINGS_DIR` accordingly. Do not use system temporary directories.
3. Choose unused loopback `API_HOST_PORT`, `FRONTEND_HOST_PORT`, `POSTGRES_PORT`. Keep a private, untracked environment file inside the owned project directory. B/C require nonempty `POSTGRES_PASSWORD` and matching `INTERNAL_API_TOKEN`; C requires exact `AUTH_TRUSTED_ORIGINS` for the chosen browser address. Do not paste secrets into evidence or shell history.
4. Use `docker compose --env-file <private-file> -p <owned-project>` followed by the selected files on every operation. A: `-f compose.yml`; B: additionally `-f compose.relational.yml`; C: additionally `-f compose.authenticated.yml`. D below is a recovery scenario, not a fourth deployment mode.
5. Run `config --quiet` with that exact selection. Inspect mounts, loopback bindings and project-prefixed volumes privately. Confirm A has three services/no PostgreSQL; B/C have PostgreSQL 17, bridge persistence and `worker-outbox:/outbox`. API recordings must be read-only, Worker writable, frontend without media mounts. Avoid sharing image tags with a normal stack during builds.
6. Start PostgreSQL for B/C first. Run migration in a one-off production API container with `node dist/database/migrate.js`. Enroll an enabled user before C startup with `node dist/auth/users-cli.js create <username>` (no-echo password prompt). Never put passwords in argv. Start remaining services only after prerequisites are met. Source CLI wrappers depend on development packages and are not production substitutes.
7. Use isolated fake Streamlink fixtures, not real channels, for repeatable capture cases. Review existing `test:smoke:json` / `test:smoke:bridge` harness isolation before running them; they do not automatically certify this matrix. Optional authorized live capture is separate evidence, never required for deterministic tests.

Record session details before executing:

| Field                                                       | Human entry |
| ----------------------------------------------------------- | ----------- |
| Date / operator / branch / SHA                              |             |
| Docker / Compose / image IDs                                |             |
| Owned project / directories / volume names                  |             |
| Selected mode / files / ports / browser origin (no secrets) |             |
| Fake fixture / duration / normal-stack baseline             |             |

## A/B/C/D human test matrix

Use PASS / FAIL / BLOCKED only after execution; include timestamp, exact sanitized command and observation. A blank cell means not executed.

| Scenario                     | Procedure and expected evidence                                                                                                                                                                                                                | Result | Evidence / issue |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------- |
| A — JSON/local startup       | Base only, exactly API/frontend/Worker; no PostgreSQL dependency. Open dashboard, create one Creator with three independent targets using different qualities.                                                                                 |        |                  |
| A — independent targets      | Edit A URL/quality/folder, disable B, delete C. Verify siblings unchanged and retained history survives deletion and restart.                                                                                                                  |        |                  |
| A — capture and storage      | Fake LIVE → capture → finished; verify nonempty retained output, correct target context, API read-only browsing and missing-file response. Fake data does not prove playability.                                                               |        |                  |
| B — relational/local startup | Add relational overlay, migrate explicitly; verify database-backed reads/writes and bridge authentication. Stop database and confirm failure is visible, not empty-success JSON fallback.                                                      |        |                  |
| B — persistent bridge state  | Inspect owned outbox mount and pending/active counts without exposing payloads. Recreate Worker, retaining its volume; verify recovery and eventual acknowledgment without duplicate captures/history.                                         |        |                  |
| C — startup guards           | On disposable configuration separately omit trusted origin, migration/account enrollment, or database connectivity. Verify fail-closed startup; restore each prerequisite. Missing B/C token/password must not become a usable deployment.     |        |                  |
| C — login and ownership      | Create two CLI accounts; use separate browser sessions. Confirm login/refresh/protected routes, cross-account resource/filter isolation, malformed session rejection and untrusted-origin mutation rejection.                                  |        |                  |
| C — logout                   | Log in, logout, refresh/back/deep-link. Replay old cookie only within the test client; verify protected API access fails. Never attach raw cookie/token to evidence.                                                                           |        |                  |
| C — account disable/reset    | Disable one enrolled account via CLI while logged in; verify old session and new login denied, other account unaffected. Re-enable and verify policy; reset password and check prior sessions invalidated.                                     |        |                  |
| D — API outage               | In B/C stop only owned API during fake capture/terminal persistence. Verify visible failures, retained pending/active records and no false durable completion; restart API and verify acknowledged reconciliation.                             |        |                  |
| D — database outage          | Stop only owned PostgreSQL during bridge event delivery; restore it. Verify no acknowledgment before commit, retries recover, and identifiers/target relationships remain consistent.                                                          |        |                  |
| D — restart/shutdown         | During fake capture stop/recreate owned Worker with normal stop timeout; verify subprocess termination/reaping, honest failure state and durable recovery. Restart full stack without deleting volumes; verify accounts/history/media persist. |        |                  |
| D — target disable           | Disable a target before a new launch: no new probe/capture. Disable during active capture: current attempt and pending terminal persistence continue independently. Siblings keep their settings/behavior.                                     |        |                  |
| D — observation window       | Record chosen duration and periodic disk/container/history/outbox observations. Check for accumulating children, unexplained backlog, duplicate history and stale UI warnings. No heartbeat means old active state is not liveness proof.      |        |                  |
| D — cleanup                  | Verify exact owned resources before removal; record removed and retained items and normal-stack comparison.                                                                                                                                    |        |                  |

## Recovery procedure

1. Preserve recording files, logs with secrets redacted, database volume and outbox. Stop new work if necessary; do not manually clear pending/active entries or overwrite metadata.
2. Distinguish network/probe, subprocess, persistence and authentication errors. ERROR is not confirmed OFFLINE. Check exact target URL/configuration without logging private URLs.
3. Restore database connectivity/schema and API/internal-token configuration before retrying bridge delivery. Do not switch to stale JSON after relational writes. For migration/cutover use [database recovery policy](../api/README.database.md).
4. Observe acknowledgment after durable commit and reconcile original Stream/Recording IDs, target ownership and terminal state. Report unresolved backlog explicitly; retained output alone is not durable history success.
5. Back up consistently with writers quiesced, retaining database, configuration, outbox and media. Do not expose database dumps, password hashes, sessions or event payloads in test artifacts.

## Safe cleanup

- Save sanitized evidence first. Use the exact project, environment and file selection used for startup. Check Compose ownership labels and mount sources again.
- For retained data use `down` **without** `-v`. This must retain PostgreSQL/outbox volumes and host media/configuration.
- Remove only individually verified disposable test volumes after stopping the owned project and explicitly deciding no recovery evidence/data must be kept. Never use global prune, wildcard deletion or `down -v` against a normal stack.
- Delete project-relative fixture directories only after verifying their resolved paths, ownership and contents. Never delete real recordings or normal runtime-data. Record anything deliberately retained; interrupted cleanup is not successful cleanup.
- Compare normal-stack containers, mounts and retained media to the pre-test inventory. Report discrepancies instead of broadening cleanup.

## Evidence summary (human completion only)

| Field                                                    | Human entry |
| -------------------------------------------------------- | ----------- |
| Executed scenarios / commands / timestamps               |             |
| Failures / blockers / issue references                   |             |
| Retained resources / cleanup outcome                     |             |
| Normal-stack preservation                                |             |
| Optional authorized live/playability evidence (separate) |             |
| Operator conclusion / remaining unexecuted checks        |             |
