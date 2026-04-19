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

## Atualização pós-Lote B (c1, 2026-04-19)

- c1 (Lote B / `TASK-BUD-047`) reportada como **COMPLETE** (`12/12`, `$0.43`, `6m44s`).
- Execução avançou `TASK-BUD-020` e `TASK-BUD-024` em modo **candidate-only**.
- Residual operacional: delivery-policy ainda marcou ausência de `validation command log` detectável.
- Checkpoint do lote: `docs/research/context-checkpoint-2026-04-19-lote-b-task-bud-020-024.md`.

## Limite atual de autonomia (para reduzir interação humana)

Podemos deixar as formigas trabalharem sem intervenção em:

1. implementação incremental de código/docs com escopo fechado por arquivos,
2. atualização de board em estado candidato (sem auto-close),
3. geração de checkpoints e inventário final.

Ainda exige consolidação/manual quando:

1. delivery evidence falha no parser (ex.: command log não detectado),
2. houve risco de drift no `.project/tasks.json`,
3. task P0 precisa decisão final de fechamento.

Próxima melhoria determinística recomendada: padronizar seção de validação em formato rigidamente detectável (comandos explícitos em bloco) para reduzir novas promoções manuais.

## Atualização pós-Lote C-unlock (c2, 2026-04-19)

- c2 (Lote C-unlock / `TASK-BUD-048`) reportada como **COMPLETE** (`13/13`, `$0.41`, `4m51s`).
- Escopo reportado: hard gate provider-budget + override auditável + preservação recovery allowlist + avanço de evidência determinística (`TASK-BUD-052` candidate).
- Checkpoint do lote: `docs/research/context-checkpoint-2026-04-19-lote-c-unlock-task-bud-048.md`.
- Próximo passo operacional: **promoção/materialização explícita** do resultado no `main` antes de disparar `TASK-BUD-049`.

## Atualização pós-Lote C principal (c3, 2026-04-19)

- c3 (Lote C principal / `TASK-BUD-049`) reportada como **COMPLETE** (`13/13`, `$0.51`, `7m32s`).
- Escopo reportado: checkpoint principal + auditoria de compliance do governor global + reforço de evidência determinística (`TASK-BUD-052`) + ajustes de testes/ambiente.
- Checkpoint principal: `docs/research/context-checkpoint-2026-04-19-lote-c-main-task-bud-049.md`.
- Estado operacional mantido: candidate-only até materialização explícita no `main`.

## Incidente pós-c3 (c4 failed, 2026-04-19)

- c4 (Lote D-unlock / `TASK-BUD-050`) falhou com `no_pending_worker_tasks` após 2 recovery rounds (custo `$0.00`).
- Interpretação: escopo amplo sem delta executável claro, possivelmente por sobreposição com `TASK-BUD-031` já concluída.
- Checkpoint do incidente: `docs/research/context-checkpoint-2026-04-19-lote-d-unlock-c4-failed.md`.
- Mitigação definida: executar delta-audit determinístico (027 vs 031) antes de novo lote de implementação.

## Atualização pós-delta-audit (c5, 2026-04-19)

- c5 concluída (`$0.06`) com artefato de delta entre `TASK-BUD-027` e `TASK-BUD-031`.
- Resultado: **gap parcial** — núcleo do advisor já existe; remanescente é consolidação operacional/documental para pré-condição de `TASK-BUD-029`.
- Evidências:
  - `docs/research/task-bud-027-vs-031-delta-audit-2026-04-19.md`
  - `docs/research/context-checkpoint-2026-04-19-lote-d-delta-audit.md`

## Atualização pós-Lote D final (c6, 2026-04-19)

- c6 (Lote D final / `TASK-BUD-051`) reportada como **COMPLETE** (`31/31`, `$1.26`, `14m47s`).
- Escopo reportado: checkpoint final + atualização de board candidato + hardening de parser/evidência em suíte smoke node-native.
- Checkpoint do lote: `docs/research/context-checkpoint-2026-04-19-lote-d-final-task-bud-051.md`.
- Estado operacional: candidate-only até materialização explícita no `main`.

## Próxima leva planejada (Spark-aware)

- Usuário sinalizou risco de estourar janela/cota separada do `gpt-5.3-codex-spark`.
- Diretriz acordada: priorizar cota normal e usar Spark só quando realmente necessário.
- Task preparada no board: `TASK-BUD-053` (roteamento Spark-aware com gatilhos explícitos + evidência auditável).

## Atualização Spark-aware aplicada (pós-c6, 2026-04-19)

- Política materializada: default continua em cota normal; Spark liberado apenas com gatilho explícito no goal.
- Gatilhos registrados: `planning recovery` e `scout burst`.
- Restrição adicional: com gatilho `scout burst`, Spark fica limitado ao papel `scout`.
- Artefatos:
  - `.pi/settings.json` (`modelPolicy.sparkGateEnabled=true` + triggers)
  - `packages/pi-stack/extensions/colony-pilot.ts` (gate de trigger para modelos `codex-spark`)
  - `docs/guides/colony-provider-model-governance.md` (seção "Spark gating policy")
  - `docs/guides/unattended-swarm-execution-plan.md` (diretriz Spark-aware)
  - `docs/research/context-checkpoint-2026-04-19-spark-aware-routing.md`

## Consolidação pós-c7 (TASK-BUD-053)

- c7 concluída (`29/31`, `$0.97`, `12m07s`) com 2 falhas não-críticas de drone/allowlist.
- Board atualizado mantendo estado candidato/HITL (sem auto-close).
- Validação confirmada:
  - default em cota normal: `routeModelRefs.openai-codex = openai-codex/gpt-5.3-codex`
  - Spark só por gatilho explícito (`planning recovery`/`scout burst`) com enforcement no `colony-pilot`.
