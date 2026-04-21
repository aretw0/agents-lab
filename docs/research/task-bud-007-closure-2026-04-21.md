# TASK-BUD-007 — closure (2026-04-21)

## Objetivo
Consolidar política single-board clock: `.project/tasks` como fonte oficial macro, com sync de eventos de colônia (start/progress/end) em modo opt-in e fechamento HITL.

## Entregas
- Política explícita no guia operacional:
  - `docs/guides/budget-governance.md` (seção *Política single-board clock v1*).
- Bridge atualizado com estado atual:
  - `docs/research/colony-project-task-bridge.md` (adapter opt-in via colony-pilot, board macro vs estado efêmero).
- Cobertura comportamental do adapter:
  - `packages/pi-stack/test/smoke/colony-pilot-task-sync-behavior.test.ts`
    - criação no launch opt-in;
    - atualização start/progress/end no mesmo registro canônico;
    - terminal `failed` marcando board como `blocked`;
    - `completed` mantendo candidate com `requireHumanClose=true`.

## Validação
- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-task-sync-behavior.test.ts packages/pi-stack/test/smoke/colony-pilot-task-sync-lock.test.ts packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`
  - resultado: `3 files passed`, `74 tests passed`.

## Resultado
Critérios atendidos: eventos essenciais sincronizam o board, estado efêmero não substitui o board oficial, e fechamento continua human-in-the-loop.
