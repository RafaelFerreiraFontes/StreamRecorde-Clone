---
name: Wave 03.8 Docker Integration Smoke Test
wave: 03
order: 08
depends_on:
  - 01-worker-container-runtime.task.md
  - 02-api-container.task.md
  - 03-frontend-container.task.md
  - 04-shared-runtime-data.task.md
  - 05-root-docker-compose.task.md
  - 06-docker-health-and-startup.task.md
  - 07-docker-development-workflow.task.md
status: done
---

# 03.8 — Docker Integration Smoke Test

## Context

As imagens isoladas só concluem a Wave quando o fluxo frontend → proxy Next.js → API NestJS → JSON compartilhado ↔ Worker Python funciona em conjunto.

## Objective

Criar e executar verificação final determinística da stack Docker, separada de teste manual com live real.

## Scope

Smoke test integrado e instruções de teste manual opcional para gravação real; correções mínimas de integração identificadas pelo teste.

## Out of Scope

Exigir streamer online no teste automatizado, teste de carga, cloud upload, mudança de domínio ou infraestrutura futura.

## Current State

Há `frontend/tests/integration.mjs`, testes da API e `worker/test_worker.py`, mas nenhum fluxo Compose completo. A rota de proxy aceita GET de recursos e POST/DELETE de WatchTargets; ela retorna 502 quando API está ausente. O Worker recarrega watchlist no polling, escreve status e inicia Streamlink quando encontra live. O Worker não expõe porta HTTP.

## Required Changes

- Criar smoke test determinístico que suba os três containers em dados isolados e valide: frontend 3001; consulta da API via proxy; leitura de JSON pela API; criação/remoção de WatchTarget via API/proxy; observação da alteração pelo Worker; escrita de status pelo Worker; leitura de status pela API; logs Docker visíveis.
- Não depender da rede externa ou de streamer online: usar fixture/controlador determinístico do probe do Worker ou outra técnica simples e isolada, sem mudar comportamento de produção nem formatos JSON.
- Verificar `docker compose down`/SIGTERM com gravação simulada ou processo controlado para detectar subprocessos órfãos; registrar limites do que foi validado.
- Separar em documento um teste manual opcional com live real, incluindo inspeção do arquivo em `./recordings` e encerramento seguro.
- Preservar dados do desenvolvedor: usar diretório/projeto Compose isolado para o teste e limpar apenas seus próprios recursos.

## Acceptance Criteria

- [ ] Três containers sobem e frontend responde em 3001.
- [ ] Frontend consulta API pelo proxy, sem hostname interno no browser.
- [ ] API lê os JSONs compartilhados e altera WatchTargets; Worker observa a alteração.
- [ ] Worker grava status no mesmo `/data` e API lê o status atualizado.
- [ ] Logs do Worker são acessíveis via `docker compose logs`.
- [ ] Shutdown não deixa subprocessos Streamlink/FFmpeg iniciados pelo teste.
- [ ] Smoke automatizado passa sem live real; roteiro de teste manual está separado.

## Verification

Executar o smoke test em diretório de dados isolado e revisar saídas/exit codes; inspecionar `docker compose ps`, `logs` e paths montados; repetir após rebuild e restart quando necessário para risco concreto. Registrar comandos e resultado para Luna/Coordinator.

## Risks / Notes

O polling padrão é de 60 segundos; usar configuração de teste isolada para tempo viável, sem mudar default de produção. Evitar tocar `worker/config` ou `recordings` reais do desenvolvedor. Arquivos ausentes, permissões e concorrência API/Worker são fontes de falha; não introduzir lock distribuído nesta Wave.

## Files likely affected

Novo script/roteiro de smoke test em `tests/` ou local equivalente, `compose.yml` apenas para ajuste mínimo, documentação da Wave e fixtures isoladas de teste.
