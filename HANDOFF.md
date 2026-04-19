# HANDOFF (raiz) — próximos passos

Data: 2026-04-19  
Contexto: sessão retornada com risco de estouro de contexto (Codex)

## 1) Norte desta fase (curto prazo)

Calibrar o **control plane dinâmico e proativo** do `pi-stack` com:

- governança de modelo por role (`modelPolicy`),
- governança de budget por provider (`providerBudgets` + gates),
- baixo atrito operacional para rodízio de providers/models.

## 2) Estado confirmado

- Config atual está rebaseline para **OpenAI-only** em `.pi/settings.json`:
  - `providerBudgets`: apenas `openai-codex`
  - `routeModelRefs`: apenas `openai-codex/gpt-5.3-codex`
- `colonyPilot.budgetPolicy` está ativo com `enforceProviderBudgetBlock: true`.
- `guardrailsCore.providerBudgetGovernor` está ativo.
- Board canônico: `.project/tasks.json` (não usar shadow board).
- Preflight atualizado (2026-04-19): `openai-codex` em `ok` após recalibrar limites para o contexto atual de cota PRO; handoff advisor não sugere troca (single-provider).

## 3) Onde a política está no código (fonte de verdade)

- `packages/pi-stack/extensions/colony-pilot.ts`
  - `DEFAULT_MODEL_POLICY`
  - `resolveColonyPilotModelPolicy(...)`
  - `evaluateAntColonyModelPolicy(...)`
  - `buildModelPolicyProfile(...)`
  - gate no `pi.on("tool_call")` para `ant_colony` (model-policy + budget-policy + provider-budget gate)
- `packages/pi-stack/extensions/quota-visibility.ts`
  - `parseProviderBudgets(...)`
  - `buildProviderBudgetStatuses(...)`
  - validações de soma de share `%` e estados `ok/warning/blocked`
- docs:
  - `docs/guides/colony-provider-model-governance.md`
  - `docs/guides/budget-governance.md`
  - `docs/guides/quota-visibility.md`

## 4) Decisão operacional já consolidada

- `claudioemmanuel/squeez` é referência útil para **compressão de I/O/memória de sessão**,
  **não** substitui o control plane de governança do `pi-stack`.

## 5) Próximos passos (ordem recomendada)

1. **Snapshot de saúde antes de executar swarm**
   - `quota-visibility status 30`
   - `quota-visibility budget 30`
   - `quota-visibility route balanced`
   - `handoff` (somente se provider atual estiver em WARN/BLOCK)
2. **Fixar profile de model policy para esta fase**
   - escolher e aplicar um perfil (`codex`, `hybrid` ou `factory-strict-hybrid`),
   - registrar decisão no board/docs.
3. **Rodar 1 swarm-piloto com custo explícito**
   - sempre com `maxCost` definido,
   - coletar evidência de budget/rota pós-run.
4. **Fechar pendências P0 críticas no board**
   - priorizar: `TASK-BUD-010`, `TASK-BUD-020`, `TASK-BUD-024`, `TASK-BUD-026`, `TASK-BUD-029`.
5. **Só depois** evoluir docs/experimentos ([mdt](https://github.com/ifiokjr/mdt), SDD→BDD→TDD→DDD refinado).

## 6) Critério de pronto desta fase

- Rodízio provider/model funcionando com gate automático sem surpresa de custo,
- 1 execução real auditada com evidência,
- P0 críticos avançados no `.project/tasks.json`.

## 7) Lição operacional desta sessão (importante)

**Problema observado:** planejamento grande demais estoura contexto do modelo.

**Estratégias obrigatórias para próximas rodadas:**

1. **Planejamento em lotes pequenos** (máx. 3-5 decisões por iteração).
2. **Checkpoint a cada etapa** com mini-handoff (resumo + próximos 3 passos).
3. **Delegação por trilha** (policy, budget, docs, research) em paralelo, com consolidação curta.
4. **Pesquisa em shards** (perguntas menores), em vez de “mega-investigação” única.
5. **Orçamento de contexto** explícito: se passar de um limiar, parar e resumir antes de continuar.

**Objetivo:** manter continuidade sem saturar contexto, com menor fricção cognitiva.

**Já operacionalizado nesta rodada:**
- `docs/guides/mini-handoff-template.md`
- `docs/guides/swarm-preflight-15m.md`
- `docs/research/context-checkpoint-2026-04-19.md`
- `docs/research/context-checkpoint-2026-04-19-lote-2.md`
- `docs/research/context-checkpoint-2026-04-19-lote-3.md`

---
Se abrir nova sessão: comece por este arquivo + `.pi/settings.json` + `.project/tasks.json`.

## Checkpoint rápido (mid-run c4, 2026-04-19)

- `c4` em execução para Lote A (`TASK-BUD-046` / foco `TASK-BUD-010`).
- Observado risco operacional no `projectTaskSync`: em launch anterior houve escrita transitória no `.project/tasks.json`.
- Estado atual está íntegro (board restaurado, `git status` limpo, `.project/tasks.json` com 1104 linhas).
- Decisão: **não interromper c4**; calibrar sync **após** término da c4.
- Calibração recomendada pós-c4:
  1) `/reload` para aplicar `.pi/settings.json` recente no runtime (budget default ainda aparece antigo no status).
  2) reduzir agressividade do sync (`createOnLaunch=false`, `trackProgress=false`) ou desativar sync automático se necessário.

### Atualização pós-c4

- c4 finalizada com sucesso (`9/9`, `$0.28`) para o Lote A / `TASK-BUD-046`.
- Calibração já aplicada em `.pi/settings.json`:
  - `projectTaskSync.createOnLaunch=false`
  - `projectTaskSync.trackProgress=false`
- **Ação pendente do operador:** rodar `/reload` antes de lançar o próximo lote (`TASK-BUD-047`).
