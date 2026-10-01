---
name: Wave 03.2 API Container
wave: 03
order: 02
depends_on: []
status: done
---

# 03.2 — API Container

## Context

A API NestJS já tem `build` (`nest build`) e `start:prod` (`node dist/main`), usa `pnpm` e lê JSONs compartilhados. Precisa de imagem própria para produção local via Compose.

## Objective

Criar imagem multi-stage enxuta da API, com build reproduzível e runtime somente com dependências de produção.

## Scope

Build/runtime da API, contexto Docker, porta e configuração de ambiente da imagem. A definição do volume `/data` é da task 05 e a padronização dos caminhos é da task 04.

## Out of Scope

Mudanças de domínio, endpoints, formato dos JSONs, banco de dados ou orquestração Compose.

## Current State

`api/package.json` define `nest build` e `start:prod`; há `api/pnpm-lock.yaml`. `api/src/main.ts` usa `PORT ?? 3000`. `api/src/streams/streams.repository.ts` já lê `CONFIG_DIR` e overrides individuais, com fallback local relativo a `worker/config`. Não há Dockerfile/.dockerignore da API.

## Required Changes

- Criar `api/Dockerfile` multi-stage com versão de Node/pnpm compatível com o lockfile, instalação congelada, build Nest e runtime apenas com artefatos e dependências de produção.
- Validar o layout real de `dist/main.js` e os módulos requeridos em runtime; não assumir que uma dependência usada no bundle está corretamente classificada.
- Criar `api/.dockerignore` para excluir `node_modules`, `dist`, caches, testes de saída e artefatos locais do contexto.
- Expor/configurar porta 3000 via `PORT` e documentar `CONFIG_DIR=/data` para uso pelo Compose, sem embutir JSONs da máquina na imagem.
- Fazer somente correção mínima de runtime se for indispensável para subir em container.

## Acceptance Criteria

- [ ] Imagem constrói com lockfile e executa `start:prod` sem ferramentas de desenvolvimento no estágio final.
- [ ] API responde na porta definida por `PORT`, inclusive 3000.
- [ ] Com `CONFIG_DIR` apontando para diretório montado, API continua lendo/escrevendo JSONs existentes.
- [ ] Execução local da API permanece funcional e endpoints existentes preservados.

## Verification

`docker build` no contexto da API; iniciar container com diretório temporário montado em `/data`; consultar endpoint existente; executar `pnpm build` e testes relevantes da API. Verificar conteúdo/tamanho da imagem e ausência de `devDependencies` no runtime.

## Risks / Notes

O `package.json` raiz especifica pnpm 11/Node >=25.9, enquanto API possui lockfile próprio; confirmar compatibilidade das versões usadas na imagem. A API usa JSON via filesystem, logo permissões de escrita do usuário de runtime importam.

## Files likely affected

`api/Dockerfile`, `api/.dockerignore`, possivelmente `api/package.json`, `api/src/main.ts` somente se necessário.
