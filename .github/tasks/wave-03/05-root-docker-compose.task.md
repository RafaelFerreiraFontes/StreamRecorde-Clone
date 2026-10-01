---
name: Wave 03.5 Root Docker Compose
wave: 03
order: 05
depends_on:
  - 01-worker-container-runtime.task.md
  - 02-api-container.task.md
  - 03-frontend-container.task.md
  - 04-shared-runtime-data.task.md
status: done
---

# 03.5 — Root Docker Compose

## Context

As três imagens e a convenção `/data` precisam ser ligadas por uma única configuração na raiz do repositório.

## Objective

Criar `compose.yml` simples para frontend, API e Worker com dados JSON compartilhados e gravações inspecionáveis no host.

## Scope

Orquestração local, portas, variáveis, volumes, rede padrão e descontinuação documentada do Compose antigo do Worker.

## Out of Scope

Novos serviços, reverse proxy, réplicas, Kubernetes, CI/CD de deployment ou mudanças de domínio.

## Current State

Só existe `worker/docker-compose.yml`, com um Worker isolado, `./config:/app/config` e `../recordings:/recordings`. API/Worker ainda não compartilham diretório em Compose raiz. `frontend` usa 3001, API usa `PORT`/3000 e Worker não expõe HTTP.

## Required Changes

- Criar `compose.yml` na raiz com serviços `frontend`, `api` e `worker`, cada um com seu build context/Dockerfile.
- Publicar 3001 do frontend e 3000 da API no host para debug; não publicar porta do Worker.
- Configurar `API_BASE_URL=http://api:3000` no frontend, `PORT=3000` e `CONFIG_DIR=/data` na API, `CONFIG_DIR=/data`, `OUTPUT_DIR=/recordings` e `POLL_INTERVAL=60` no Worker.
- Montar exatamente o mesmo diretório gravável em `/data` da API e do Worker. Avaliar bind mount versus named volume; preferir solução simples para inspeção e bootstrap local, sem incluir JSONs reais na imagem.
- Montar `./recordings:/recordings` no Worker para desenvolvimento; avaliar `restart: unless-stopped`, `init: true` para Worker e `depends_on` sem tratar ordem de start como garantia de prontidão.
- Usar a rede padrão interna do Compose. Avaliar remover ou marcar explicitamente `worker/docker-compose.yml` como legado, evitando duas instruções concorrentes.

## Acceptance Criteria

- [ ] `docker compose config` valida sem serviço extra.
- [ ] Três containers sobem por um único comando na raiz.
- [ ] Frontend alcança `api:3000`; browser acessa frontend na porta 3001.
- [ ] API fica acessível na porta 3000 para testes diretos.
- [ ] API e Worker compartilham `/data`; recordings persistem em `./recordings` no host.
- [ ] Descontinuação do Compose antigo está clara e não causa perda de dados locais.

## Verification

Executar `docker compose config`, `docker compose build` e `docker compose up`; inspecionar portas, mounts, variáveis e rede; consultar frontend/API e conferir os mesmos arquivos em `/data` nos dois containers; encerrar com `docker compose down`.

## Risks / Notes

Bind mount vazio pode mascarar dados copiados na imagem; definir bootstrap na task 04. O diretório `worker/config` é ignorado pelo Git. Não remover volumes/dados de usuário automaticamente. `depends_on` não substitui healthcheck nem resiliência a restart.

## Files likely affected

`compose.yml`, possivelmente `worker/docker-compose.yml`, `.gitignore` apenas se necessário para diretório local de dados, documentação mínima de migração.
