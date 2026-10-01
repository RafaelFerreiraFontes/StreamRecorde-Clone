---
name: Wave 03.3 Frontend Container
wave: 03
order: 03
depends_on: []
status: done
---

# 03.3 — Frontend Container

## Context

O frontend Next.js 16 atende na porta 3001 e usa uma rota servidor `/api/backend/*` como proxy para a API. O navegador deve continuar falando apenas com o frontend.

## Objective

Criar imagem multi-stage de produção do frontend, preservando o proxy e a porta 3001.

## Scope

Build, runtime, `.dockerignore` e configuração Next estritamente ligada à imagem.

## Out of Scope

Design/UI, contratos de API, proxy reverso, autenticação ou Compose raiz.

## Current State

`frontend/package.json` usa `pnpm`, `next build` e `next start -p 3001`, com Next `^16.2.0`; existe `frontend/pnpm-lock.yaml`. `frontend/next.config.ts` ainda não define `output: "standalone"`. A rota `frontend/app/api/backend/[...path]/route.ts` lê `API_BASE_URL` no servidor e usa `http://localhost:3000` por padrão. Não há Dockerfile/.dockerignore do frontend.

## Required Changes

- Criar imagem multi-stage com instalação congelada e build de produção.
- Avaliar e preferir `output: "standalone"` se compatível com Next atual; copiar no runtime o servidor standalone, arquivos estáticos e `public` se existir. Se houver incompatibilidade concreta, usar `next start` com dependências necessárias e registrar o motivo.
- Garantir bind em interface acessível pelo Compose, porta 3001 e `API_BASE_URL=http://api:3000` configurável em runtime, sem inserir endereço interno da API no bundle/browser.
- Criar `.dockerignore` que exclua `node_modules`, `.next`, resultados de testes e caches.
- Preservar métodos/rotas atuais do proxy e a execução local.

## Acceptance Criteria

- [ ] Imagem constrói e frontend responde na porta 3001.
- [ ] Proxy `/api/backend/*` funciona com `API_BASE_URL=http://api:3000` configurado no container.
- [ ] Browser não precisa acessar `api:3000` nem conhecer esse hostname.
- [ ] Build não contém artefatos locais; UI e testes existentes permanecem válidos.

## Verification

`docker build` e inicialização da imagem com API acessível; consultar página e uma rota GET do proxy; inspecionar requisições do navegador para confirmar uso do frontend; executar `pnpm build`, `pnpm typecheck` e teste de cliente pertinente.

## Risks / Notes

Next standalone exige copiar `.next/static` separadamente. Confirmar que `API_BASE_URL` é resolvido no servidor em tempo de execução, como hoje na route handler. Evitar fixar `localhost` na imagem, pois no container apontaria para o próprio frontend.

## Files likely affected

`frontend/Dockerfile`, `frontend/.dockerignore`, `frontend/next.config.ts`, possivelmente `frontend/package.json`.
