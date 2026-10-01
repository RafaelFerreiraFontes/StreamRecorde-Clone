name: Wave 03.6 Docker Health and Startup
wave: 03
order: 06
depends_on:
  - 04-shared-runtime-data.task.md
  - 05-root-docker-compose.task.md
status: done

# 03.6 — Docker Health and Startup

## Context

O Compose inicia processos, mas a prontidão dos serviços e a ausência inicial de JSONs precisam de comportamento observável.

## Objective

Fazer startup, restarts e falhas temporárias previsíveis com checks e logs proporcionais ao MVP.

## Scope

Healthchecks e mínimos ajustes de startup/espera nos três serviços e no Compose.

## Out of Scope

Service discovery externo, fila, orquestrador novo, sleeps arbitrários ou lógica de domínio.

## Current State

`api/src/main.ts` já lê `PORT`, mas não há rota `/health` específica. O frontend retorna 502 pelo proxy quando a API está indisponível. O Worker tem polling e logs de início, trata SIGTERM/SIGINT, e os adapters aceitam arquivos ausentes com defaults; o diretório precisa existir e ser gravável. O Compose atual do Worker usa `restart: unless-stopped`.

## Required Changes

- Definir healthcheck da API com endpoint existente se adequado; adicionar `GET /health` mínimo somente se um endpoint de domínio causar efeitos ou dependência indevida de dados.
- Avaliar healthcheck HTTP do frontend com utilidade real e ferramenta disponível na imagem; evitar check que falhe só porque a API está temporariamente fora.
- Confirmar comportamento do Worker com `/data` vazio e após restart; logar claramente caminhos efetivos e estados de startup sem dados sensíveis.
- Ajustar `depends_on`/condições no Compose apenas onde eliminem falhas reais; assegurar recuperação após indisponibilidade temporária de API ou Worker, já que eles não se chamam diretamente.
- Verificar restart e shutdown sem `sleep` fixo; aproveitar o tratamento de sinais da task 01.

## Acceptance Criteria

- [ ] Estado saudável/indisponível da API é observável sem consulta a live real.
- [ ] Frontend sobe e responde mesmo se API estiver temporariamente ausente; proxy retorna falha controlada e recupera quando API volta.
- [ ] Worker lida com arquivos inicialmente ausentes conforme contrato da task 04 e com restart sem sobrescrever estado existente.
- [ ] Logs de startup e falhas temporárias são claros; não há espera por tempo arbitrário.

## Verification

Subir stack com diretório de dados vazio; consultar healthchecks; parar/reiniciar API e Worker individualmente; confirmar frontend e proxy após retorno; observar logs e estado JSON; testar shutdown do Worker conforme task 01.

## Risks / Notes

Healthcheck que lê JSON pode marcar API indisponível por problema de dados e confundir liveness com readiness. Não usar healthcheck de Worker que exija stream online. `depends_on` comum só ordena criação de containers.

## Files likely affected

`compose.yml`, possivelmente `api/src/app.controller.ts` ou rota de health mínima, `worker/worker.py`, configuração/runtime do frontend apenas se necessário.
