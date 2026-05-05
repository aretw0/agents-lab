# TASK-BUD-866 mixed output audit — 2026-05

## Escopo

Auditoria local-safe dos `content` com JSON bruto em superfícies mistas de board, stack sovereignty e provider advisory. A migração abaixo altera apenas apresentação operador-visível; payload completo permanece em `details`.

## Classificação

| Superfície | Classificação | Decisão |
| --- | --- | --- |
| `board_query` | local-safe | Migrado para resumo `board-query: ...`; `details` preserva linhas/metadados. |
| `board_decision_packet` | local-safe/read-only | Migrado para resumo humano existente do packet; `details` preserva opções/evidências. |
| `stack_sovereignty_status` | local-safe/read-only diagnostic | Migrado para resumo de risco/owner/scheduler; `details` preserva avaliação completa. |
| `provider_readiness_matrix` | local-safe/passive provider status | Migrado para resumo de contagens; sem chamadas de modelo e sem troca de provider. |
| `handoff_advisor` | protected-deferred | Mantido sem migração nesta fatia porque a mesma ferramenta possui caminho `execute=true` que chama `pi.setModel`; qualquer alteração deve ter foco explícito de provider/handoff. |
| `quota_visibility_export` | fora do alvo de `content` | `JSON.stringify` grava arquivo de relatório em `.pi/reports`; não é saída operador-visível bruta. |
| `quota-visibility-output-policy` | já centralizado | Mantido como política compartilhada existente para quota visibility. |

## Validação focal

- `project-board-surface.test.ts`: cobre `board_query` e `board_decision_packet` summary-first sem JSON bruto em `content`.
- `stack-sovereignty-surface.test.ts`: cobre `stack_sovereignty_status` summary-first com `details` preservado.
- `provider-readiness.test.ts`: cobre `provider_readiness_matrix` summary-first com `details` preservado.

## Guardrail

Nenhum comportamento de provider routing/cost/handoff foi alterado. A rota protegida `handoff_advisor.execute=true` permanece fora desta fatia.
