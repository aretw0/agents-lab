# TASK-BUD-005 — closure (2026-04-21)

## Objetivo
Implementar adapter inicial opt-in para sincronizar eventos de colônia com `.project/tasks` sem auto-close estratégico.

## Entregas
- Comportamento opt-in de criação no launch validado (`createOnLaunch`).
- Fluxo candidate/human-close validado (`requireHumanClose=true` mantém `completed` em `in-progress` com nota de candidato).
- Base single-writer/atômica já endurecida no task-sync (suporte operacional da trilha).

## Evidência de teste
- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-task-sync-behavior.test.ts packages/pi-stack/test/smoke/colony-pilot-task-sync-lock.test.ts packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`
  - resultado: `3 files passed`, `73 tests passed`.

## Resultado por critério
1. Criar tasks quando sessão iniciar (opt-in): **atendido**.
2. Status final em modo candidato com confirmação humana: **atendido**.
