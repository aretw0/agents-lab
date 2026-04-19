# Context Checkpoint — 2026-04-19 (lote 4, preflight)

Task: `TASK-BUD-045` (in-progress)

## 1) Decisões fechadas neste lote
1. Preflight de budget/readiness foi executado antes de qualquer swarm.
2. `openai-codex` permanece em `warning` no horizonte mensal (pressão projetada ~73%).
3. Para piloto imediato, a recomendação operacional é evitar auto-switch cego e priorizar provider com budget+readiness alinhados.

## 2) Evidências rápidas
- `quota_visibility_status(days=30)`:
  - `openai-codex`: `state=warning` (projectedPctCost ~73.36)
  - `github-copilot`: `state=ok`
  - `google-antigravity`: `state=ok`
  - `google-gemini-cli`: `state=ok` em budget
- `quota_visibility_route(profile=balanced)`:
  - recomendou `google-gemini-cli` por headroom de budget.
- `handoff_advisor(current_provider=openai-codex)`:
  - recomendou `github-copilot/claude-sonnet-4.6` (budget + readiness combinados)
  - apontou `google-gemini-cli` como indisponível por readiness (`blocked`).

## 3) Pendência imediata (decisão humana)
- Confirmar se aplicamos switch explícito para `github-copilot/claude-sonnet-4.6` antes do próximo swarm-piloto.

## 4) Próximos 3 passos
1. Confirmar provider alvo para o piloto (`github-copilot` sugerido).
2. Executar run curto com `maxCost` explícito.
3. Registrar evidência pós-run no board + checkpoint final.
