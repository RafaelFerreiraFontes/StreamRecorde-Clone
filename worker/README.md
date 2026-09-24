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
- [Operations Runbook](#operations-runbook)
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
- [Runbook operacional](#runbook-operacional)
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
- enforcing `enabled`: disabled or invalid entries perform no probe or capture, while active captures and pending terminal persistence remain independent;
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

`ProbeResult` classifies Streamlink responses as `LIVE`, `OFFLINE`, or `ERROR`. LIVE creates or reuses an open Stream; OFFLINE finalizes it; ERROR records bounded, safe diagnostics without treating an uncertain probe as an end. Terminal recording persistence is retried while pending. Shutdown sets a cooperative event, then the normal flow terminates and reaps active children and persists their error terminal state.

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

## Configuration File Paths

The Worker resolves file paths using explicit precedence:

```
NON-EMPTY individual env var > NON-EMPTY CONFIG_DIR + filename > module-relative default
```

Individual environment variables:

- `WATCHLIST_PATH` - watchlist.json path
- `CHANNELS_STATUS_PATH` - channels_status.json path
- `SESSIONS_PATH` - sessions.json path
- `STREAMS_PATH` - streams.json path
- `OUTPUT_DIR` - recording output directory (default: `/recordings`)

If an individual path is set and non-empty, it is used directly.

Otherwise, if `CONFIG_DIR` is set and non-empty, the filename is appended to it.

Otherwise, the module-relative default is used (relative to `worker/config/`).

Important: an empty string is NOT a valid override. An empty `WATCHLIST_PATH` will fall through to `CONFIG_DIR` or the module-relative default.

### Output Directory Structure

The Worker writes recordings to `OUTPUT_DIR`, which is the root for all recording subdirectories.

The `recording_subdir` field from watchlist entries is appended as a relative subdirectory:

```
OUTPUT_DIR/recording_subdir/recording.mp4
```

If `recording_subdir` is absent or invalid, the Worker falls back to a sanitized channel name:

```
OUTPUT_DIR/channel_name/recording.mp4
```

### recording_subdir Validation

The `recording_subdir` field must be a relative path. Security rules:

- Rejects absolute paths (leading `/` or `\`)
- Rejects Windows drive letters (`C:\...`)
- Rejects UNC paths (`\\server\share`)
- Rejects traversal patterns (`.`, `..`)
- Rejects null bytes and control characters
- Max 255 characters
- Normalized to forward slashes

Invalid `recording_subdir` values trigger a ValueError in the Worker. The Worker does not silently fall back for invalid custom paths.

### Cross-Process Considerations

The API and Worker share JSON files through the filesystem. This creates a cross-process coordination scenario:

- No distributed locking mechanism exists
- File changes from one process are not immediately visible to the other
- API updates to `watchlist.json` require the Worker to reload the file
- Worker status updates require the API to read fresh data

For MVP, the architecture relies on eventual consistency through periodic polling and file reloads. A queue or database will replace this in later phases.

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
python -m unittest test_worker
python -m pytest test_worker.py -q
```

External dependencies referenced by the current code and runtime:

- Python;
- Streamlink;
- FFmpeg.

These dependencies are used as part of the local monitoring and recording flow and are not used as a database, queue, or cloud-upload mechanism.

## Operations Runbook

### Runtime and health boundaries

The supported container runtime is Python 3.12 with FFmpeg and the exact `streamlink==8.6.1` pin. Check the installed version with `docker compose exec worker streamlink --version`. `docker compose restart worker` restarts the current container only; after a source, Dockerfile, or dependency change, run `docker compose up -d --build worker` to rebuild the image and recreate the Worker.

A running Worker container proves process liveness only. API and frontend `healthy` states prove their HTTP healthchecks only. A successful probe proves Streamlink classified a target, and successful capture requires an actual output followed by inspection. None of these signals proves the others.

Probe classification is exact:

- `LIVE`: a successful response with a nonempty `streams` mapping.
- `OFFLINE`: a successful response with an empty `streams` mapping, or exit `1` with the sole error envelope `No playable streams found on this URL: <invoked URL>`.
- `ERROR`: every other uncertain or failed condition, including timeout, malformed JSON, unexpected error envelope, and nonzero exit.

`ERROR` does not finalize a `Stream` or overwrite its current status, so the retained status can be stale. Use sanitized probe diagnostics and future polls rather than treating `ERROR` as offline.

### Logs and first response

Startup records the Streamlink version, poll interval, effective configuration paths, and output directory. Operational records cover checking, probe result, live detection, recording start/finish, persistence, refresh blocking, and shutdown. They use bounded identifiers, return codes, exception types, timeout values, and sanitized diagnostics. URLs, credentials, tokens, raw JSON, and raw debug output must not be logged or published.

Investigate in this order:

1. Confirm `enabled` and effective mounts/paths.
2. Compare `streamlink --version` with the `8.6.1` pin.
3. Inspect the sanitized probe result.
4. Check UID/GID and read/write access to runtime data and output.
5. Inspect JSON state, Recording lifecycle, and output progression.

This separates actual offline status from platform/network outage, dependency failure, configuration failure, and persistence failure.

### Permissions and bind mounts

The API and Worker run as numeric identity `1000:1000`. Root Compose binds `${RUNTIME_DATA_DIR:-./runtime-data}` to `/data` for API and Worker, and `${RECORDINGS_DIR:-./recordings}` to `/recordings` for Worker. A bind mount hides ownership established in the image, so Dockerfile `chown` and directory existence do not establish host access.

The Worker needs directory traversal plus read, write, create, rename, and remove access. Atomic JSON replacement creates a sibling temporary file then replaces the destination, so the parent directory must permit both operations. Every per-file override (`WATCHLIST_PATH`, `CHANNELS_STATUS_PATH`, `STREAMS_PATH`, `SESSIONS_PATH`) also requires access to its parent directory.

Use bounded container checks:

```sh
docker compose exec worker id
docker compose exec api id
docker compose exec api sh -c 'ls -ld /data && ls -la /data'
docker compose exec worker sh -c 'ls -ld /data /recordings && ls -la /data'
docker compose exec worker sh -c 'ls -la /recordings'
```

On Linux, grant the host directories to UID/GID `1000:1000` or an appropriate shared group/ACL that permits the operations above. On Windows, Docker Desktop sharing, WSL2 filesystem placement, and Windows ACLs can alter effective Linux permissions; verify access from inside the containers. Do not run services as root and do not use `chmod 777`.

### Enabled and reload semantics

An omitted `enabled` value is legacy `true`; `true` permits probes and launches; `false` skips new probes, retries, and captures; a non-boolean value warns and skips. The Worker reloads configuration every poll and reads it again after `LIVE` before launch. Removal, disablement, invalid/missing required fields, or a URL change blocks that launch. Active captures and terminal persistence continue independently. Disabling, removal, or invalid configuration leaves an unresolved broadcast gap: an open `Stream` is retained because no probe can prove it ended. There is no general API enabled-toggle route.

### JSON and domain boundaries

`channels_status.json` is operational state, `streams.json` is Stream history, and `sessions.json` is legacy Recording persistence. `Creator` identifies who is monitored; `WatchTarget` defines how; `Stream` is a live session; `Recording` is its job/result. `stream_id` exists in memory but is not persisted in legacy `sessions.json`. This MVP has no database, queue, Redis, cloud upload, distributed lock, or multi-worker transaction.

### Validation and optional live exercise

Recorded deterministic evidence: `161` unittest passed, `161` pytest passed, `py_compile` passed, API `68` tests passed, API typecheck passed, and Docker smoke passed `20/20`; no deterministic failures were reported. The smoke uses a unique isolated Compose project, three uniquely labeled Linux named mutable volumes, and one read-only fixture bind copied into `/tmp`; it exposes no host ports. Cleanup is restricted to exact resources carrying matching ownership labels. Its fake Streamlink proves neither platform/network availability nor a playable MP4.

Optional real-platform exercise: **NOT RUN / pending**. Use only an authorized URL; collect the installed version, probe classification, sanitized logs, domain progression, and output metadata. Inspect any temporary output with `ffprobe`; an `.mp4` suffix alone does not prove MP4 format or playability. Keep URLs, samples, and raw diagnostics private, remove temporary output, and do not publish them.

Incident outcome: the runtime was upgraded and deterministic paths pass; the original real-platform recovery remains unverified.

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

The current deterministic suite has 161 tests. The repository-level `pnpm test:smoke` runs Docker smoke Gates A-D for classification, lifecycle, persistence denial/recovery, API/Worker cross-writer cycles, active-child SIGTERM/reaping, and secret-safe logs. It uses deterministic fake Streamlink and does not validate a real platform, network, or playable MP4.

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

The current Python Worker is the operational layer of the MVP. It observes enabled WatchTargets, classifies probes safely, creates/reuses `Stream`, creates `Recording`, cooperatively shuts down and reaps media children, persists state, and maintains compatibility with legacy JSON formats. The model is functional and local, but remains subject to the MVP limitations: JSON persistence, no queue, no database, and no final cloud integration.

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
- aplicar `enabled`: entradas desabilitadas ou inválidas não executam probe nem captura, enquanto capturas ativas e persistência terminal pendente permanecem independentes;
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

`ProbeResult` classifica respostas do Streamlink como `LIVE`, `OFFLINE` ou `ERROR`. LIVE cria ou reutiliza uma Stream aberta; OFFLINE a finaliza; ERROR registra diagnósticos seguros e limitados sem tratar um probe incerto como fim. A persistência terminal de Recording é repetida enquanto pendente. O shutdown define um evento cooperativo e o fluxo normal termina e coleta os processos filhos ativos, persistindo o estado terminal de erro.

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
python -m unittest test_worker
python -m pytest test_worker.py -q
```

Dependências externas mencionadas pelo código e runtime atual:

- Python;
- Streamlink;
- FFmpeg.

Essas dependências são usadas como parte do fluxo local de monitoramento e gravação, e não como mecanismo de banco, fila ou upload cloud.

## Runbook operacional

### Runtime e limites de saúde

O runtime suportado no container é Python 3.12 com FFmpeg e o pin exato `streamlink==8.6.1`. Verifique a versão instalada com `docker compose exec worker streamlink --version`. `docker compose restart worker` apenas reinicia o container atual; após mudança em código-fonte, Dockerfile ou dependência, execute `docker compose up -d --build worker` para reconstruir a imagem e recriar o Worker.

Um container Worker em execução prova apenas que o processo está vivo. Estados `healthy` da API e do frontend provam apenas seus healthchecks HTTP. Um probe bem-sucedido prova que o Streamlink classificou um alvo, e uma captura bem-sucedida exige saída real seguida de inspeção. Nenhum desses sinais prova os demais.

A classificação do probe é exata:

- `LIVE`: resposta bem-sucedida com mapeamento `streams` não vazio.
- `OFFLINE`: resposta bem-sucedida com mapeamento `streams` vazio, ou saída `1` com o único envelope de erro `No playable streams found on this URL: <invoked URL>`.
- `ERROR`: toda outra condição incerta ou com falha, incluindo timeout, JSON malformado, envelope de erro inesperado e saída não zero.

`ERROR` não finaliza uma `Stream` nem sobrescreve seu status atual; portanto, o status retido pode estar desatualizado. Use diagnósticos sanitizados do probe e polls futuros, sem tratar `ERROR` como offline.

### Logs e primeira resposta

O startup registra versão do Streamlink, intervalo de poll, caminhos efetivos de configuração e diretório de saída. Os registros operacionais cobrem checking, resultado do probe, detecção live, início/fim da gravação, persistência, bloqueio por refresh e shutdown. Eles usam identificadores limitados, códigos de retorno, tipos de exceção, valores de timeout e diagnósticos sanitizados. URLs, credenciais, tokens, JSON bruto e saída debug bruta não devem ser registrados nem publicados.

Investigue nesta ordem:

1. Confirme `enabled` e mounts/caminhos efetivos.
2. Compare `streamlink --version` com o pin `8.6.1`.
3. Inspecione o resultado sanitizado do probe.
4. Verifique UID/GID e acesso de leitura/escrita a dados de runtime e saída.
5. Inspecione estado JSON, lifecycle de Recording e progressão da saída.

Isso separa offline real de indisponibilidade de plataforma/rede, falha de dependência, falha de configuração e falha de persistência.

### Permissões e bind mounts

API e Worker executam com a identidade numérica `1000:1000`. O Compose raiz monta `${RUNTIME_DATA_DIR:-./runtime-data}` em `/data` para API e Worker, e `${RECORDINGS_DIR:-./recordings}` em `/recordings` para o Worker. Um bind mount oculta a posse definida na imagem; portanto, `chown` no Dockerfile e a existência do diretório não estabelecem acesso no host.

O Worker precisa de travessia de diretório e acesso para ler, escrever, criar, renomear e remover. A substituição atômica de JSON cria arquivo temporário irmão e então substitui o destino; assim, o diretório pai deve permitir ambas as operações. Cada override por arquivo (`WATCHLIST_PATH`, `CHANNELS_STATUS_PATH`, `STREAMS_PATH`, `SESSIONS_PATH`) também exige acesso ao seu diretório pai.

Use verificações limitadas no container:

```sh
docker compose exec worker id
docker compose exec api id
docker compose exec api sh -c 'ls -ld /data && ls -la /data'
docker compose exec worker sh -c 'ls -ld /data /recordings && ls -la /data'
docker compose exec worker sh -c 'ls -la /recordings'
```

No Linux, conceda os diretórios do host ao UID/GID `1000:1000` ou a grupo/ACL compartilhado apropriado que permita as operações acima. No Windows, compartilhamento do Docker Desktop, local do sistema de arquivos WSL2 e ACLs do Windows podem alterar permissões Linux efetivas; verifique o acesso de dentro dos containers. Não execute serviços como root e não use `chmod 777`.

### Semântica de enabled e reload

Um valor `enabled` omitido é o legado `true`; `true` permite probes e inicializações; `false` pula novos probes, retries e capturas; valor não booleano gera aviso e pula. O Worker recarrega a configuração a cada poll e a lê novamente após `LIVE` antes da inicialização. Remoção, desabilitação, campos obrigatórios inválidos/ausentes ou mudança de URL bloqueiam essa inicialização. Capturas ativas e persistência terminal continuam independentes. Desabilitar, remover ou invalidar a configuração deixa uma lacuna de broadcast não resolvida: uma `Stream` aberta é mantida porque nenhum probe pode provar que terminou. Não existe rota geral da API para toggle de enabled.

### Limites JSON e de domínio

`channels_status.json` é estado operacional, `streams.json` é histórico de Stream e `sessions.json` é persistência legacy de Recording. `Creator` identifica quem é monitorado; `WatchTarget` define como; `Stream` é uma sessão live; `Recording` é seu job/resultado. `stream_id` existe em memória, mas não é persistido no `sessions.json` legacy. Este MVP não possui banco, fila, Redis, upload cloud, lock distribuído nem transação multi-worker.

### Validação e exercício live opcional

Evidência determinística registrada: `161` unittest passou, `161` pytest passou, `py_compile` passou, `68` testes da API passaram, typecheck da API passou e o smoke Docker passou `20/20`; nenhuma falha determinística foi reportada. O smoke usa um projeto Compose único e isolado, três volumes mutáveis nomeados do Linux com rótulos únicos e um bind de fixture somente leitura copiado para `/tmp`; ele não expõe portas do host. A limpeza é restrita aos recursos exatos que carregam rótulos de propriedade correspondentes. Seu Streamlink falso não prova disponibilidade de plataforma/rede nem MP4 reproduzível.

Exercício opcional em plataforma real: **NOT RUN / pendente**. Use somente URL autorizada; colete versão instalada, classificação do probe, logs sanitizados, progressão do domínio e metadados de saída. Inspecione qualquer saída temporária com `ffprobe`; o sufixo `.mp4` sozinho não prova formato MP4 nem reprodução. Mantenha URLs, amostras e diagnósticos brutos privados, remova a saída temporária e não os publique.

Resultado do incidente: o runtime foi atualizado e os caminhos determinísticos passam; a recuperação original em plataforma real continua não verificada.

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

A suíte determinística atual tem 161 testes. O `pnpm test:smoke` na raiz executa os Gates A-D do smoke Docker para classificação, lifecycle, negação/recuperação de persistência, ciclos de escrita cruzada API/Worker, SIGTERM/coleta de filhos ativos e logs sem segredos. Ele usa Streamlink falso determinístico e não valida plataforma, rede ou MP4 reproduzível reais.

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

O Worker Python atual é a camada operacional do MVP. Ele observa WatchTargets habilitados, classifica probes com segurança, cria/reutiliza `Stream`, cria `Recording`, executa shutdown cooperativo e coleta processos filhos de mídia, persiste estados e mantém compatibilidade com formatos JSON legados. O modelo é funcional e local, mas ainda sujeito às limitações do MVP: persistência JSON, sem fila, sem banco e sem cloud final.
