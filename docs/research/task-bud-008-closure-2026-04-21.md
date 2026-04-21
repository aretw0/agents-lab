# TASK-BUD-008 — closure (2026-04-21)

## Objetivo
Projetar projeções de status de budget/task para superfícies TUI e WEB usando dados consolidados do board canônico.

## Entregas
- `packages/pi-stack/extensions/board-clock.ts`
  - snapshot compacto do board (`.project/tasks`) com contagens por status e shortlist (`inProgressIds`, `blockedIds`).
  - formatter compartilhado de status: `[board] ip=<n> blk=<n> plan=<n>`.
- `packages/pi-stack/extensions/web-session-gateway.ts`
  - inclui `state.boardClock` em `/api/state`.
  - publica status `board-clock` para TUI via `ctx.ui.setStatus`.
- `packages/pi-stack/extensions/custom-footer.ts`
  - footer passa a renderizar `board-clock` quando presente.
- `docs/guides/budget-governance.md`
  - seção de projeção TUI+WEB com semântica única e regra de fonte canônica.

## Validação
- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/board-clock.test.ts packages/pi-stack/test/smoke/custom-footer-registration.test.ts packages/pi-stack/test/smoke/web-session-gateway.test.ts packages/pi-stack/test/smoke/colony-pilot-task-sync-behavior.test.ts`
  - resultado: `4 files passed`, `38 tests passed`.

## Resultado por critério
1. Status consolidado visível sem depender de sessão específica: **atendido**.
2. Visão web e TUI compartilham semântica de status: **atendido** (`board-clock`).
3. Sem duplicar fonte de verdade: **atendido** (snapshot sempre derivado de `.project/tasks`).
