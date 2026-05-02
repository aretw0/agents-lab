# Control-plane decoupling lane (2026-05)

Task: `TASK-BUD-637`  
Objetivo: aumentar throughput contínuo e reduzir dependência de intervenção manual sem abrir mão de governança local-first.

## Sequência operacional (3 fases)

## Fase 1 — Stabilize

Meta: manter execução contínua local-safe com baixa interrupção.

Foco:
- slices pequenas e reversíveis;
- checkpoint curto por slice;
- foco único no board/handoff.

KPIs:
- taxa de retomada correta >= 90%;
- blocked-rate por motivos não protegidos <= 15%;
- handoff com 1 foco principal + próximos passos claros.

Gate para avançar:
- 3+ slices consecutivas verdes (validação focal + checkpoint + commit).

Rollback:
- se blocked-rate subir ou foco degradar, voltar para micro-slices e reduzir paralelismo.

## Fase 2 — Delegate

Meta: aumentar execução via delegação bounded sem perder auditabilidade.

Foco:
- usar decisão execute-vs-delegate com evidência;
- delegar apenas tasks locais com gate conhecido;
- manter protected lane sempre opt-in humano.

KPIs:
- mix de delegação (simple-delegate/swarm) >= 25% sem aumento de falhas;
- falhas de governança (protected/risk) = 0;
- tempo médio por fatia reduzido vs baseline da fase 1.

Gate para avançar:
- 2 ciclos semanais com tendência de throughput positiva e sem regressão de qualidade.

Rollback:
- se falhas de governança > 0 ou bloqueio recorrente, retornar ao perfil stabilize.

## Fase 3 — Decouple

Meta: operar lote 3–5 fatias com pouca intervenção, mantendo stop contracts explícitos.

Foco:
- batch local-safe com continuidade auditável;
- decisões predefinidas de continue/pause/ask-human;
- uso de métricas para ajustar lane em vez de feeling.

KPIs:
- >= 3 fatias úteis por janela sem nudge manual;
- custo/token por fatia estável ou melhorando;
- taxa de regressão de foco <= 5%.

Gate de manutenção:
- preservar invariantes: no auto-dispatch protegido, verificação antes de completion, rollback conhecido.

Rollback:
- qualquer violação de invariant retorna imediatamente para fase 1.

## Regras de avanço (hard gates)

1. Sem violação de escopo protegido.
2. Sem regressão de verificação canônica (`verification` passed por task concluída).
3. Sem perda de rastreabilidade (board + handoff atualizados).
4. Sem aumento de ruído operacional que oculte decisão/next step.

## Runbook de lote local-safe (3–5 fatias)

### Preflight
1. confirmar foco e próximo elegível (`autonomy_lane_next_task`);
2. confirmar gate de contexto/máquina em nível `ok|warn-controlado`;
3. declarar validação focal por fatia antes de editar.

### Ordem recomendada
1. fatia 1: ajuste mínimo + validação focal + commit;
2. fatia 2-4: repetir somente se próximo passo permanecer local-safe/reversível;
3. fatia 5 (opcional): apenas se não houver sinais de risco/ambiguidade.

### Stop contracts (parada imediata)
- `stop: protected`;
- `stop: risk`;
- `stop: reload-required`;
- `stop: validation-failed-or-unknown`;
- `stop: no-eligible-local-safe-successor`.

### Rollback por fatia
- código: `git revert <commit>` ou restore focal;
- board/handoff: registrar blocker curto + motivo da reversão;
- decisão: retomar somente após gate focal voltar a verde.

### Template de checkpoint curto

```text
slice=<n> focus=<task> gate=<comando-ou-inspeção> commit=<sha>
stopContracts=protected|risk|reload|required|validation-failed|no-successor
next=<ação explícita> rollback=<plano curto>
```

## Próximas tarefas da lane

- `TASK-BUD-638`: relatório local de maturidade (stabilize|delegate|decouple).
- `TASK-BUD-639`: runbook de lote local-safe 3–5 fatias com stop contracts.

## Nota de equilíbrio

A ordem continua: **limpeza relevante -> pesquisa dirigida -> escalabilidade com controle**.
Escalar sem esse equilíbrio gera dívida operacional e reintroduz dependência do control-plane para correção contínua.
