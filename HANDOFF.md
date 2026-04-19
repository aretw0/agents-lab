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

## Ajuste operacional de cota (OpenAI-only)

- Reforçado lock OpenAI-only em `.pi/settings.json`:
  - `defaultProvider = openai-codex`
  - `defaultModel = gpt-5.3-codex`
  - `piStack.colonyPilot.modelPolicy.allowMixedProviders = false`
  - `piStack.colonyPilot.modelPolicy.allowedProviders = ["openai-codex"]`
- Objetivo: evitar delegações/subagentes em providers sem cota e manter esforço concentrado na cota disponível.

## Checkpoint pós-/reload e pré-compactação (2026-04-19)

Contexto para retomada após nova compactação manual:

- `/reload` já executado para aplicar os últimos ajustes de governança.
- Estado de execução consolidado:
  - Spark-aware ativo (default cota normal; Spark só por gatilho explícito).
  - OpenAI-only reforçado em `.pi/settings.json`.
  - Board canônico atualizado em `.project/tasks.json`.
- Fricção atual observada no runtime de monitores:
  - aviso recorrente: `[hedge] classify failed: No tool call in response`.
  - decisão operacional do usuário: **monitores desativados temporariamente** para evitar flood de token/contexto enquanto calibramos.

### Decisão de governança válida agora

- Aceitamos compactação manual de contexto no curto prazo.
- Não forçar reativação dos monitores atuais antes da recalibração.
- Prioridade imediata: cultivar primitiva de **monitor de pressão de contexto** com custo baixo e rollout gradual.

### Próximos passos (pós-compactação)

1. Criar v1 do monitor `context-pressure` em modo **on-demand** (`event: command`) para não gerar custo passivo.
2. Usar sinais mínimos e baratos (sem contexto longo):
   - repetição sem progresso,
   - crescimento de tool_calls sem checkpoint,
   - ausência de mini-handoff em long runs.
3. Definir ações graduais:
   - L1 advisory,
   - L2 checkpoint obrigatório (mini-handoff + file inventory + command log),
   - L3 shard/delegação,
   - L4 hard-stop com pedido de consolidação.
4. Só depois migrar para modo automático (`every(N)` / gatilho forte), com orçamento explícito de classificação.
5. Reavaliar reativação seletiva dos monitores legados após calibração (não all-on de uma vez).

### Referência de pesquisa já aceita

- `claudioemmanuel/squeez` segue como fonte de heurísticas de compressão/contexto (dedup, intensidade adaptativa, sumarização estruturada), sem substituir governança do `pi-stack`.

## Baseline de contratos e regressões invisíveis (início da retomada)

Validação executada antes de avançar (determinística):

- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" --test packages/pi-stack/test/*.test.mjs` → **PASS** (84/84)
- `npx vitest run` (com PATH node+scoop explícito) → **PASS** (370/370)
- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" scripts/verify-pi-stack.mjs` → **PASS** (10/10)

### Contratos hoje cobertos (alto nível)

1. **Governança colony/model/budget/provider**
   - parsers e gates principais em `colony-pilot` (inclui lock provider, budget gate, delivery evidence).
   - cobertura Spark reforçada nesta rodada (novos testes de trigger explícito + scout-only).
2. **Quota stack**
   - parsers/estado de budget, alerts, panel, handoff advisor, provider-readiness.
3. **Web session gateway (Web UI surface)**
   - resolução de modo/host/url/token + e2e harness de start/stop e endpoint auth.
4. **TUI footer/status surface**
   - registro da extensão, formatação e integração com quota-panel.

### Regressões invisíveis (a cobrir antes de acelerar)

1. **Drift de teste vs runtime real**
   - parte dos `*.test.mjs` reimplementa lógica em vez de importar funções reais da extensão.
   - risco: teste verde com código de produção quebrado.
2. **Monitores em runtime real com custo**
   - monitores estão OFF (decisão operacional correta), então falta cobertura e2e de classificação com orçamento real de token.
3. **TUI em cenários de largura/ruído**
   - falta teste de regressão visual/textual para truncamento/legibilidade em terminais estreitos.
4. **Web UI prompt path**
   - falta e2e explícito do `/api/prompt` (followUp/steer), incluindo comportamento com token inválido e concorrência.
5. **OpenAI-only lock como contrato explícito**
   - ajustes em `.pi/settings.json` estão aplicados, mas ainda sem teste dedicado de contrato do workspace.

### Próxima ordem de execução (por partes)

1. **Parte A (agora):** consolidar contratos críticos de governança (Spark/OpenAI-only) em testes source-linked.
2. **Parte B:** fechar gaps de Web UI (`/api/prompt`) e TUI (largura/overflow) com smoke/e2e mínimo.
3. **Parte C:** só então calibrar monitor `context-pressure` em modo on-demand (sem flood passivo).

## Atualização incremental — TUI/Web observability + compactação (2026-04-19)

### Implementado nesta rodada

1. **Cobertura de regressão Spark (governança de modelo)**
   - novos testes em `packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`:
     - bloqueio de Spark sem trigger explícito,
     - permissão com trigger `planning recovery`,
     - enforcement scout-only para `scout burst`.

2. **Widget de quota mais visível (TUI)**
   - `quota-panel` agora suporta modo default via settings:
     - `piStack.quotaPanel.mode = off|on|auto`
   - adicionado `/qp status` para diagnóstico rápido (modo ativo/config/cache/visibilidade).
   - `.pi/settings.json` atualizado para `piStack.quotaPanel.mode = "on"` (visibilidade imediata).

3. **Status de background no footer principal (TUI)**
   - `custom-footer` passou a exibir também `status("colony-pilot")` na linha compacta,
   - junto do `quota-budgets`, para visibilidade contínua de colônias/web sem abrir telas extras.

4. **Compactação automática de JSON grande em tools first-party**
   - `colony-pilot` tools (`colony_pilot_status`, `colony_pilot_artifacts`, `colony_pilot_preflight`, `colony_pilot_baseline`) agora aplicam compactação por threshold.
   - `web-session-gateway` (`session_web_status` tool e `/session-web status`) idem.
   - payload completo permanece em `details`; texto inline mostra preview compacto.
   - threshold configurável em `.pi/settings.json` para colony-pilot:
     - `piStack.colonyPilot.outputPolicy.maxInlineJsonChars`.

### Config aplicada no workspace

- `.pi/settings.json`:
  - `piStack.colonyPilot.outputPolicy.compactLargeJson = true`
  - `piStack.colonyPilot.outputPolicy.maxInlineJsonChars = 1200`
  - `piStack.quotaPanel.mode = "on"`

### Validação determinística desta rodada

- `npx vitest run` → **PASS (372/372)**
- `node --test packages/pi-stack/test/*.test.mjs` → **PASS (84/84)**
- `node scripts/verify-pi-stack.mjs` → **PASS (10/10)**

### Pendências imediatas (próxima parte)

1. Cobrir `web-session-gateway` `/api/prompt` com e2e de concorrência + token inválido.
2. Teste de largura/overflow no footer (budget + pilot + cwd) para evitar perda de sinal útil em terminal estreito.
3. Definir hatch first-party para conflitos de ambiente (`uv`/background process) sem depender de pacote externo.

## Decisão operacional (contexto ~52%)

- Escolha recomendada: **compactar agora** e retomar com contexto limpo.
- Motivo: já temos baseline estável + validação verde; próximos passos (TUI layout de colônias + Web prompt e2e) vão gerar muito diff/artefato.
- Trade-off aceito: checkpoint manual frequente > risco de saturação do control-plane.

### Ação obrigatória antes da próxima execução

- Como `.pi/settings.json` foi alterado nesta rodada (quotaPanel + outputPolicy), rodar **`/reload`** na sessão retomada.

## Próximo pacote (pós-compact) — colônias sem inchar TUI

Objetivo: quando houver muitas colônias, manter linha principal curta e mover detalhe para painel dedicado.

1. **Linha principal compacta (sempre fixa)**
   - formato alvo: `colonies=<n> (run:<x> scout:<y> done:<z>)`.
   - sem listar IDs na linha principal.

2. **Painel dedicado toggleável para colônias**
   - comando proposto: `/cpanel off|on|auto|snapshot|status`.
   - `auto`: abrir quando `colonies > threshold` ou houver `failed|blocked`.
   - wrap automático por largura (sem truncar informação crítica).

3. **Overflow controlado**
   - mostrar top-N por recência/criticidade + linha `+N hidden`.
   - payload completo acessível por `/colony-pilot status` e `details`.

4. **Testes mínimos para essa fase**
   - smoke do parser/render do painel (wide/narrow terminal),
   - regressão do footer para não estourar em largura curta,
   - validação determinística (`vitest`, `node --test`, `verify-pi-stack`).

## Execução da fase (pós-compact) — painel de colônias v1

Status: **implementado e validado**.

### O que entrou

1. Nova extensão `packages/pi-stack/extensions/colony-panel.ts`:
   - comando `/cpanel off|on|auto|status|snapshot`;
   - modos `off|on|auto` com `autoOpenCountThreshold`;
   - rastreamento de `COLONY_SIGNAL` via `message_end`/`tool_result`;
   - painel com resumo (`tracked/live/run/scout/done/fail`) + chips `id:phase` com quebra automática;
   - overflow controlado com `+N hidden`.

2. Integração no footer:
   - `custom-footer` agora compõe painel de quota e painel de colônias (quando ativos),
   - mantendo linha principal compacta e movendo detalhes para painel dedicado.

3. Registro no manifesto do pacote:
   - `packages/pi-stack/package.json` inclui `./extensions/colony-panel.ts` antes do `custom-footer`.

4. Config workspace:
   - `.pi/settings.json` ganhou bloco:
     - `piStack.colonyPanel.mode = "auto"`
     - `piStack.colonyPanel.autoOpenCountThreshold = 4`
     - `piStack.colonyPanel.maxVisibleColonies = 8`

### Cobertura adicionada

- `packages/pi-stack/test/smoke/colony-panel.test.ts` (novo)
- `packages/pi-stack/test/smoke/custom-footer-registration.test.ts`
  - regressão para terminal estreito (re-truncation invariant).

### Validação determinística

- `npx vitest run` → **PASS (381/381)**
- `node --test packages/pi-stack/test/*.test.mjs` → **PASS (84/84)**
- `node scripts/verify-pi-stack.mjs` → **PASS (10/10)**

### Próxima parte recomendada

1. Web UI `/api/prompt`: e2e de token inválido + concorrência (followUp/steer).
2. Refinar heurística do `cpanel auto` (ex.: abrir por `failed|blocked` mesmo com live baixo).
3. Avaliar layout “cards” no web-session-gateway para múltiplas colônias com filtros.

## Hatch de conflito mitsupi/uv vs bg-process (pós-feedback de campo)

Status: **endereçado com patch determinístico + smoke dedicado**.

- `packages/pi-stack/install.mjs`
  - `FILTER_PATCHES` exportado;
  - novo helper puro `applyFilterPatchesToSettings(...)`;
  - merge de filtros agora é **aditivo e idempotente** (não perde customizações existentes);
  - garante exclusão `!pi-extensions/uv.ts` em `npm:mitsupi` para evitar colisão de tool/keybinding com `bg-process`.

- Novo teste: `packages/pi-stack/test/smoke/installer-filters.test.ts`
  - cobre conversão de entrada string para objeto filtrado,
  - cobre merge com filtros já existentes,
  - cobre idempotência (sem duplicar filtros),
  - cobre no-op quando `packages` não existe.

Validação rodada:

- `npx vitest run` → **PASS (385/385)**
- `node --test packages/pi-stack/test/*.test.mjs` → **PASS (84/84)**
- `node scripts/verify-pi-stack.mjs` → **PASS (10/10)**

## Nota estratégica (deferida): centralização first-party de capacidades hoje filtradas

Conforme feedback de campo, foi criada memória técnica para futuras seções sem desviar do marco atual:

- `docs/guides/first-party-assimilation-notes.md`
- indexado em `docs/guides/README.md`

Escopo do documento: registrar funcionalidades suprimidas por conflito (ex.: `mitsupi/uv.ts`, footer duplicado, skills colidentes) e critérios de promoção para first-party quando a base estiver estável.

## Parte B (Web UI prompt path) — avanço concluído

Status: **implementado e validado** para token inválido + concorrência.

- Arquivo: `packages/pi-stack/test/smoke/web-session-gateway-e2e-harness.test.ts`
  - novo teste: `"/api/prompt rejeita token inválido e aceita bursts concorrentes com token válido"`.
  - cobre:
    - `401` com token inválido,
    - burst concorrente de `POST /api/prompt` com token válido,
    - aceitação de `deliverAs` em `followUp` e `steer`.

Validação atualizada:

- `npx vitest run` → **PASS (386/386)**
- `node --test packages/pi-stack/test/*.test.mjs` → **PASS (84/84)**
- `node scripts/verify-pi-stack.mjs` → **PASS (10/10)**

### Próximo passo após este checkpoint

1. Refinar heurística do `cpanel auto` (abrir com `failed|blocked` mesmo com live baixo já é suportado; falta calibrar thresholds por perfil).
2. Evoluir layout de colônias para “cards” na Web UI (agrupamento por fase/filtro).

## Correção de warnings dos monitores (classify failed: "Instructions are required")

Status: **corrigido na origem + overrides locais alinhados**.

### Causa raiz

- `monitor-provider-patch` gerava agents YAML com template relativo incorreto:
  - antes: `template: <monitor>/classify.md`
  - correto: `template: ../monitors/<monitor>/classify.md`
- Resultado em runtime: prompt vazio para alguns classificadores (`fragility`, `commit-hygiene`), gerando erro `Instructions are required`.

### Ações aplicadas

1. `packages/pi-stack/extensions/monitor-provider-patch.ts`
   - `generateAgentYaml(...)` ajustado para usar `../monitors/<monitor>/classify.md`.
2. `packages/pi-stack/test/monitor-provider-patch.test.mjs`
   - expectativas atualizadas para o novo path.
3. `.pi/agents/*.agent.yaml`
   - overrides locais corrigidos para eliminar warnings imediatamente nesta workspace.

### Validação

- `node --test packages/pi-stack/test/monitor-provider-patch.test.mjs` → **PASS**
- `node --test packages/pi-stack/test/*.test.mjs` → **PASS (84/84)**
- `node scripts/verify-pi-stack.mjs` → **PASS (10/10)**

### Nota de UX/visibilidade (deferida)

- Registrar execução de classificadores como telemetria visível (estilo background/status panel) permanece como melhoria futura first-party para equilibrar economia + observabilidade.
