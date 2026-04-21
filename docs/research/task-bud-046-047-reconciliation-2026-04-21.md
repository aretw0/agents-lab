# TASK-BUD-046/047 — reconciliation (2026-04-21)

## Escopo
Reconciliação evidence-first dos lotes legados A/B sem auto-close estratégico.

## Snapshot canônico
- `TASK-BUD-046`: `in-progress` (Lote A / reconciliador single-writer)
- `TASK-BUD-047`: `in-progress` (Lote B / triage + budget provider)
- `VER-BUD-079` já registra estado parcial de `TASK-BUD-047`.

## Evidências verificadas neste ciclo
1. Teste de regressão do reconciliador/parsers executado com sucesso:
   - `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-retention.test.ts packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`
   - Resultado: `2 passed`, `69 passed`
2. `TASK-BUD-047` mantém consolidação de outcomes nucleares já fechados no board:
   - `TASK-BUD-020` (`VER-BUD-077`)
   - `TASK-BUD-024` (`VER-BUD-075`)
3. Ambas (`046/047`) permanecem em estado candidato/in-progress (sem auto-close P0).

## Decisão de reconciliação
- **Não fechar `TASK-BUD-046` nem `TASK-BUD-047` neste slice.**
- Motivo: falta consolidar evidência determinística única de lote para `TASK-BUD-046` (inventário final de mudanças + validação integrada de lote A no formato de fechamento canônico), apesar de testes atuais estarem verdes.

## Próximos passos mínimos
1. Consolidar evidência final de lote A (inventário + validação integrada) para `TASK-BUD-046`.
2. Após fechamento de `046`, concluir reconciliação final de `047` com vínculo explícito ao gate de dependência.
3. Só então avançar para sequência `052 -> 051`.
