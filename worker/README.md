# Worker — StreamRecorder Clone

## Language / Idioma

- [English](#english)
- [Português (Brasil)](#português-brasil)

## Table of Contents / Índice

### English

- [Overview](#overview)
- [Responsibilities](#responsibilities)
- [Current Lifecycle](#current-lifecycle)
- [Current Structure](#current-structure)
- [JSON Contracts](#json-contracts)
- [Adapters](#adapters)
- [Safe Persistence](#safe-persistence)
- [Restart and Reload Behavior](#restart-and-reload-behavior)
- [Running Locally](#running-locally)
- [External Dependencies](#external-dependencies)
- [Tests](#tests)
- [Known Limitations](#known-limitations)
- [Outside Worker Responsibilities](#outside-worker-responsibilities)
- [Relationship with the API](#relationship-with-the-api)

### Português (Brasil)

- [Visão geral](#visão-geral)
- [Responsabilidades](#responsabilidades)
- [Lifecycle atual](#lifecycle-atual)
- [Estrutura do Worker](#estrutura-do-worker)
- [Contratos JSON](#contratos-json)
- [Adapters](#adapters)
- [Persistência segura](#persistência-segura)
- [Comportamento de restart e reload](#comportamento-de-restart-e-reload)
- [Execução local](#execução-local)
- [Dependências externas](#dependências-externas)
- [Testes](#testes)
- [Limitações atuais](#limitações-atuais)
- [Fora da responsabilidade do Worker](#fora-da-responsabilidade-do-worker)
- [Relacionamento com a API](#relacionamento-com-a-api)

---

# English

## Overview

The Python Worker is the operational component of the MVP. It handles the execution side of the monitoring and recording pipeline by reading the WatchTarget configuration, detecting online streams, and managing the lifecycle of `Stream` and `Recording` objects.

Its main responsibility is not to expose the API or decide user-facing business rules. Its function is to consume JSON-persisted configuration, observe the current environment, and execute the operational monitoring/recording loop.

The current Worker is a local polling-based worker using Streamlink, without an external queue, without Redis, and without a structured database.

## Responsibilities

The Worker is currently responsible for:

- loading `watchlist.json`;
- checking monitored WatchTargets;
- detecting online streams;
- keeping `active_recordings` in memory;
- creating a `Stream` for a new broadcast;
- reusing the same `Stream` across repeated polling while the broadcast remains active;
- creating `Recording` attempts;
- handling recording errors;
- finalizing `Stream` when the stream ends;
- creating a new `Stream` for a later broadcast;
- updating `channels_status.json`;
- writing `streams.json`;
- writing `sessions.json`;
- starting recording processes using Streamlink/FFmpeg;
- monitoring the recording process and updating the final state.

## Current Lifecycle

Operational flow observed in the current code:

```text
offline
  → live detected
  → Stream created
  → Recording created
  → recording
  → finished/error
```

Retry flow during the same transmission:

```text
Recording error
  → live still active
  → new Recording attempt
  → same Stream
```

When the transmission ends:

```text
broadcast ends
  → Stream finished
```

When a later transmission happens:

```text
later broadcast
  → new Stream ID
```

This behavior is the real model implemented by the current worker and not a future assumption.

## Current Structure

Actual Worker files:

- `worker.py` — main logic for polling, detection, lifecycle, recording, and persistence.
- `json_adapters.py` — JSON compatibility adapters.
- `test_worker.py` — current lifecycle and adapter test suite.
- `config/` — local JSON execution files.
  - `watchlist.json`
  - `channels_status.json`
  - `sessions.json`
  - `streams.json`

The Worker also uses a local output directory for recorded files through `OUTPUT_DIR`, which is configurable via environment variables.

## JSON Contracts

The current integration uses four main files:

### watchlist.json

- read by the Worker;
- contains the configuration of monitored WatchTargets;
- represents the persistent monitoring configuration state.

### channels_status.json

- current runtime snapshot;
- represents the operational state of each active WatchTarget;
- it is not the historical record of `Stream`.

### streams.json

- stores Stream occurrences;
- identifies specific broadcasts and their lifecycle.

### sessions.json

- legacy Recording persistence;
- uses the compatibility format with `channel_id`;
- in runtime, the domain uses `watch_target_id`.

Compatibility translation:

```text
sessions.json.channel_id
↔ Recording.watch_target_id
```

Important: `watch_target_id` should not leak into the legacy persisted format in `sessions.json`.

## Adapters

`json_adapters.py` defines the Python adapters that maintain the same conceptual contract as the TypeScript adapters, without sharing code between languages.

Real adapter functions:

- `WatchTargetJsonAdapter`
- `RuntimeStatusJsonAdapter`
- `RecordingJsonAdapter`
- `StreamJsonAdapter`

These adapters bridge:

- in-memory Worker/API domain data;
- JSON stored on disk;
- legacy adjustments required to preserve compatibility.

## Safe Persistence

The current Worker implements some minimal write and consistency protections:

- temporary-file write in the same directory;
- atomic replacement via `os.replace`;
- fallback to empty defaults when the file is missing;
- explicit error for invalid JSON;
- limited retry during JSON reads;
- absence of cross-process locking.

Relevant observations:

- `channels_status.json` is a runtime snapshot, not a `Stream` history;
- `streams.json` is the operational history of stream occurrences;
- `sessions.json` remains legacy for compatibility and does not fully represent the new domain model, especially regarding `stream_id`.

## Restart and Reload Behavior

The Worker currently supports:

- reloading `watchlist.json`;
- preserving active sessions/streams in memory;
- restoring state from persisted files;
- maintaining the status of active watchlist entries and files while the process remains alive.

Verified real limitations:

- `async-mutex` does not exist in Python; there is no distributed lock;
- `Recording.stream_id` is not fully persisted in the legacy `sessions.json` format;
- the Worker model is a local MVP without an external queue and without robust multi-process coordination.

There is no promise of perfect recovery for any multi-process state in production environments or with multiple concurrent workers.

## Running Locally

Commands actually used:

```bash
cd worker
python worker.py
```

Run tests:

```bash
python -m pytest worker/test_worker.py
```

External dependencies referenced by the current code and runtime:

- Python;
- Streamlink;
- FFmpeg.

These dependencies are used as part of the local monitoring and recording flow and are not used as a database, queue, or cloud-upload mechanism.

## Tests

The current `worker/test_worker.py` suite covers real scenarios from the current Worker state:

- first live detection;
- repeated polling while reusing the same Stream;
- later broadcast creating a new Stream;
- retrying Recording during the same transmission;
- finalization of Stream;
- reload/restart preserving active state;
- missing watchlist;
- adapter round-trip;
- atomic write;
- invalid JSON;
- legacy compatibility for `sessions.json`.

These tests are deterministic and local and do not depend on internet access or live channels.

## Known Limitations

Known limitations verified in the current code:

- no external queue;
- no Redis;
- no PostgreSQL;
- no distributed locking;
- `Recording → Stream` is not fully persisted in legacy `sessions.json`;
- no final cloud upload;
- no automatic retention;
- execution is still in a local MVP stage rather than production infrastructure;
- operational processing is polling-based rather than event-driven streaming.

These are limitations of the current state and not bugs in the already validated basic functionality.

## Outside Worker Responsibilities

The Worker should not:

- expose a REST API;
- manage frontend or UI;
- implement authentication;
- decide client business rules;
- act as a database;
- index, publish, or expose videos;
- act as the final cloud-storage backend.

Its role is the operational execution of the recording and monitoring pipeline, not the management of the product as a whole.

## Relationship with the API

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

The current integration is a local MVP architecture based on shared JSON files as a temporary boundary between the API and the Worker. This design supports the current phase of domain, monitoring, and recording work without introducing external infrastructure that is not yet required.

## Executive Summary

The current Python Worker is the operational layer of the MVP. It observes WatchTargets, detects live streams, creates/reuses `Stream`, creates `Recording`, executes Streamlink/FFmpeg, persists state, and maintains compatibility with the legacy JSON formats. The model is functional, local, and compatible with the Wave 02 state, but it remains subject to the limitations of the current MVP: local JSON persistence, no queue, no database, and no final cloud integration.

---

# Português (Brasil)

## Visão geral

O Worker Python é o componente operacional do MVP. Ele realiza o lado de execução do pipeline de monitoramento e gravação, lendo a configuração dos WatchTargets, detectando streams online e gerenciando o ciclo de vida dos objetos `Stream` e `Recording`.

Sua responsabilidade principal não é expor API nem decidir regras de negócio do usuário. Sua função é consumir as configurações persistidas em JSON, observar o estado do ambiente e executar o ciclo operacional de monitoramento/gravação.

Este Worker atual é um worker local baseado em polling e Streamlink, sem fila externa, sem Redis e sem banco de dados estruturado.

## Responsabilidades

O Worker atualmente é responsável por:

- carregar `watchlist.json`;
- verificar WatchTargets monitorados;
- detectar streams online;
- manter `active_recordings` em memória;
- criar um `Stream` para um novo broadcast;
- reutilizar uma mesma `Stream` em repeated polling enquanto o broadcast estiver ativo;
- criar tentativas de `Recording`;
- lidar com erro de Recording;
- finalizar `Stream` quando a transmissão termina;
- criar nova `Stream` para um broadcast posterior;
- atualizar `channels_status.json`;
- escrever `streams.json`;
- escrever `sessions.json`;
- inicializar processos de recording com Streamlink/FFmpeg;
- monitorar processo de gravação e atualizar estado final.

## Lifecycle atual

Fluxo operacional observado no código atual:

```text
offline
  → live detected
  → Stream created
  → Recording created
  → recording
  → finished/error
```

Casos de retry durante a mesma transmissão:

```text
Recording error
  → live still active
  → new Recording attempt
  → same Stream
```

Quando a transmissão termina:

```text
broadcast ends
  → Stream finished
```

Quando uma transmissão posterior acontece:

```text
later broadcast
  → new Stream ID
```

Esse comportamento é o modelo real implementado pelo worker atual e não uma hipótese futura.

## Estrutura do Worker

Arquivos reais do Worker:

- `worker.py` — lógica principal de polling, detecção, lifecycle, gravação e persistência.
- `json_adapters.py` — adapters de compatibilidade para JSON.
- `test_worker.py` — suite atual de testes de lifecycle e adapters.
- `config/` — arquivos JSON de execução local.
  - `watchlist.json`
  - `channels_status.json`
  - `sessions.json`
  - `streams.json`

O Worker também usa diretórios locais de saída para gravações em `OUTPUT_DIR` (configurável via ambiente).

## Contratos JSON

A integração atual usa quatro arquivos principais:

### watchlist.json

- lido pelo Worker;
- contém a configuração dos WatchTargets monitorados;
- representa o “estado persistente” da configuração de monitoramento.

### channels_status.json

- snapshot runtime atual;
- representa estado operacional de cada WatchTarget em execução;
- não é o histórico de `Stream`.

### streams.json

- armazena ocorrências de Stream;
- identifica broadcasts específicos e a vida útil de cada ocorrência.

### sessions.json

- persistence legacy de Recording;
- usa o formato compatível legado com `channel_id`;
- em runtime o domínio trabalha com `watch_target_id`.

Tradução de compatibilidade:

```text
sessions.json.channel_id
↔ Recording.watch_target_id
```

Importante: `watch_target_id` não deve vazar para o formato legacy persistido em `sessions.json`.

## Adapters

`json_adapters.py` define os adapters Python que mantêm o mesmo contrato conceitual dos adapters TypeScript, mas sem código compartilhado entre linguagens.

Funções reais:

- `WatchTargetJsonAdapter`
- `RuntimeStatusJsonAdapter`
- `RecordingJsonAdapter`
- `StreamJsonAdapter`

Esses adapters fazem a ponte entre:

- dados em memória do domínio do Worker/API;
- JSON físico do disco;
- coerções legacy necessárias para manter compatibilidade.

## Persistência segura

O Worker atual implementa algumas proteções mínimas de escrita e consistência:

- escrita em arquivo temporário no mesmo diretório;
- replace atômico via `os.replace`;
- tratamento de arquivo ausente com valor vazio default;
- erro explícito para JSON inválido;
- retry limitado em leitura de JSON;
- ausência de lock cross-process.

Observações relevantes:

- `channels_status.json` é snapshot de runtime, não histórico de Stream;
- `streams.json` é o histórico operacional de ocorrências de stream;
- `sessions.json` permanece legacy para compatibilidade e não representa o domínio novo completo, especialmente em relação a `stream_id`.

## Comportamento de restart e reload

O Worker dá suporte real a:

- reload de `watchlist.json`;
- preservação de sessões/streams ativos em memória;
- recuperação do estado com base em arquivos persistidos;
- manter estado do watchlist e dos arquivos em execução enquanto o processo está vivo.

Limitações reais verificadas:

- `async-mutex` não existe no Python; não há lock distribuído;
- `Recording.stream_id` não é totalmente persistido no formato legado de `sessions.json`;
- o modelo do Worker é um MVP local, sem fila externalizada e sem coordenação multi-processo robusta.

Não há promessa de recuperação perfeita de qualquer estado multi-process em ambientes de produção ou com múltiplos workers concorrentes.

## Execução local

Comandos reais usados:

```bash
cd worker
python worker.py
```

Executar testes:

```bash
python -m pytest worker/test_worker.py
```

Dependências externas mencionadas pelo código e runtime atual:

- Python;
- Streamlink;
- FFmpeg.

Essas dependências são usadas como parte do fluxo local de monitoramento e gravação, e não como mecanismo de banco, fila ou upload cloud.

## Testes

A suite atual `worker/test_worker.py` cobre cenários reais do estado atual do Worker:

- first live detection;
- repeated polling mantendo a mesma Stream;
- later broadcast criando nova Stream;
- retry de Recording durante a mesma transmissão;
- finalização de Stream;
- reload/restart preservando estado ativo;
- watchlist ausente;
- adapter round-trip;
- atomic write;
- invalid JSON;
- compatibilidade legacy de `sessions.json`.

Esses testes são deterministicamente locais e não dependem de internet ou de canais em live.

## Limitações atuais

Limitações conhecidas e verificadas:

- sem queue externa;
- sem Redis;
- sem PostgreSQL;
- sem distributed locking;
- `Recording → Stream` não está totalmente persistido no legacy `sessions.json`;
- sem cloud upload final;
- sem retenção automática;
- execução ainda em MVP local e não em infraestrutura de produção;
- processamento operacional baseado em polling local, não em streaming event-driven.

Esses itens são limitações do estado atual e não bugs de funcionalidade básica já validada.

## Fora da responsabilidade do Worker

O Worker não deve:

- expor REST API;
- gerenciar frontend ou UI;
- implementar autenticação;
- decidir regras de negócio do cliente;
- funcionar como banco de dados;
- indexar, publicar ou expor vídeos;
- atuar como backend de cloud storage final.

Seu papel é o da execução operacional do pipeline de gravação e monitoramento, não a gestão do produto como um todo.

## Relacionamento com a API

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

A integração atual é uma arquitetura de MVP baseada em arquivos JSON compartilhados como boundary temporária entre a API e o Worker. Esse desenho facilita a fase atual de domínio, monitoramento e gravação sem introduzir infraestrutura externa ainda não necessária.

## Resumo executivo

O Worker Python atual é a camada operacional do MVP. Ele observa WatchTargets, detecta live, cria/reutiliza `Stream`, cria `Recording`, executa Streamlink/FFmpeg, persiste estados e mantém a compatibilidade com os formatos legado do JSON. O modelo é funcional, local e completamente compatível com o estado da Wave 02, mas ainda sujeito às limitações do MVP atual: JSON local, sem fila, sem banco e sem cloud final.
