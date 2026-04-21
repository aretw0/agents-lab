# Control-plane loop run (L2) — 2026-04-21

## Objetivo
Ir além no mesmo ciclo sem abrir infraestrutura nova, validando governança por composição de primitivas já estáveis.

## Checks executados

1. `subagent_readiness_status(strict=true, source=isolated, days=7, limit=10)`
   - `ready=false`
   - bloqueios: `monitor-min-user-turns` (2/3), `minCompleteSignals` (0/1)

2. `subagent_readiness_status(strict=true, source=global, days=7, limit=20)`
   - `ready=false`
   - positivos: user turns altos + `COMPLETE` presente
   - bloqueios por histórico: classify failures (2), FAILED (2), BUDGET_EXCEEDED (1)

3. `subagent_readiness_status(source=isolated, minUserTurns=2, days=1, limit=1)`
   - `ready=true`
   - leitura operacional de continuidade no runtime atual

4. `session_analytics_query(signals, 24h)`
   - evidenciou `COMPLETE` em sessões recentes (71 no agregado analisado)
   - confirma que ausência em `isolated/strict` é efeito de janela/fonte, não de inexistência total de sinais.

## Decisão operacional

Adotar **duas pistas de gate** no control plane:

- **Operational GO (isolated/warm):** continuidade de loop supervisionado.
- **Strict GO (global/history):** promoção para autonomia forte.

## Implicações

- Evita falso bloqueio de cold start no runtime isolado.
- Evita liberar autonomia agressiva sem considerar histórico de falhas.
- Mantém governança explícita e auditável em `.project`.
