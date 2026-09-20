# StreamRecorder Clone - Development Workflow

This repository's root `compose.yml` is the supported Docker Compose workflow for the current API, frontend, and Worker. The legacy Worker-specific Compose file was removed. For component architecture and focused development notes, see [API](api/README.md), [frontend](frontend/README.md), and [Worker](worker/README.md).

## Prerequisites

- Docker Desktop with Docker Compose v2.
- Git Bash, PowerShell, or another shell that can run Docker commands.
- For local (non-Docker) development: Node.js `>=25.9.0`, pnpm, Python, Streamlink, and FFmpeg.

## Quick Start

From the repository root, build and run the stack in the foreground:

```sh
docker compose up --build
```

Run it in the background instead:

```sh
docker compose up -d --build
```

Open the frontend at http://localhost:3001. The API is available at http://localhost:3000 and its health endpoint is http://localhost:3000/health. The frontend health endpoint is http://localhost:3001/health.

Check service state:

```sh
docker compose ps
```

`api` and `frontend` report `healthy` only after their HTTP healthchecks pass. HTTP `healthy` means NestJS or Next.js is accepting HTTP requests; it does not mean every component or integration is fully operational. The `worker` has no healthcheck: `running` means its container process is running, not that it has detected a stream or completed a recording.

## Daily Docker Commands

Build all images without starting containers:

```sh
docker compose build
```

Start existing images in the foreground or background:

```sh
docker compose up
docker compose up -d
```

View all logs or follow them:

```sh
docker compose logs
docker compose logs -f
```

Follow one service, especially the Worker during operational debugging:

```sh
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f worker
```

View each service's latest 100 log lines without following it:

```sh
docker compose logs --tail=100 api
docker compose logs --tail=100 frontend
docker compose logs --tail=100 worker
```

Build one image:

```sh
docker compose build api
docker compose build frontend
docker compose build worker
```

Rebuild and recreate one service:

```sh
docker compose up -d --build api
docker compose up -d --build frontend
docker compose up -d --build worker
```

The frontend declares the API as a Compose dependency, so a frontend recreation may also start the API when it is not already running. Use the simple commands above unless you specifically understand and need Compose's `--no-deps` behavior.

Restart a running service without rebuilding its image:

```sh
docker compose restart api
docker compose restart frontend
docker compose restart worker
```

`restart` does not rebuild images or apply Dockerfile changes. Use `up -d --build <service>` after image or source changes that need a new image.

Before stopping or restarting the Worker, verify that no active recording needs to finish. Interrupting the Worker can stop a recording and its child media processes; inspect its logs first.

Stop containers while retaining them, or remove the Compose containers and network:

```sh
docker compose stop
docker compose down
```

Do not use `docker compose down -v` for this workflow. The application state and recordings are host bind mounts, but avoiding volume removal keeps shutdown intentionally conservative.

## Shared Data and Configuration

Compose mounts `./runtime-data` at `/data` in both the API and Worker. The shared JSON files are:

- `watchlist.json`: WatchTarget configuration.
- `channels_status.json`: current operational state.
- `streams.json`: detected stream history.
- `sessions.json`: legacy recording persistence.

`runtime-data/` and `recordings/` are ignored by Git and must not be versioned. On a clean clone, startup creates the directories and JSON files; do not create JSON files manually. Their canonical empty forms are `watchlist.json` as `[]`, `channels_status.json` as `{}`, `streams.json` as `[]`, and `sessions.json` as `[]`. Existing files are not overwritten merely because a container starts. Keep the API and Worker pointed at the same directory when they need to share state.

Compose mounts `./recordings` at `/recordings` in the Worker. `OUTPUT_DIR` is the output root, and a WatchTarget's relative `recording_subdir` is appended beneath it. For example, `recording_subdir=twitch/pixelcarvel` writes to the host path `./recordings/twitch/pixelcarvel/`. With `OUTPUT_DIR=/recordings` and `recording_subdir=creators/example`, the Worker writes to `/recordings/creators/example`. These files are local temporary/current implementation output, not final cloud storage or public media.

`CONFIG_DIR` is infrastructure configuration, not a frontend UI or user setting. For both API and Worker, it selects a directory containing the runtime JSON files. The Worker also accepts optional per-file overrides, each with higher priority than `CONFIG_DIR`: `WATCHLIST_PATH`, `CHANNELS_STATUS_PATH`, `STREAMS_PATH`, and `SESSIONS_PATH`. Non-empty overrides win; otherwise the Worker uses `CONFIG_DIR`, then its module-relative defaults.

Inside Compose, the frontend's server uses `API_BASE_URL=http://api:3000`. Browsers never use that Docker-only hostname: frontend browser requests go through `/api/backend/*`, which proxies to the API. A `502` on `/api/backend/*` normally means the API is unavailable or `API_BASE_URL` is incorrect, not necessarily that the frontend has failed. If the API is down, the frontend health endpoint can remain healthy while proxied API requests return `502`. Start or recover the API and retry; recovery does not require a frontend restart or rebuild.

## Local Without Docker

Use separate terminals from the repository root.

API:

```sh
cd api && pnpm install && pnpm start:dev
```

Frontend:

```sh
cd frontend && pnpm install && pnpm dev
```

For the local frontend, set `API_BASE_URL` in `frontend/.env.local` before starting it:

```env
API_BASE_URL=http://localhost:3000
```

Worker:

```sh
cd worker && python -m pip install -r requirements.txt && python worker.py
```

The local Worker requires Python, Streamlink, and FFmpeg. To share the repository's normal state and output locations explicitly, use paths appropriate for your shell, for example:

```sh
CONFIG_DIR=../runtime-data OUTPUT_DIR=../recordings python worker.py
```

On PowerShell:

```powershell
$env:CONFIG_DIR = '..\runtime-data'
$env:OUTPUT_DIR = '..\recordings'
python worker.py
```

## Supported Hybrid Workflow

One supported hybrid setup is Compose for the API and Worker, with the frontend running locally:

```sh
docker compose up -d --build api worker
cd frontend && pnpm install && pnpm dev
```

Set `frontend/.env.local` to `API_BASE_URL=http://localhost:3000`. In this arrangement the local frontend talks to the Compose API through its host port, while the API and Worker continue to share the Compose bind-mounted `runtime-data` directory. Do not start a second local Worker against different paths if you expect it to observe the same state.

## Debugging

Check direct API health and the frontend health route:

```sh
curl http://localhost:3000/health
curl http://localhost:3001/health
```

Compare a direct API request with the browser-facing proxy route:

```sh
curl http://localhost:3000/watch-targets
curl http://localhost:3001/api/backend/watch-targets
```

Inspect service shells and mounted data when needed:

```sh
docker compose exec api sh
docker compose exec frontend sh
docker compose exec worker sh
docker compose exec worker sh -c 'ls -la /data'
docker compose exec worker sh -c 'ls -la /recordings'
```

Worker checklist:

```sh
docker compose ps
docker compose logs -f worker
docker compose exec worker sh -c 'ls -la /data/watchlist.json /data/channels_status.json /data/streams.json /data/sessions.json'
docker compose exec worker sh -c 'ls -la /recordings'
```

## Windows Notes

Docker Desktop works with either Git Bash or PowerShell. Git Bash normally handles the repository-relative bind mounts declared in `compose.yml` without extra configuration. Path conversion can also affect Linux path-sensitive arguments passed to `docker compose exec`, in addition to ad hoc `docker run` commands. The `sh -c '...'` forms above keep those paths in the container command and avoid conversion; for one-off commands, use `MSYS_NO_PATHCONV=1 docker compose exec ...` or PowerShell. Do not add a workaround to the normal Compose workflow.
