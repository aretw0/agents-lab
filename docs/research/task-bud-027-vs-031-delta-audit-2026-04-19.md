# Delta Audit — TASK-BUD-027 vs TASK-BUD-031 (2026-04-19)

## Resumo
- Objetivo: verificar se `TASK-BUD-050` ainda tem trabalho técnico real ou se a pré-condição para `TASK-BUD-029` já está atendida por capacidades entregues em `TASK-BUD-031`.
- Resultado: **gap = partial** (núcleo funcional já existe, falta alinhamento explícito de escopo/board/docs para o lote atual).

## Matriz de capacidade

| Requisito (TASK-BUD-027) | Evidência existente (TASK-BUD-031) | Gap |
|---|---|---|
| Recomendação determinística de roteamento | `packages/pi-stack/extensions/handoff-advisor.ts` + integração com `quota-visibility` | none |
| Evitar providers em BLOCK automaticamente | Notas de `TASK-BUD-031` registram filtro de BLOCK na seleção | none |
| Justificativa auditável da recomendação | `execute` com trilha/auditoria registrada + motivo de decisão | partial |
| Superfície operacional alinhada ao lote atual (`TASK-BUD-050`) | Cobertura funcional existe, mas lote atual carece de consolidação explícita no board/docs do ciclo D | partial |

## Conclusão operacional
- **Não há necessidade de reimplementar o advisor do zero.**
- O trabalho remanescente é de **consolidação operacional**: evidenciar claramente o delta (ou ausência dele) para liberar avanço de `TASK-BUD-029` com rastreabilidade suficiente.

## Patches mínimos propostos (sem implementar neste lote)
1. `docs/guides/quota-visibility.md` — seção curta “Routing advisor: critérios e bloqueios BLOCK” com referência ao fluxo atual.
2. `.project/tasks.json` — nota explícita em `TASK-BUD-050` e `TASK-BUD-029` marcando pré-condição candidata por evidência.
3. (Opcional, se faltar no teste atual) `packages/pi-stack/test/smoke/handoff-advisor.test.ts` — caso de regressão focado em justificativa auditável.
