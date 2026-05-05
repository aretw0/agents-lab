# Agents-as-Tools Calibration Score (primitive)

## Objetivo

Avaliar se a stack está calibrada para usar agentes como tools com governança, boundedness e observabilidade adequadas, em modo report-only.

## Surface

- Tool: `agents_as_tools_calibration_score`
- Tool complementar: `line_budget_snapshot` (report-only para orçamento de linhas em `packages/pi-stack/extensions/*.ts`)
- Fonte: `packages/pi-stack/extensions/guardrails-core-tool-hygiene.ts`

## Line budget snapshot (anti-bloat)

`line_budget_snapshot` expõe recomendação estável `ok|watch|extract` para arquivos acima do budget faseado (watch/extract/critical), sem mutação e sem dispatch.

Campos principais:

- `recommendation`: `ok | watch | extract`
- `thresholds`: `watch=1000`, `extract=1400`, `critical=2000` (defaults)
- `totals`: contagem escaneada e acima de cada faixa
- `rows`: top arquivos acima do budget com `phase`, `overBy` e `riskFlags`
- `blockers/risks`: sinais curtos para priorizar wave de extração

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

A primitive `evaluateAgentSpawnReadiness` (exposta no runtime como `agent_spawn_readiness_gate`) cobre o próximo passo após calibração geral e exige, em modo report-only:

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
