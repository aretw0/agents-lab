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

## Extensão da wave — hard-intent AFK lane (TASK-BUD-557..562)

### Entregas concluídas até agora
- `TASK-BUD-557`: contrato runtime hard-intent para auto-advance (`focus-complete` -> sucessor local-safe), fail-closed em protected/risk/reload/validation.
- `TASK-BUD-558`: telemetry read-only `auto_advance_hard_intent_telemetry` no session-analytics (eligible vs blocked + reason codes).
- `TASK-BUD-559`: snapshot report-only `autonomy_lane_auto_advance_snapshot` com decisão determinística `eligible|blocked`.
- `TASK-BUD-560`: runbook AFK batch 3–5 fatias com stop conditions e rollback explícitos.
- `TASK-BUD-561`: `board_task_complete` com avanço automático de foco no handoff quando houver sucessor local-safe unívoco; fail-closed em ambiguidade.

### Regressão focal da extensão
Pack executado (115 testes verdes):
- `project-board-surface.test.ts`
- `autonomy-lane-surface.test.ts`
- `session-analytics.test.ts`
- `context-watchdog-continuation.test.ts`
- `control-plane-doc-checklist.test.ts`

### Gap final para encerramento
- Consolidar fechamento formal no board/research (`TASK-BUD-562`) com recomendação única de próxima promoção.

### Próxima promoção sugerida
- Avançar para **simple-delegate rehearsal** em modo bounded/local-safe, preservando `authorization=none` por default e decisão humana explícita para qualquer escopo protected.

## Wave simple-delegate rehearsal prep (TASK-BUD-563..567)

> Nota de linguagem operacional: nesta trilha, “AFK lane” substitui “night lane”. O objetivo é baixa iteração humana, não janela de horário.

### Entregas concluídas
- `TASK-BUD-563`: packet core composto para readiness de simple-delegate (`ready|needs-evidence|blocked`).
- `TASK-BUD-564`: surface read-only `simple_delegate_rehearsal_packet` com recommendationCode estável.
- `TASK-BUD-565`: gate operacional documentado (entrada/saída/rollback/stop conditions).
- `TASK-BUD-566`: regressão focal da wave executada e verde.

### Regressão focal da wave
Pack executado (58 testes verdes):
- `guardrails-ops-calibration.test.ts`
- `autonomy-lane-surface.test.ts`
- `session-analytics.test.ts`
- `control-plane-doc-checklist.test.ts`

### Decisão de fechamento
- Preparação concluída: a wave deixou o control-plane pronto para rehearsal simple-delegate **ainda em modo report-first/fail-closed**.
- Próxima ação recomendada: abrir uma fatia explícita de rehearsal real (bounded, 1 task), mantendo escopo protected sob decisão humana.

## Planejamento da próxima fatia (TASK-BUD-568)

Objetivo: rehearsal real de simple-delegate em **1 task bounded**, com start/abort/rollback explícitos e sem auto-dispatch.

### Checklist pré-voo (curto)
1. `simple_delegate_rehearsal_packet.decision == ready-for-human-decision|ready` (sem blockers críticos).
2. foco único no handoff (`current_tasks` com 1 task local-safe).
3. validação focal conhecida antes de editar.
4. rollback não-destrutivo declarado.

### Contrato de execução
- start continua **humano explícito**;
- execução bounded em 1 task;
- abort em qualquer blocker de protected/risk/reload/validation;
- checkpoint obrigatório ao final (sucesso ou abort).

### Checklist pós-voo (curto)
- decisão registrada (`go/no-go` para próxima fatia);
- blockers/evidências no board;
- handoff atualizado com próximo foco explícito.

## Fechamento da prep live-rehearsal (TASK-BUD-568..571)

### Entregas concluídas
- `TASK-BUD-568`: plano AFK/material-first para rehearsal real bounded.
- `TASK-BUD-569`: packet read-only `simple_delegate_rehearsal_start_packet` (`ready-for-human-decision|blocked`).
- `TASK-BUD-570`: runbook curto (start/monitor/abort/rollback/postflight) + template de checkpoint.
- `TASK-BUD-571`: regressão focal e decisão go/no-go explícita.

### Regressão focal
Pack executado (61 testes verdes):
- `guardrails-ops-calibration.test.ts`
- `autonomy-lane-surface.test.ts`
- `session-analytics.test.ts`
- `control-plane-doc-checklist.test.ts`

### Decisão go/no-go
- **go para decisão humana de start**: stack pronta para um rehearsal real bounded de 1 task, via packet de start read-only.
- **no-go para auto-start**: permanece proibido qualquer start automático; protected scope continua exigindo decisão humana explícita.
