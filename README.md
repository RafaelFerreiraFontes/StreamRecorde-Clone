# StreamRecorder Clone

Automated live stream monitoring and local recording capture for Twitch, YouTube, and Kick. Built as a local-first application with a modular NestJS API, Python Worker, Next.js dashboard, and dual persistence options (transitional shared JSON and robust PostgreSQL with Drizzle ORM).

---

## Language / Idioma

- [English](#english)
- [Português (Brasil)](#português-brasil)

---

# English

## Table of Contents

- [Overview](#overview)
- [What StreamRecorder Clone Does](#what-streamrecorder-clone-does)
- [Current Implemented Features](#current-implemented-features)
- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Local Quick Start with Docker Compose](#local-quick-start-with-docker-compose)
- [JSON vs PostgreSQL Persistence Modes](#json-vs-postgresql-persistence-modes)
- [Worker Persistence Bridge and Durable Outbox](#worker-persistence-bridge-and-durable-outbox)
- [Legacy JSON Migration and Authority Cutover](#legacy-json-migration-and-authority-cutover)
- [Testing and Docker Integration QA](#testing-and-docker-integration-qa)
- [Configuration and Environment Variables](#configuration-and-environment-variables)
- [Recording Storage, Security, and Privacy](#recording-storage-security-and-privacy)
- [Current Limitations](#current-limitations)
- [Roadmap and Project Status](#roadmap-and-project-status)
- [Component Documentation Links](#component-documentation-links)
- [License](#license)

---

## Overview

StreamRecorder Clone is an open-source, local-first streaming tool inspired by StreamRecorder. It is engineered to monitor content creators across live-streaming platforms and automatically capture their broadcasts into private, local video files.

The product prioritizes:
- **Local-first execution**: Complete core functionality runs on the user's computer without requiring cloud services, external OAuth, or hosted infrastructure.
- **Architectural separation**: Clear boundaries between Creator identity, WatchTarget monitoring configurations, actual broadcast Streams, and physical Recording capture attempts.
- **Reliable operation**: Cooperative subprocess control, adaptive quality fallback, durable outbox event recovery, and transactional database integrity.

---

## What StreamRecorder Clone Does

1. **Monitors Creators**: Periodically checks live status on Twitch, YouTube, and Kick based on configured WatchTargets.
2. **Classifies Live Status**: Distinguishes confirmed `LIVE`, confirmed `OFFLINE`, and platform/network `ERROR` states to prevent premature stream closure or false capture attempts.
3. **Selects Quality Adaptively**: Attempts to record at the user's preferred quality (e.g. `1080p60`, `best`, `720p`), with graceful runtime fallback to the next best available variant without rewriting the saved configuration.
4. **Captures Streams**: Launches and supervises Streamlink processes with clean termination and signal propagation (SIGTERM).
5. **Persists History**: Records broadcast intervals, capture metadata, and local output file locations into durable storage.
6. **Provides Local Management**: Exposes an operational Next.js web dashboard with real-time polling, safe folder browsing, and configuration CRUD.

---

## Current Implemented Features

- **Domain Model Separation**:
  - `Creator`: Stable identity of the content creator.
  - `WatchTarget`: Independent monitoring configuration (platform, channel, quality, authoritative URL, relative recording subdirectory, enabled state). A single Creator can hold multiple independent WatchTargets.
  - `Stream`: A specific detected broadcast occurrence.
  - `Recording`: A concrete capture attempt linked to a known Stream.
- **Platform Support**: Twitch, YouTube, and Kick live-stream probing and capturing.
- **Subprocess & Signal Lifecycle**: Non-root containerized Python Worker with cooperative subprocess shutdown, graceful SIGTERM handling, and orphan process reaping.
- **PostgreSQL 17 & Drizzle ORM**: Complete relational schema with declarative composite foreign keys `(stream_id, watch_target_id)` enforcing target consistency, immutable configuration snapshots (`channel_name`, `platform`, `quality`), and typed `timestamptz` instants.
- **Dual Persistence Modes**:
  - *Default Mode*: Shared JSON files (`watchlist.json`, `channels_status.json`, `streams.json`, `sessions.json`).
  - *Relational Bridge Mode*: PostgreSQL domain authority via an internal REST bridge with durable outbox.
- **Worker Persistence Bridge**: Option A architecture where the Worker communicates with the NestJS API via HTTP (`/internal/v1/*`) protected by an internal token. The Worker never opens a direct database connection.
- **Durable Disk Outbox**: FIFO-ordered local outbox (`outbox/pending/` and `outbox/active/`) with fail-closed startup recovery, active session checkpoints, and exponential retry backoff with jitter.
- **Legacy Migration CLI**: Comprehensive opt-in migration tool with non-destructive `dry-run`, `backup` with SHA-256 manifests, transactional `import`, post-import `verify`, and `cutover-check`.
- **Private Filesystem Browser**: Read-only in-app folder picker and path validator enforcing root containment and symlink traversal restrictions.
- **Hardened Local Networking**: Host ports published to loopback `127.0.0.1` by default to safeguard unauthenticated local development.

---

## Architecture Overview

```text
Default Mode (Legacy JSON):
Browser -> Next.js Proxy -> NestJS API -> JSON Adapters
Python Worker -> Direct JSON Files
Streamlink Subprocess -> Local Recording Storage

Relational Opt-in Mode (PostgreSQL + Bridge):
Browser -> Next.js Proxy -> NestJS API -> PostgreSQL (Drizzle)
Python Worker -> Internal REST API (/internal/v1/*) -> PostgreSQL
Worker -> Durable Disk Outbox (pending/ & active/) -> Internal Events
Streamlink Subprocess -> Local Recording Storage
```

```mermaid
flowchart TD
    subgraph Client ["Frontend Layer"]
        UI["Next.js App Router\n(Port 3001)"]
        Proxy["/api/backend/*\n(Secure API Proxy)"]
        UI --> Proxy
    end

    subgraph API ["NestJS API Layer (Port 3000)"]
        Ctrl["Domain Controllers\n(/creators, /watch-targets,\n/streams, /recordings)"]
        IntCtrl["Internal Controller\n(/internal/v1/*)\n[Guarded by Token]"]
        Service["Streams & Internal Events Service"]
        RelRepo["Relational Repositories\n(Drizzle ORM)"]
        JSONAdapters["JSON Compatibility Adapters"]

        Proxy --> Ctrl
        Ctrl --> Service
        IntCtrl --> Service
        Service --> RelRepo
        Service --> JSONAdapters
    end

    subgraph Storage ["Persistence Options"]
        PG[("PostgreSQL 17\n(Primary Relational Store)")]
        JSONFiles[("Shared JSON Files\n(Transitional Storage)")]
        RelRepo --> PG
        JSONAdapters --> JSONFiles
    end

    subgraph Execution ["Worker Media Execution"]
        Worker["Python Polling Worker\n(Non-Root UID 1000)"]
        Outbox["Durable Disk Outbox\n(pending/ & active/)"]
        SL["Streamlink Subprocess\n(Pipes / Signals)"]
        LocalMedia[("Local Recording Storage\n(/recordings)")]

        Worker --> Outbox
        Outbox -.->|HTTP + Token| IntCtrl
        Worker -->|Reads Config (JSON Mode)| JSONFiles
        Worker --> SL
        SL --> LocalMedia
    end
```

---

## Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS, TypeScript 5.9 |
| **Backend API** | NestJS 11, Express, Node.js 24/25, TypeScript 5.7+ |
| **Database & ORM** | PostgreSQL 17 (`postgres:17-alpine`), Drizzle ORM 0.44+, Drizzle Kit |
| **Worker & Media** | Python 3.12, Streamlink 8.6.1, FFmpeg (stream remuxing) |
| **Orchestration** | Docker & Docker Compose v2, Alpine/Debian slim base images |

---

## Local Quick Start with Docker Compose

### Prerequisites

- Docker Desktop with Docker Compose v2.
- Git.
- For local (non-Docker) development: Node.js `>=25.9.0`, pnpm, Python 3.10+, Streamlink 8.6.1, and FFmpeg.

## Local Quick Start with Docker Compose

### 1. Start the Stack (Default JSON Mode)

From the repository root, start all containers:

```sh
docker compose up -d --build
```

Access the application:
- **Dashboard UI**: [http://localhost:3001](http://localhost:3001)
- **API Health**: [http://localhost:3000/health](http://localhost:3000/health)
- **Frontend Health**: [http://localhost:3001/health](http://localhost:3001/health)

Host ports are bound to loopback `127.0.0.1` by default to safeguard unauthenticated local development.

### 2. Service Management and Logs

Check container states:

```sh
docker compose ps
```

`api` and `frontend` report `healthy` after their HTTP healthchecks pass. HTTP `healthy` indicates the service accepts requests; it does not prove active stream detection. `worker` runs as a continuous non-root background process.

Follow logs for debugging:

```sh
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f frontend
```

To stop containers while preserving data volumes:

```sh
docker compose stop
```

To take down containers and the internal network:

```sh
docker compose down
```

---

## JSON vs PostgreSQL Persistence Modes

| Mode | API Authority | Worker Persistence | Configuration |
|---|---|---|---|
| **JSON (Default)** | Shared JSON adapters | Direct JSON files | `RELATIONAL_STORAGE=false`, `PERSISTENCE_MODE=direct_json` |
| **Relational Bridge (Opt-in)** | PostgreSQL 17 (Drizzle ORM) | Internal API (`/internal/v1/*`) + Durable Outbox | `RELATIONAL_STORAGE=true`, `PERSISTENCE_MODE=bridge` |

To run in **Relational Bridge Mode**, configure environment variables in a local `.env` or Compose override:

```env
# API
RELATIONAL_STORAGE=true
PERSISTENCE_MODE=bridge
INTERNAL_API_TOKEN=your-private-secret-token-here
DATABASE_URL=postgresql://streamrecorder:streamrecorder_dev_local@postgres:5432/streamrecorder

# Worker
PERSISTENCE_MODE=bridge
PERSISTENCE_BRIDGE_URL=http://api:3000
INTERNAL_API_TOKEN=your-private-secret-token-here
OUTBOX_DIR=/outbox
```

Apply database migrations before launching relational services:

```sh
docker compose exec api node dist/database/migrate.js
```

---

## Worker Persistence Bridge and Durable Outbox

The Python Worker uses the **Option A persistence bridge**:
- **Zero Direct Database Coupling**: The Worker never connects directly to PostgreSQL. It communicates strictly via HTTP with the NestJS API.
- **Fail-Closed Security**: Both API and Worker require matching `INTERNAL_API_TOKEN`. Missing or blank tokens fail closed.
- **Outbox Architecture**:
  - `outbox/pending/`: Stores unacknowledged events in `{timestamp_ms}_{sequence}_{event_id}.json` format.
  - `outbox/active/`: Holds ongoing session checkpoints with PID tracking.
- **Restart Recovery**: On startup, `recover()` scans checkpoints. Interrupted captures with dead PIDs are marked as `error` (reason: `worker_restart_interruption`), while pending events are replayed with exponential backoff and jitter.

---

## Legacy JSON Migration and Authority Cutover

Existing installations with data in `watchlist.json`, `streams.json`, and `sessions.json` migrate using the built-in CLI:

```sh
# 1. Non-destructive validation
pnpm --dir api migrate:legacy dry-run --source /path/to/runtime-data

# 2. Quiesced backup with SHA-256 manifest
pnpm --dir api migrate:legacy backup --source /path/to/runtime-data --destination /path/to/backup --quiesced

# 3. Transactional import into PostgreSQL
pnpm --dir api migrate:legacy import --snapshot /path/to/backup --manifest /path/to/backup/manifest.json --quiesced

# 4. Verify database records against source snapshot
pnpm --dir api migrate:legacy verify --snapshot /path/to/backup --manifest /path/to/backup/manifest.json

# 5. Check cutover readiness and outbox status
pnpm --dir api migrate:legacy cutover-check --source /path/to/runtime-data --api-url http://localhost:3000 --observation-ms 5000 --outbox /path/to/outbox
```

Post-cutover rollback rejects reverse export to legacy JSON because the legacy schema lacks `stream_id` and immutable snapshots. Recovery post-cutover is strictly forward repair. See [api/README.database.md](api/README.database.md) for runbooks.

---

## Testing and Docker Integration QA

The repository includes a comprehensive, deterministic test suite:

```sh
# 1. API Unit & Integration Tests
pnpm --dir api test --runInBand
pnpm --dir api exec tsc --noEmit
pnpm --dir api build

# 2. Frontend Tests & Typecheck
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build

# 3. Worker Python Tests
python -m unittest discover -s worker -p "test_worker.py"
pytest worker/test_worker.py -q

# 4. Real Isolated PostgreSQL Integration Suite
node scripts/test-db-foundation.mjs

# 5. Full Migration & Forward-Repair Rehearsal
node scripts/test-wave05-rehearsal.mjs

# 6. Live Docker Integration Smoke (Scenario A JSON + Scenario B Bridge)
pnpm test:smoke

# 7. Git Whitespace Hygiene
git diff --check
```

---

## Configuration and Environment Variables

| Variable | Scope | Default | Description |
|---|---|---|---|
| `PORT` | API / Frontend | `3000` / `3001` | HTTP listening port inside container |
| `API_HOST_PORT` | Host | `3000` | Loopback port mapped to NestJS API (`127.0.0.1`) |
| `FRONTEND_HOST_PORT` | Host | `3001` | Loopback port mapped to Next.js UI (`127.0.0.1`) |
| `POSTGRES_PORT` | Host | `5432` | Loopback port mapped to PostgreSQL (`127.0.0.1`) |
| `RELATIONAL_STORAGE` | API | `false` | Enables PostgreSQL repositories when `true` |
| `PERSISTENCE_MODE` | API / Worker | `direct_json` | Set to `bridge` for relational bridge mode |
| `PERSISTENCE_BRIDGE_URL` | Worker | `""` | URL to internal API (e.g. `http://api:3000`) |
| `INTERNAL_API_TOKEN` | API / Worker | `""` | Secret token guarding `/internal/v1/*` routes |
| `DATABASE_URL` | API | *PostgreSQL URI* | Connection string for PostgreSQL database |
| `CONFIG_DIR` | API / Worker | `/data` | Directory for shared runtime JSON files |
| `OUTPUT_DIR` | Worker | `/recordings` | Base directory where video files are written |
| `RECORDINGS_ROOT` | API | `/recordings` | Base directory for API read-only file browser |
| `API_BASE_URL` | Frontend | `http://api:3000` | Upstream API address used by Next.js proxy |

---

## Recording Storage, Security, and Privacy

- **Private Local Files**: All video captures are stored strictly on the local filesystem within `OUTPUT_DIR`.
- **No Public Media Exposure**: StreamRecorder Clone contains no public video distribution, indexing, or streaming feature.
- **Trusted Environment**: The application is intended for single-user local development without built-in user authentication.
- **Network Containment**: Do not expose host ports directly to untrusted public networks. Keep bindings on `127.0.0.1`.

---

## Current Limitations

- **No Multi-User Authentication**: Persisted user accounts, login, and authorization belong to **Wave 05.5**.
- **No Distributed Queue**: Long-running captures are orchestrated directly by Worker polling; BullMQ/Redis jobs belong to **Wave 06**.
- **No Cloud Export**: Cloud upload to Google Drive, Dropbox, or OneDrive belongs to **Waves 09–10**. Local recording success is completely independent of cloud status.
- **No SSE / Heartbeat**: Status uses UI polling; server-sent events and Worker heartbeats belong to **Wave 08**.
- **Desktop Packaging**: Tauri 2 desktop shell is planned for **Wave 08.5**.

---

## Roadmap and Project Status

- **Wave 01**: Validation and cleanup (`done`)
- **Wave 02**: Domain model extraction and JSON adapters (`done`)
- **Wave 03**: Containerization and Docker Compose (`done`)
- **Wave 04 / 04.5 / 04.75**: Worker reliability, recording folder browser, and adaptive quality (`done`)
- **Wave 05**: PostgreSQL Domain Persistence, Drizzle ORM, Worker Bridge, Migration CLI, and Docker QA (`completed`)
- **Wave 05.5**: User Accounts, Authentication, and Resource Ownership (*planned next*)

For full roadmap tracking, see [PROJECT-STATUS.md](PROJECT-STATUS.md).

---

## Component Documentation Links

- [API Technical Documentation](api/README.md)
- [Database Runbook, Migrations & Recovery](api/README.database.md)
- [Worker Technical Documentation](worker/README.md)
- [Frontend Technical Documentation](frontend/README.md)

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

# Português (Brasil)

## Visão Geral

O **StreamRecorder Clone** é uma aplicação local-first inspirada no StreamRecorder, projetada para monitorar criadores de conteúdo na Twitch, YouTube e Kick e gravar transmissões ao vivo automaticamente em arquivos de vídeo locais e privados.

O projeto foi desenhado com forte separação de responsabilidades entre quem é monitorado (`Creator`), como monitorar (`WatchTarget`), as transmissões reais detectadas (`Stream`) e as tentativas físicas de captura (`Recording`).

---

## Funcionalidades Principais

- **Monitoramento Multiplataforma**: Verificação contínua de status na Twitch, YouTube e Kick.
- **Classificação Precisa**: Separação estrita entre `LIVE` (ao vivo), `OFFLINE` (fora do ar) e `ERROR` (falhas transitórias de rede).
- **Qualidade Adaptativa**: Tentativa de gravação na qualidade configurada com fallback em tempo de execução sem alterar a preferência persistida.
- **Persistência Dupla**:
  - *Modo JSON (Padrão)*: Arquivos locais compartilhados.
  - *Modo Relacional (Opt-in)*: Banco PostgreSQL 17 gerenciado via Drizzle ORM.
- **Ponte de Persistência do Worker**: Comunicação desacoplada entre Worker Python e API NestJS via HTTP com token de autenticação e outbox durável em disco com tolerância a falhas e reinicializações.
- **Painel de Controle em Next.js**: Interface moderna para gerenciar alvos, monitorar status, inspecionar histórico e navegar pelo sistema de arquivos de gravações locais de forma segura.
- **Privacidade Total**: Gravações salvas estritamente no disco local do usuário, sem servidores públicos de vídeo ou uploads obrigatórios para a nuvem.

---

## Início Rápido com Docker Compose

### Pré-requisitos
- Docker Desktop com suporte a Compose v2.

### Inicialização
Para construir as imagens e iniciar todos os serviços no modo padrão:

```sh
docker compose up -d --build
```

Acesse a interface no navegador:
- **Painel**: [http://localhost:3001](http://localhost:3001)
- **Status da API**: [http://localhost:3000/health](http://localhost:3000/health)

Por segurança, as portas no host são publicadas exclusivamente em loopback `127.0.0.1`.

---

## Modos de Persistência

1. **Modo Padrão (JSON)**:
   - A API e o Worker utilizam arquivos no diretório `runtime-data/`.
   - O banco PostgreSQL é mantido em repouso e não é obrigatório para iniciar a stack.
2. **Modo Relacional (PostgreSQL + Worker Bridge)**:
   - Ativado configurando `RELATIONAL_STORAGE=true`, `PERSISTENCE_MODE=bridge`, `DATABASE_URL` e `INTERNAL_API_TOKEN`.
   - O Worker utiliza a outbox atômica em disco para garantir entrega de eventos mesmo em caso de reinicialização ou indisponibilidade temporária da API.
   - Migração assistida via CLI: `pnpm --dir api migrate:legacy dry-run|backup|import|verify|cutover-check`.

Consulte o [Runbook de Banco de Dados](api/README.database.md) para procedimentos completos de migração, cutover e forward-repair.

---

## Limitações Atuais e Próximos Passos

- O sistema opera em ambiente local confiável e não possui tela de login ou autenticação de usuários (previsto para a **Wave 05.5**).
- As capturas são orquestradas diretamente pelo Worker via polling; filas de segundo plano com Redis/BullMQ pertencem à **Wave 06**.
- A exportação para Google Drive, Dropbox ou OneDrive é secundária e opcional, pertencente às **Waves 09 e 10**.

Consulte [PROJECT-STATUS.md](PROJECT-STATUS.md) para o roadmap completo do projeto.
