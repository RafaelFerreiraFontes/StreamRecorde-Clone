# StreamRecorder Clone — Docker Compose

Run the complete application stack with a single command.

## Quick Start

```bash
docker compose up --build
```

Access the application:
- Frontend: http://localhost:3001
- API: http://localhost:3000

## Services

| Service   | Image                    | Ports |
|-----------|--------------------------|-------|
| frontend  | streamrecorder-frontend  | 3001  |
| api       | streamrecorder-api       | 3000  |
| worker    | streamrecorder-worker    | -     |

## Data Persistence

- `runtime-data/` — API configuration and state files
- `recordings/` — Recorded stream files

Both directories persist on the host and are bind-mounted into the containers.

## Logs

Follow worker logs:

```bash
docker compose logs -f worker
```

## Shutdown

```bash
docker compose down
```

This stops and removes containers but preserves host data in `runtime-data/` and `recordings/`.

## Notes

- The legacy Worker Compose (`worker/docker-compose.yml`) has been removed; use this root compose for local Docker Compose runs.
- The worker runs independently and does not depend on the API process.
