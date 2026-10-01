---
name: Wave 03.7 Docker Development Workflow
wave: 03
order: 07
depends_on:
  - 05-root-docker-compose.task.md
  - 06-docker-health-and-startup.task.md
status: done
---

# 03.7 — Docker Development Workflow

## Context

O projeto deve continuar simples para debugging local e ganhar uma forma única de iniciar a stack em Docker.

## Objective

Documentar comandos, caminhos, volumes e operação diária para execução local ou por Compose.

## Scope

Documentação operacional e exemplos de comandos já suportados pela implementação das tasks 01–06.

## Out of Scope

Novo sistema de ambientes, scripts complexos, CI/CD, produção/cloud ou alteração de código de produto.

## Current State

`worker/README.md` cobre `python worker.py`; `frontend/README.md` e `frontend/.env.example` descrevem execução local; existe Compose isolado em `worker/`. Ainda não há instrução única para três serviços na raiz.

## Required Changes

- Documentar `docker compose build`, `up`, `up --build`, `down`, `logs -f` e `logs -f worker` executados na raiz.
- Documentar rebuild de `api`, `frontend` e `worker`, além de `docker compose up -d <serviço>`/`run` apenas quando fizer sentido, com dependências explícitas.
- Descrever execução local sem Docker dos três componentes, inclusive variáveis de caminho e `API_BASE_URL` local.
- Registrar portas 3001/3000, rede interna, `/data` e arquivos JSON, bind mount de recordings e sua localização no host, logs e encerramento limpo.
- Explicar o status do Compose antigo do Worker e o procedimento seguro para usar dados locais existentes sem sobrescrevê-los.

## Acceptance Criteria

- [ ] Um desenvolvedor consegue construir, iniciar, observar logs, rebuildar um serviço e parar a stack seguindo a documentação.
- [ ] Execução individual fora do Docker continua descrita.
- [ ] Variáveis, portas, volumes e recordings coincidem com `compose.yml` real.
- [ ] Documentação não sugere serviços ou recursos fora da Wave 03.

## Verification

Seguir os comandos documentados em clone de trabalho; comparar caminhos/portas com `docker compose config`; revisar referências para arquivos existentes e não usar `down -v` como fluxo normal.

## Risks / Notes

Comandos que recriam containers podem interromper gravações; explicar parada correta. O bind mount de recordings é temporário para desenvolvimento e não representa destino final de cloud.

## Files likely affected

`README.md` se existir ou documentação raiz equivalente, `worker/README.md`, `frontend/README.md`, possivelmente `api/README.md` e `frontend/.env.example`.
