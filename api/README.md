# API — StreamRecorder Clone

## Language / Idioma

- [English](#english)
- [Português (Brasil)](#português-brasil)

## Table of Contents / Índice

### English

- [Overview](#overview)
- [Responsibilities](#responsibilities)
- [Internal Architecture](#internal-architecture)
- [Domain Model](#domain-model)
- [Current Domain API](#current-domain-api)
- [Legacy API](#legacy-api)
- [JSON Persistence](#json-persistence)
- [Concurrency and Atomicity](#concurrency-and-atomicity)
- [Running Locally](#running-locally)
- [Tests](#tests)
- [Known Limitations](#known-limitations)
- [Outside API Responsibilities](#outside-api-responsibilities)
- [Relationship with the Worker](#relationship-with-the-worker)

### Português (Brasil)

- [Visão geral](#visão-geral)
- [Responsabilidades](#responsabilidades)
- [Arquitetura interna](#arquitetura-interna)
- [Modelo de domínio](#modelo-de-domínio)
- [API de domínio atual](#api-de-domínio-atual)
- [API legacy](#api-legacy)
- [Persistência JSON](#persistência-json)
- [Concorrência e atomicidade](#concorrência-e-atomicidade)
- [Execução local](#execução-local)
- [Testes](#testes)
- [Limitações conhecidas](#limitações-conhecidas)
- [Fora da responsabilidade da API](#fora-da-responsabilidade-da-api)
- [Relacionamento com o Worker](#relacionamento-com-o-worker)

---

# English

## Overview

The current API is a NestJS application responsible for exposing the current project domain model and maintaining compatibility with the legacy layer already used by the Worker and the existing tests.

At this stage, the API is not the recording engine itself. It acts as the exposure, validation, and integration layer between the future frontend/client, the domain rules, and the JSON files shared with the Worker.

The API currently exposes two groups of contracts:

- Domain API
  - Creator
  - WatchTarget
  - Stream
  - Recording

- Legacy compatibility API
  - Streamer
  - Session

Persistence is still based on JSON files shared with the Worker rather than on a relational database or an external queue.

## Responsibilities

The API is currently responsible for:

- exposing REST endpoints;
- validating inputs through DTOs;
- organizing the Controller → Service → Repository flow;
- converting JSON formats through compatibility adapters;
- maintaining compatibility with legacy endpoints;
- querying Creators;
- querying and creating/removing WatchTargets;
- querying Streams;
- querying Recordings;
- providing the read and mapping layer for the current Worker state;
- protecting in-process Node operations with `async-mutex`.

Important: `async-mutex` only protects concurrent operations inside the Node process. It does not synchronize the Python Worker process.

## Internal Architecture

The current chain is:

Controller
→ Service
→ Repository
→ JSON compatibility adapters
→ JSON files

Core API files:

- `src/streams/domain.model.ts` — minimal current domain model; defines Creator, WatchTarget, Stream, and Recording.
- `src/streams/streams.controller.ts` — HTTP endpoints exposed by the API.
- `src/streams/streams.service.ts` — orchestration between the controller and the repository.
- `src/streams/streams.repository.ts` — JSON access and read/query/remove logic.
- `src/streams/json-compatibility.adapters.ts` — translation between the domain model and the legacy JSON formats.
- `src/streams/dto/` — DTOs for input validation and compatibility.
- `src/streams/test/` — controller/repository and compatibility tests.

The API does not implement filesystem access directly in the controllers. Physical access to JSON files is isolated in the adapters and repository.

## Domain Model

The current model explicitly separates the entities:

### Creator

Represents the grouping identity of the monitored content.

- `id`
- `display_name`

At this stage, Creator still functions as identity grouped by a simple convention based on `display_name`.

### WatchTarget

Represents the persistent monitoring configuration.

- `id`
- `creator_id`
- `channel_name`
- `platform`
- `url`
- `quality`
- `enabled`
- `state`

Important decision: WatchTarget represents the “how” the creator will be monitored; it is not a live occurrence.

### Stream

Represents a specific detected broadcast occurrence.

- `id`
- `watch_target_id`
- `state`
- `started_at`
- `finished_at?`

Important decision: Stream is an actual live occurrence and not the persistent monitoring configuration.

### Recording

Represents a capture attempt.

- `session_id`
- `watch_target_id`
- `stream_id?`
- `started_at`
- `finished_at?`
- `output_file?`
- `state`

Important decisions:

- one Stream can have multiple Recording attempts;
- `watch_target_id` belongs to the new domain;
- `channel_id` remains only in legacy boundaries when required;
- the new domain should not leak `channel_id` in `/recordings` or `/streams` responses.

## Current Domain API

### Creator

- `GET /creators`
- `GET /creators/:id`
- `GET /creators/:id/watch-targets`

Purpose:

- list and query grouped identities;
- return the WatchTargets related to a Creator.

### WatchTarget

- `GET /watch-targets`
- `GET /watch-targets/:id`
- `POST /watch-targets`
- `PATCH /watch-targets/:id` (updates `recording_subdir`; an empty string clears it)
- `DELETE /watch-targets/:id`

Purpose:

- query monitoring configuration;
- create persistent configuration for a Creator;
- remove a single WatchTarget without corrupting the sibling targets of the same Creator.

### Stream

- `GET /streams`
- `GET /streams/:id`

Purpose:

- query actual detected stream occurrences;
- distinguish Stream from WatchTarget and Recording.

### Recording

- `GET /recordings`
- `GET /recordings/:id`
- `GET /recordings?watchTargetId=<id>`

Purpose:

- query capture records;
- filter by `watchTargetId` in the domain layer;
- keep the domain API distinct from the legacy compatibility layer.

## Legacy API

These routes still exist for compatibility with the current MVP state and should be treated as compatibility, not as the future model.

- `GET /streamer`
- `GET /streamer/:id`
- `POST /streamer`
- `DELETE /streamer/:id`

- `GET /session`
- `GET /session/:id`
- `GET /session/channel/:id`

These routes remain functionally valid, but should not be used as the basis for the new frontend or as the source of truth for the current domain.

## JSON Persistence

The current layer still uses JSON shared between the API and the Worker.

Current boundaries:

```text
watchlist.json       ↔ WatchTarget
channels_status.json ↔ runtime status snapshot
streams.json         ↔ Stream
sessions.json        ↔ Recording legacy persistence
```

The translation between domain and physical format is performed by the adapters:

- `WatchTargetJsonAdapter`
- `RuntimeStatusJsonAdapter`
- `StreamJsonAdapter`
- `RecordingJsonAdapter`

These adapters provide the necessary compatibility layer so the API and Worker can share the same persistence mechanism without mixing domain rules and physical JSON format.

## Concurrency and Atomicity

What exists today:

- `async-mutex` protects only concurrent operations inside the Node process;
- there is no distributed lock;
- the Python Worker is a separate process and does not participate in this synchronization;
- relevant writes use temporary-file writes followed by atomic replace;
- invalid JSON is not silently masked;
- retries are limited and explicit during JSON reads.

Important observation: this layer is compatible with the current MVP, but it does not replace a more robust multi-process coordination solution in future phases.

Wave 04.7 smoke evidence covers two supported `POST`/`GET`/`DELETE` API-to-Worker cycles against the same isolated named `/data` volume. Atomic-replace compatibility is validated, but this is not a transaction or distributed-lock guarantee.

## Configuration File Paths

The API resolves file paths using explicit precedence:

```
NON-EMPTY individual env var > NON-EMPTY CONFIG_DIR + filename > local default
```

Individual environment variables:

- `WATCHLIST_PATH` - watchlist.json path
- `CHANNELS_STATUS_PATH` - channels_status.json path
- `SESSIONS_PATH` - sessions.json path
- `STREAMS_PATH` - streams.json path

If an individual path is set and non-empty, it is used directly.

Otherwise, if `CONFIG_DIR` is set and non-empty, the filename is appended to it.

Otherwise, the local default is used (relative to `cwd/../worker/config`).

Important: an empty string is NOT a valid override. An empty `WATCHLIST_PATH` will fall through to `CONFIG_DIR` or the local default.

### recording_subdir Field

The `recording_subdir` field on WatchTarget specifies a relative subdirectory path for recordings.

Validation rules:

- Relative paths only (no leading `/` or `\`)
- No Windows drive letters (`C:\...`)
- No UNC paths (`\\server\share`)
- No traversal patterns (`.`, `..`)
- Max 255 characters
- Normalized to forward slashes, with leading/trailing slashes removed

Example: `favorites/twitch` or `twitch/channels/pixelcarvel`

Empty string clears the override (uses channel name fallback).

### OUTPUT_DIR Root

The API does not directly control `OUTPUT_DIR`. This is a Worker configuration.

The Worker uses `OUTPUT_DIR` as the root for all recording subdirectories. The `recording_subdir` field is appended as a relative subdirectory under this root.

## Running Locally

The scripts actually available in `api/package.json` are:

```bash
pnpm install
pnpm start:dev
pnpm build
pnpm test
pnpm exec jest --runInBand
pnpm exec tsc --noEmit
```

Development execution command:

```bash
cd api
pnpm install
pnpm start:dev
```

Important: the current `lint` script uses `eslint ... --fix`.

```json
"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"
```

This script should not be treated as a read-only validation step; it modifies files automatically. The current documentation follows the actual code and does not recommend using lint as a gate without explicit corrective action.

## Tests

The API has real tests in `src/streams/test/stream.controller.spec.ts`.

The tests cover:

- Domain API endpoints;
- legacy endpoints;
- grouping of multiple WatchTargets under a Creator;
- isolated WatchTarget removal;
- Stream identity;
- Recording filtering by `watchTargetId`;
- compatibility mapping `channel_id` ↔ `watch_target_id`;
- atomic write and JSON reads;
- absence of `channel_id` in domain payloads.

The current suite has 68 tests. Run `pnpm test` and `pnpm exec tsc --noEmit`; the repository-level `pnpm test:smoke` adds the isolated API/Worker cross-writer evidence.

There are no tests for frontend, auth, cloud upload, Redis, PostgreSQL, external queue, or SSE in this layer.

## Known Limitations

Known limitations verified in the current code:

- persistence still depends on local JSON files;
- `Creator.id` is derived from `display_name` and is not yet an independent persistent identity;
- `Recording.stream_id` is not persisted in the legacy `sessions.json`;
- `WatchTarget.enabled` is enforced by the Worker; the API exposes the persisted value but has no general update route beyond `recording_subdir`;
- there is no authentication;
- there is no PostgreSQL;
- there is no external Redis queue;
- there are no cloud storage providers implemented;
- there is no WebSocket/SSE;
- there is no frontend yet.

These are known limitations of the current state and should not be confused with bugs in the working functionality.

## Outside API Responsibilities

The current API is not responsible for:

- capturing video;
- executing FFmpeg;
- executing Streamlink;
- managing the active recording process;
- uploading to Google Drive, Dropbox, or OneDrive;
- implementing automatic retention;
- exposing the frontend or UI;
- making final storage decisions.

The API is the domain, orchestration, and exposure layer, not the multi-step execution layer for the media workflow.

## Relationship with the Worker

```text
User / future frontend
        ↓
       API
        ↓
   watchlist.json
        ↓
      Worker
        ↓
channels_status.json
streams.json
sessions.json
        ↓
       API
```

This integration between API and Worker is a transient MVP architecture based on shared JSON. The goal is to keep the separation between domain and execution until a more structured persistence layer is introduced in a later phase.

## Executive Summary

The current API is a domain, observation, and compatibility layer around the monitoring and recording MVP. It exposes the current Creator/WatchTarget/Stream/Recording model, preserves compatibility with the legacy set, and serves as the integration point between the domain code and the Worker JSON management layer.

---

# Português (Brasil)

## Visão geral

A API atual é uma aplicação NestJS responsável por expor o modelo de domínio atual do projeto e manter compatibilidade com a camada legacy já usada pelo Worker e pelos testes existentes.

Nesta fase, a API não é o motor de gravação em si. Ela atua como camada de exposição, validação e integração entre o frontend/futuro cliente, as regras do domínio e os arquivos JSON compartilhados com o Worker.

A API atual expõe dois grupos de contratos:

- Domain API
  - Creator
  - WatchTarget
  - Stream
  - Recording

- Legacy compatibility API
  - Streamer
  - Session

A persistência ainda é baseada em arquivos JSON compartilhados com o Worker e não em banco relacional ou fila externa.

## Responsabilidades

A API atualmente é responsável por:

- expor endpoints REST;
- validar inputs por meio de DTOs;
- organizar a cadeia Controller → Service → Repository;
- converter formatos JSON por meio dos adapters de compatibilidade;
- manter compatibilidade com endpoints legacy;
- consultar Creators;
- consultar e criar/eliminar WatchTargets;
- consultar Streams;
- consultar Recordings;
- fornecer a camada de leitura e mapeamento do estado atual do Worker;
- proteger operações em-processo do Node com `async-mutex`.

Importante: `async-mutex` protege apenas operações concorrentes dentro do processo Node. Ele não sincroniza o processo Python do Worker.

## Arquitetura interna

A cadeia atual é:

Controller
→ Service
→ Repository
→ JSON compatibility adapters
→ JSON files

Arquivos centrais da API:

- `src/streams/domain.model.ts` — modelagem mínima do domínio atual; define Creator, WatchTarget, Stream e Recording.
- `src/streams/streams.controller.ts` — endpoints HTTP da API.
- `src/streams/streams.service.ts` — orquestração entre controller e repository.
- `src/streams/streams.repository.ts` — acesso ao JSON e lógica de leitura/consulta/remoção.
- `src/streams/json-compatibility.adapters.ts` — tradução entre domain model e formatos legados do JSON.
- `src/streams/dto/` — DTOs para validação de entrada e compatibilidade.
- `src/streams/test/` — testes de controller/repository e compatibilidade.

A API não implementa filesystem direto nos controllers. O acesso físico aos arquivos JSON é isolado nos adapters/repository.

## Modelo de domínio

O modelo atual separa explicitamente as entidades:

### Creator

Representa a identidade agrupadora do conteúdo monitorado.

- `id`
- `display_name`

Nessa fase, o Creator ainda funciona como identidade combinada com uma convenção simples baseada em `display_name`.

### WatchTarget

Representa a configuração persistente de monitoramento.

- `id`
- `creator_id`
- `channel_name`
- `platform`
- `url`
- `quality`
- `enabled`
- `state`

Decisão importante: o WatchTarget representa o “como” a criação será monitorada; não é uma ocorrência de live.

### Stream

Representa uma ocorrência específica de broadcast detectada.

- `id`
- `watch_target_id`
- `state`
- `started_at`
- `finished_at?`

Decisão importante: Stream é uma ocorrência real de live, e não a configuração persistente do monitoramento.

### Recording

Representa uma tentativa de captura.

- `session_id`
- `watch_target_id`
- `stream_id?`
- `started_at`
- `finished_at?`
- `output_file?`
- `state`

Decisão importante:

- uma Stream pode ter múltiplas tentativas de Recording;
- `watch_target_id` pertence ao novo domínio;
- `channel_id` permanece apenas em boundaries legacy quando necessário;
- o novo domínio não deve vazar `channel_id` em respostas de `/recordings` ou `/streams`.

## API de domínio atual

### Creator

- `GET /creators`
- `GET /creators/:id`
- `GET /creators/:id/watch-targets`

Propósito:

- listar e consultar identities agrupadas;
- retornar os WatchTargets vinculados a um Creator.

### WatchTarget

- `GET /watch-targets`
- `GET /watch-targets/:id`
- `POST /watch-targets`
- `PATCH /watch-targets/:id` (atualiza `recording_subdir`; string vazia o limpa)
- `DELETE /watch-targets/:id`

Propósito:

- consultar configuração de monitoramento;
- criar configuração persistente para um Creator;
- remover uma única WatchTarget sem corromper as irmãs do mesmo Creator.

### Stream

- `GET /streams`
- `GET /streams/:id`

Propósito:

- consultar ocorrências reais de stream detectadas;
- distinguir Stream de WatchTarget e Recording.

### Recording

- `GET /recordings`
- `GET /recordings/:id`
- `GET /recordings?watchTargetId=<id>`

Propósito:

- consultar registros de captura;
- filtrar por `watchTargetId` na camada de domínio;
- manter a API de domínio separada da compatibilidade legacy.

## API legacy

Essas rotas ainda existem por compatibilidade com o estado atual do MVP e devem ser tratadas como compatibilidade, não como modelo futuro.

- `GET /streamer`
- `GET /streamer/:id`
- `POST /streamer`
- `DELETE /streamer/:id`

- `GET /session`
- `GET /session/:id`
- `GET /session/channel/:id`

Essas rotas permanecem funcionalmente válidas, mas não devem ser usadas como base para o novo frontend ou como fonte de verdade para o domínio atual.

## Persistência JSON

A camada atual ainda usa JSON compartilhado entre API e Worker.

Boundaries atuais:

```text
watchlist.json       ↔ WatchTarget
channels_status.json ↔ runtime status snapshot
streams.json         ↔ Stream
sessions.json        ↔ Recording legacy persistence
```

A tradução entre domínio e formato físico é feita pelos adapters:

- `WatchTargetJsonAdapter`
- `RuntimeStatusJsonAdapter`
- `StreamJsonAdapter`
- `RecordingJsonAdapter`

Esses adapters fazem a camada de compatibilidade necessária para que a API e o Worker compartilhem o mesmo mecanismo persistente sem misturar domínio e formato físico.

## Concorrência e atomicidade

O que existe atualmente:

- `async-mutex` protege apenas operações concorrentes dentro do processo Node;
- não existe lock distribuído;
- o Worker Python é um processo separado e não participa dessa sincronização;
- os writes relevantes usam escrita temporária seguida de replace atômico;
- JSON inválido não é mascarado silenciosamente;
- retries são limitados e explícitos em leitura de JSON.

Observação importante: esta camada é compatível com o MVP atual, mas não substitui uma solução de coordenação multi-processo mais robusta em fases futuras.

As evidências do smoke da Wave 04.7 cobrem dois ciclos suportados de `POST`/`GET`/`DELETE` entre API e Worker contra o mesmo volume nomeado isolado em `/data`. A compatibilidade com replace atômico foi validada, mas isso não é garantia de transação ou lock distribuído.

## Execução local

Os scripts reais disponíveis em `api/package.json` são:

```bash
pnpm install
pnpm start:dev
pnpm build
pnpm test
pnpm exec jest --runInBand
pnpm exec tsc --noEmit
```

Comando de execução em desenvolvimento:

```bash
cd api
pnpm install
pnpm start:dev
```

Importante: o script `lint` atual usa `eslint ... --fix`.

```json
"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"
```

Esse script não deve ser tratado como validação read-only; ele altera arquivos automaticamente. A documentação atual segue o código real e não recomenda lint como gate para revisão sem correção explícita.

## Testes

A API possui testes reais em `src/streams/test/stream.controller.spec.ts`.

Os testes cobrem:

- endpoints Domain API;
- endpoints legacy;
- agrupamento de múltiplos WatchTargets por Creator;
- remoção isolada de WatchTarget;
- identidade de Stream;
- filtro de Recordings por `watchTargetId`;
- mapeamento de compatibilidade `channel_id` ↔ `watch_target_id`;
- atomic write e leitura de JSON;
- ausência de `channel_id` em payloads do domínio.

A suíte atual tem 68 testes. Execute `pnpm test` e `pnpm exec tsc --noEmit`; o `pnpm test:smoke` na raiz acrescenta a evidência isolada de escrita cruzada entre API e Worker.

Não há testes de frontend, auth, upload cloud, Redis, PostgreSQL, fila externa ou SSE nesta camada.

## Limitações conhecidas

Limitações conhecidas e verificadas no código atual:

- persistência ainda depende de JSON local;
- `Creator.id` é derivado de `display_name` e ainda não é uma identidade persistente independente;
- `Recording.stream_id` não é persistido no legacy `sessions.json`;
- `WatchTarget.enabled` é aplicado pelo Worker; a API expõe o valor persistido, mas não possui rota geral de atualização além de `recording_subdir`;
- não há autenticação;
- não há PostgreSQL;
- não há Redis/queue externa;
- não há cloud storage providers implementados;
- não há WebSocket/SSE;
- não há frontend ainda.

Esses pontos são limitações conhecidas do estado atual e não devem ser confundidas com bugs do código funcional vigente.

## Fora da responsabilidade da API

A API atual não é responsável por:

- capturar vídeo;
- executar FFmpeg;
- executar Streamlink;
- gerenciar o processo de gravação em execução;
- fazer upload para Google Drive/Dropbox/OneDrive;
- implementar retenção automática;
- expor frontend ou UI;
- tomar decisões de armazenamento final.

A API é a camada de domínio, orquestração e exposição, não a camada de execução multistep do media workflow.

## Relacionamento com o Worker

```text
User / future frontend
        ↓
       API
        ↓
   watchlist.json
        ↓
      Worker
        ↓
channels_status.json
streams.json
sessions.json
        ↓
       API
```

Essa integração entre API e Worker é uma arquitetura transitória do MVP baseada em JSON compartilhado. O objetivo é manter a separação entre domínio e execução até que uma persistência mais estruturada seja introduzida em uma fase posterior.

## Resumo executivo

A API atual é uma camada de observação, domínio e compatibilidade em torno do MVP de monitoramento e gravação. Ela expõe o modelo atual de Creator/WatchTarget/Stream/Recording, preserva compatibility com o conjunto legacy e serve como integração entre o código de domínio e a gestão de arquivos JSON do Worker.
