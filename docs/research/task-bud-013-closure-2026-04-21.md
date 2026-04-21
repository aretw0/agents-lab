# TASK-BUD-013 — closure (2026-04-21)

## Objetivo
Tornar entrega de colônia auditável no branch principal (injeção confiável + inventário obrigatório + recuperação determinística quando apply falha).

## Evidências
1. Trilha determinística de entrega/retenção no runtime:
   - `packages/pi-stack/extensions/colony-pilot.ts`
   - `packages/pi-stack/extensions/colony-pilot-candidate-retention.ts`
   - retention record agora inclui `runtimeSnapshotPath` para `failed|budget_exceeded`.
2. Recovery automático quando evidência de delivery não fecha:
   - `ensureRecoveryTaskForCandidate(...)` no task-sync mantém fila de promoção sem auto-close.
   - coberto por teste em `packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`.
3. Inventário + command log padronizados para delivery-policy:
   - template determinístico em `docs/guides/unattended-swarm-execution-plan.md`.
   - parser de evidência aceitando heading + bullet com comando real, com regressão de falso positivo coberta em smoke.
4. Validação executada:
   - `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts packages/pi-stack/test/smoke/colony-pilot-retention.test.ts`
   - resultado: `2 passed`, `71 passed`.

## Resultado
Critérios atendidos com governança HITL preservada (sem auto-close automático de tasks estratégicas).
