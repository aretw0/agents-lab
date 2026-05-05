# TASK-BUD-869 protected/mixed output audit — 2026-05

## Escopo

Auditoria dos `content` com JSON bruto remanescentes em `quota-alerts`, `safe-boot` e `claude-code-adapter`. Regra da fatia: alterar somente saídas local-safe/report-only; não alterar settings, subprocessos, provider routing, orçamento ou autenticação.

## Classificação

| Superfície | Classificação | Decisão |
| --- | --- | --- |
| `quota_alerts` | local-safe/report-only | Migrado para resumo `quota-alerts: ...`; `details` preserva alertas completos. A ferramenta não troca provider e não autoriza overage. |
| `safe_boot` | protected-deferred | Mantido sem migração nesta fatia porque a ferramenta escreve/restaura `.pi/settings.json`; qualquer alteração de UX deve ter foco explícito de settings/safe-boot. |
| `claude_code_adapter_status` | local-safe mas acoplado a superfície executável | Deferido para uma fatia própria para não misturar com `claude_code_execute`. |
| `claude_code_execute` | protected/executable | Deferido: pode invocar subprocesso externo (`claude --print`) e consome budget; mudanças exigem foco explícito. |

## Validação focal

- `quota-alerts.test.ts`: cobre `quota_alerts` summary-first com `details` preservado.
- Nenhum teste de safe-boot/claude foi alterado porque essas rotas foram classificadas como deferidas.

## Guardrail

Não houve alteração de comportamento em safe-boot/settings, provider quota, autenticação Claude Code, budget gate ou execução de subprocessos.
