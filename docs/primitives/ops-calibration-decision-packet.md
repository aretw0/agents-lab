# Ops Calibration Decision Packet (primitive)

## Objetivo

Compor os resultados de calibração de background process e agents-as-tools em um único packet report-only para decidir:

- `keep-report-only`
- `ready-for-bounded-rehearsal`

## Surface

- Tool: `ops_calibration_decision_packet`
- Fontes:
  - `packages/pi-stack/extensions/guardrails-core-ops-calibration.ts`
  - `packages/pi-stack/extensions/guardrails-core-ops-calibration-surface.ts`

## recommendationCode

- `ops-calibration-ready-bounded-rehearsal`
- `ops-calibration-keep-report-only-background`
- `ops-calibration-keep-report-only-agents`
- `ops-calibration-keep-report-only-threshold`
- `ops-calibration-keep-report-only-reload`

## Uso recomendado

1. calcular `background_process_readiness_score` (padrão por inferência bounded e, opcionalmente, com overrides `has_*` para contraste);
2. avaliar `background_process_rehearsal_gate` para confirmar evidências mínimas de rehearsal;
3. calcular `agents_as_tools_calibration_score`;
4. avaliar `evaluateAgentSpawnReadiness` (simple spawn bounded) para obter sinal de spawn readiness;
5. chamar `ops_calibration_decision_packet` com `live_reload_completed=true` para decisão consolidada.

O packet aplica o mesmo padrão de inferência bounded de background capabilities quando `has_*` não é informado, respeita overrides explícitos quando fornecidos e mantém `keep-report-only` enquanto o sinal de `background_process_rehearsal_gate` não estiver em `decision=ready`.

## Invariantes

- `dispatchAllowed=false`
- `authorization=none`
- sem start/stop de processo
- sem execução automática de agentes
