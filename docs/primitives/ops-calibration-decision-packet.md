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

## Invariantes

- `dispatchAllowed=false`
- `authorization=none`
- sem start/stop de processo
- sem execução automática de agentes
