# TASK-BUD-081 — closure (2026-04-21)

## Objetivo
Tornar o watchdog (`warn/checkpoint/compact`) operacionalmente visível no control-plane, com trilha canônica no handoff sem depender de polling manual.

## Entregas
- `packages/pi-stack/extensions/context-watchdog.ts`
  - adicionada ação explícita por nível (`continue | micro-slice-only | write-checkpoint | compact-now`)
  - notify operacional agora inclui `action:`
  - em escalonamento (`warn/checkpoint/compact`) persiste trilha canônica em `.project/handoff.json`:
    - `next_actions`: linha `Context-watch action: ...`
    - `blockers`: marcador contextual `context-watch-*`
    - `context_watch_events`: histórico estruturado com nível/percent/action/recommendation
- `docs/guides/openai-context-window-playbook.md`
  - seção de visibilidade operacional + fallback determinístico quando aviso não aparece no chat principal
- `packages/pi-stack/test/smoke/context-watchdog.test.ts`
  - cobertura para escrita canônica no handoff e limpeza de marcador quando nível volta para `ok`

## Validação
- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/context-watchdog.test.ts packages/pi-stack/test/smoke/colony-pilot-retention.test.ts`
  - Resultado: `2 passed`, `13 passed`

## Resultado por critério
1. Registro canônico curto em warn/checkpoint/compact: **atendido**.
2. Fluxo não depende só de status/footer: **atendido** (`notify` com ação + escrita em handoff).
3. Runbook com fallback determinístico: **atendido**.
