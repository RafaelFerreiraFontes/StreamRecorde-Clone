---
name: Wave 03.4 Shared Runtime Data
wave: 03
order: 04
depends_on: []
status: done
---

# 03.4 — Shared Runtime Data

## Context

API e Worker se comunicam por arquivos JSON, que devem ser exatamente os mesmos quando montados em containers separados.

## Objective

Definir e implementar uma única convenção de caminhos baseada em `CONFIG_DIR`, preservando overrides por arquivo e execução local.

## Scope

Resolução de caminhos, existência/permissões do diretório de dados e comportamento de primeira inicialização. Sem mudanças no conteúdo ou no contrato dos JSONs.

## Out of Scope

Banco, locks distribuídos, mudança de domínio, reescrita de adapters ou Compose raiz.

## Current State

`api/src/streams/streams.repository.ts` já usa `CONFIG_DIR` e overrides `WATCHLIST_PATH`, `CHANNELS_STATUS_PATH`, `SESSIONS_PATH`, `STREAMS_PATH`; sem configuração, usa `../worker/config` a partir do cwd. `worker/worker.py` usa os mesmos overrides individuais, mas defaults fixos em `/app/config` e chama o caminho da watchlist de `CONFIG_PATH`. Os adapters retornam estruturas vazias quando arquivos faltam; escrita atômica exige diretório gravável. `worker/config/` é ignorado pelo Git, logo seu conteúdo local não pode ser pressuposto em um clone limpo.

## Required Changes

- Estabelecer precedência `*_PATH` individual > `CONFIG_DIR` + nome do arquivo > default local compatível com cada componente.
- Resolver em container os quatro arquivos como `/data/watchlist.json`, `/data/channels_status.json`, `/data/streams.json` e `/data/sessions.json` com `CONFIG_DIR=/data`.
- Evitar dependência frágil de cwd entre `api/` e `worker/` no modo Docker, preservando comandos locais atuais.
- Definir explicitamente quem cria o diretório/arquivos iniciais, quais formatos vazios são válidos e o comportamento quando eles ainda faltam; não sobrescrever JSONs existentes.
- Garantir leitura/escrita por API e Worker com permissões compatíveis no mesmo diretório montado; adicionar apenas testes de caminho/primeira inicialização que capturem esse contrato.

## Acceptance Criteria

- [ ] API e Worker resolvem os mesmos quatro paths com `CONFIG_DIR=/data`.
- [ ] Overrides individuais têm precedência e defaults locais continuam funcionando.
- [ ] Clone limpo pode iniciar com diretório de dados vazio sem perder estado ou gerar JSON inválido.
- [ ] Os schemas e adapters de compatibilidade permanecem iguais.
- [ ] Escritas de ambos os processos são visíveis ao outro no diretório compartilhado.

## Verification

Testar matriz de variáveis com diretório temporário; executar testes existentes de API/Worker; validar criação/leitura dos quatro JSONs em diretório inicialmente vazio e preservação de dados preexistentes. Confirmar que API e Worker recebem o mesmo path real ao montar `/data`.

## Risks / Notes

Há mutex apenas dentro do processo Node; não existe lock entre API e Worker. Manter essa limitação explícita e não ampliar escopo para coordenação distribuída. Permissões de bind mount em Windows/Linux e diretório ausente podem impedir escrita.

## Files likely affected

`worker/worker.py`, `api/src/streams/streams.repository.ts`, testes de configuração da API e `worker/test_worker.py`; documentação de caminhos quando pertinente.
