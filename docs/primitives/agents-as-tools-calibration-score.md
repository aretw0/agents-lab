# Agents-as-Tools Calibration Score (primitive)

## Objetivo

Avaliar se a stack está calibrada para usar agentes como tools com governança, boundedness e observabilidade adequadas, em modo report-only.

## Surface

- Tool: `agents_as_tools_calibration_score`
- Fonte: `packages/pi-stack/extensions/guardrails-core-tool-hygiene.ts`

## Dimensões

- `governance` — budget guard, checkpoint discipline e proteção de executores
- `boundedness` — caminhos de dry-run/isolamento e baixa exposição de override manual
- `observability` — presença de packets/superfícies de leitura e scorecard

## recommendationCode

- `agents-as-tools-calibration-strong`
- `agents-as-tools-calibration-needs-governance`
- `agents-as-tools-calibration-needs-boundedness`
- `agents-as-tools-calibration-needs-observability`

## Invariantes

- report-only
- sem dispatch
- sem autorização implícita para execução de agente
