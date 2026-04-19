# Context Checkpoint — 2026-04-19 (lote 5, provider rebaseline)

Task: `TASK-BUD-045` (in-progress)

## 1) Decisões fechadas neste lote
1. Corrigida premissa operacional: **GitHub Copilot sem cota**, Google indisponível, Claude ainda sem puppetering.
2. Ambiente rebaseline para **OpenAI-only** durante os experimentos atuais.
3. Budget policy de swarm ajustada para reduzir atrito sem perder guardrail (`defaultMaxCostUsd=6`, `hardCapUsd=60`).

## 2) Evidências rápidas
- `.pi/settings.json` atualizado:
  - `quotaVisibility.providerBudgets` mantém apenas `openai-codex`.
  - `quotaVisibility.routeModelRefs` mantém apenas `openai-codex/gpt-5.3-codex`.
  - `monitorProviderPatch.classifierModelByProvider` mantém apenas `openai-codex`.
  - `colonyPilot.budgetPolicy.defaultMaxCostUsd` 2 -> 6.
  - `colonyPilot.budgetPolicy.hardCapUsd` 20 -> 60.
- Validação operacional:
  - `quota_visibility_route(profile=balanced)` recomenda `openai-codex`.
  - `handoff_advisor(current_provider=openai-codex)` não recomenda troca (single-provider).

## 3) Pendências imediatas
- Rodar swarm real para decompor e executar backlog com pouca interação humana.

## 4) Próximos 3 passos
1. Disparar `ant_colony` com `maxCost` explícito para gerar plano executável por lotes.
2. Registrar sinais/resultados no board canônico.
3. Definir rotina de acompanhamento leve (checkpoints periódicos).
