# Control-plane Delegation Wave — 2026-05

## Objetivo
Evoluir o control-plane para **delegar mais e executar menos**, mantendo:
- qualidade de entrega (smoke/checkpoint/verificação);
- controle operacional (fail-closed, authorization=none por padrão);
- diversidade de delegação (não concentrar tudo em um único modo).

## Escopo local-safe (hard boundary)
- Sem auto-dispatch em escopos protected.
- Sem scheduler/remote/CI/offload automático.
- Sem mutação destrutiva de manutenção git.
- Todas as novas superfícies desta wave são report-only/read-only por padrão.

## Métricas de sucesso da wave
1. **Delegation ratio** (medido): crescimento de decisões preparadas para delegação vs execução manual direta.
2. **Qualidade**: smoke focal verde por slice + evidência no board.
3. **Controle**: nenhum bypass de `authorization=none` e nenhum auto-dispatch protegido.
4. **Freshness**: decisões usando sinais canônicos (`preloadDecision`, `dirtySignal`) sem releitura ampla.

## Sequência de primitivas (TASK-BUD-544..549)
1. `TASK-BUD-544` — charter, limites e critérios.
2. `TASK-BUD-545` — `delegation_lane_capability_snapshot` (snapshot único de sinais).
3. `TASK-BUD-546` — `delegation_mix_score` (telemetria de diversidade).
4. `TASK-BUD-547` — `delegate_or_execute_decision_packet` (recomendação determinística).
5. `TASK-BUD-548` — runbook de operação por estágio (local-safe -> simple delegate -> swarm rehearsal).
6. `TASK-BUD-549` — regressões/checklist de saída da wave.

## Contrato de promoção por estágio
- **Estágio A (local-safe):** somente report-only/read-only + checkpoints curtos.
- **Estágio B (simple delegate):** permitido apenas quando snapshot + mix + packet estiverem verdes e com blockers vazios.
- **Estágio C (swarm rehearsal):** somente após evidência estável de B; ainda com decisão humana explícita para protected.

## Checklist por slice
- [ ] task ativa única (WIP=1)
- [ ] validação focal executada
- [ ] verificação anexada no board
- [ ] commit curto com escopo claro
- [ ] checkpoint/handoff atualizado

## Riscos conhecidos
- Overfitting em um único modo de delegação (baixa diversidade).
- Regressão de contrato por duplicação de lógica entre surfaces.
- Ruído operacional (mensagens cruas) confundindo diagnóstico de readiness.

## Mitigação
- Helpers compartilhados para sinais críticos.
- Tooling de snapshot/packet com recommendationCode estável.
- Smoke dedicado por wave + marker anchors de contrato.

## Fechamento da wave (TASK-BUD-549)

### Entregas concluídas
- `TASK-BUD-545`: `delegation_lane_capability_snapshot` (read-only, decisão `ready|needs-evidence|blocked`).
- `TASK-BUD-546`: `delegation_mix_score` (mix `local/manual/simple-delegate/swarm` com recommendationCode).
- `TASK-BUD-547`: `delegate_or_execute_decision_packet` (recomendação `local-execute|simple-delegate|defer`, fail-closed).
- `TASK-BUD-548`: runbook staged documentado na doutrina e no playbook operacional.

### Regressão focal da wave
Pack executado (57 testes verdes):
- `autonomy-lane-readiness.test.ts`
- `autonomy-lane-surface.test.ts`
- `session-analytics.test.ts`
- `guardrails-ops-calibration.test.ts`
- `control-plane-doc-checklist.test.ts`

### Checklist de saída
- [x] task ativa única por fatia (WIP=1)
- [x] validação focal por fatia
- [x] verificação no board para tasks da wave
- [x] commit curto por fatia
- [x] checkpoint/handoff atualizado por avanço de foco

### Gaps remanescentes
- O auto-advance entre tasks ainda depende de regra operacional (soft) nesta sessão.
- Hardening planejado: `TASK-BUD-557` para elevar auto-advance para contrato hard-intent runtime/fail-closed.

### Recomendação de continuidade
- Manter execução local-safe em fatias bounded.
- Tratar `TASK-BUD-557` como próxima prioridade de governança para remover dependência de soft intent na continuidade noturna.
