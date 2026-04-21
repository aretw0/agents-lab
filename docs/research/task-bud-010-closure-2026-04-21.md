# TASK-BUD-010 — closure (2026-04-21)

## Objetivo
Consolidar reconciliador single-writer para sync `colony -> .project/tasks` com segurança em cenários concorrentes/worktree.

## Entregas deste slice
- `packages/pi-stack/extensions/colony-pilot-task-sync.ts`
  - `writeProjectTasksBlock` agora usa:
    - lock determinístico por arquivo (`.project/tasks.lock`), com timeout/retry/stale-reclaim;
    - escrita atômica (`tasks.json.tmp-*` + `rename`).
- `packages/pi-stack/test/smoke/colony-pilot-task-sync-lock.test.ts`
  - cobre:
    1. escrita com release de lock;
    2. reclaim de lock stale;
    3. timeout em lock fresco (conflito básico).

## Validação
- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-task-sync-lock.test.ts packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`
  - resultado: `2 files passed`, `70 tests passed`.

## Resultado por critério
1. Consistência sem race evidente: **atendido** (single-writer lock + escrita atômica).
2. Lock/fila/reconciliação determinística e reversível: **atendido** (lock com timeout/retry/stale reclaim e cleanup explícito).
3. Testes de conflito básico: **atendido** (smoke dedicado de lock/timeout/stale).
