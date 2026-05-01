# Agents-as-Tools Calibration Score (primitive)

## Objetivo

Avaliar se a stack está calibrada para usar agentes como tools com governança, boundedness e observabilidade adequadas, em modo report-only.

## Surface

- Tool: `agents_as_tools_calibration_score`
- Fonte: `packages/pi-stack/extensions/guardrails-core-tool-hygiene.ts`

## Dimensões

- `governance` — budget guard, checkpoint discipline e proteção do cohort relevante de executores (long-run/protected), evitando falso negativo por ruído de tools subprocess genéricas
- `boundedness` — caminhos de dry-run/isolamento e baixa exposição de override manual
- `observability` — presença de packets/superfícies de leitura e scorecard

## recommendationCode

- `agents-as-tools-calibration-strong`
- `agents-as-tools-calibration-needs-governance`
- `agents-as-tools-calibration-needs-boundedness`
- `agents-as-tools-calibration-needs-observability`

## Contrato complementar de simple spawn

A primitive `evaluateAgentSpawnReadiness` cobre o próximo passo após calibração geral e exige, em modo report-only:

- exatamente 1 agente por execução;
- timeout explícito e bounded;
- cwd isolado explícito;
- budget explícito;
- rollback e escopo bounded conhecidos;
- reload confirmado para leitura live.

Decisão canônica:

- `ready-for-simple-spawn`
- `keep-report-only`

## Invariantes

- report-only
- sem dispatch
- sem autorização implícita para execução de agente
