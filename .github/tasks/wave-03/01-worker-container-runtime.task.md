---
name: Wave 03.1 Worker Container Runtime
wave: 03
order: 01
depends_on: []
status: done
---

# 03.1 — Worker Container Runtime

## Context

O Worker Python continua responsável pelo polling, Streamlink/FFmpeg e persistência JSON do MVP. Esta task corrige apenas seu runtime em container.

## Objective

Produzir uma imagem reproduzível do Worker e garantir logs, gravações e encerramento corretos, sem perder a execução local.

## Scope

`worker/Dockerfile`, dependências Python e ajustes mínimos de subprocessos, logs e sinais em `worker/worker.py`. A decisão sobre caminhos JSON comuns pertence à task 04.

## Out of Scope

Alterar polling, domínio ou adapters; adicionar fila, banco, cloud, múltiplos workers ou o Compose raiz.

## Current State

`worker/Dockerfile` usa `python:3.12-slim`, instala FFmpeg/certificados e Streamlink sem versão fixa, copia apenas `worker.py` e define o obsoleto `STATUS_PATH`. O código também importa `json_adapters.py`, usa `WATCHLIST_PATH`, `CHANNELS_STATUS_PATH`, `SESSIONS_PATH`, `STREAMS_PATH`, `OUTPUT_DIR` e `POLL_INTERVAL`. O comando atual é `python -u worker.py`. Há handler para SIGTERM/SIGINT, mas ele termina subprocessos sem aguardar sua saída. A gravação abre `stderr=subprocess.PIPE` sem drenagem contínua.

## Required Changes

- Incluir todos os módulos necessários na imagem e criar `worker/requirements.txt` com versão de Streamlink fixada; instalar com mecanismo reproduzível e verificar compatibilidade com Python/base escolhidos.
- Garantir `ffmpeg` e `ca-certificates`; manter saída de logs em stdout/stderr do container, incluindo erros úteis do Streamlink sem bloquear por pipe cheio.
- Ajustar o ciclo de vida dos subprocessos para que SIGTERM pare e aguarde as gravações com limite de tempo e fallback controlado, preservando persistência de estado e saída do Worker.
- Manter variáveis individuais e execução `python worker.py` fora do Docker. Coordenar a introdução de `CONFIG_DIR` com a task 04; não duplicar a lógica de resolução de caminhos aqui.
- Considerar `.dockerignore` do Worker para excluir cache, testes e dados locais do contexto, sem excluir módulos necessários.

## Acceptance Criteria

- [ ] A imagem constrói e inicia sem erro de importação.
- [ ] Streamlink e FFmpeg estão disponíveis no container com versões identificáveis.
- [ ] Não há `STATUS_PATH` obsoleto na configuração da imagem.
- [ ] Logs e falhas de gravação são visíveis em `docker logs`, sem deadlock no stderr.
- [ ] SIGTERM encerra Worker e subprocessos iniciados por ele sem órfãos.
- [ ] Testes e execução local existentes continuam válidos.

## Verification

Construir a imagem; executar checks de import, `streamlink --version` e `ffmpeg -version`; rodar `python -m pytest worker/test_worker.py`; testar SIGTERM com subprocesso controlado e observar logs/estado. Não exigir live real.

## Risks / Notes

`terminate()` sem `wait()` pode deixar processo ativo; `PIPE` sem leitura pode bloquear. Evitar log verboso de URLs ou credenciais. A implementação final dos defaults em `/data` fica na task 04.

## Files likely affected

`worker/Dockerfile`, `worker/requirements.txt`, `worker/.dockerignore`, `worker/worker.py`, `worker/test_worker.py`.
