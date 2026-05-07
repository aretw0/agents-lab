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

## Contrato complementar de agent run

A primitive `evaluateAgentSpawnReadiness` (exposta no runtime como `agent_spawn_readiness_gate`) cobre o próximo passo após calibração geral e exige, em modo report-only:

- exatamente 1 agente por execução;
- timeout explícito e bounded;
- cwd isolado explícito;
- budget explícito;
- rollback e escopo bounded conhecidos;
- reload confirmado para leitura live.

Decisão canônica:

- `ready-for-agent-run`
- `keep-report-only`

## Contrato complementar de agent run plan

A primitive `buildAgentRunPlan` (exposta no runtime como `agent_run_plan`) é o degrau L1 report-only antes de qualquer novo worker de uma fatia. Ela bloqueia quando faltam:

- objetivo de uma fatia;
- provider/model completo;
- cwd explícito;
- arquivos declarados;
- timeout curto e bounded;
- validação parent-side;
- rollback não destrutivo;
- budget;
- abort seguro;
- log/status bounded.

Mesmo no caminho verde, ela apenas retorna `ready-for-human-decision`; não autoriza dispatch.

## Registry upsert dry-first

A primitive `buildAgentRunRegistryUpsertPacket` (exposta como `agent_run_registry_upsert`) reduz scripts ad hoc para criar/atualizar `.pi/reports/agent-runs.json`.

Contrato:

- default `dry-run`, sem escrita;
- `dry_run=false` permite apenas upsert do registry;
- nunca inicia, para ou despacha processo;
- registra `runId`, `providerModelRef`, `cwd`, arquivos declarados, `logPath`, `state`, timestamps e `timeoutMs` quando informado.

## Outcome packet pós-run

A primitive `buildAgentRunOutcomePacket` (exposta como `agent_run_outcome_packet`) separa `processState` de `contractDecision` depois da run. Ela é report-only e compara:

- arquivos declarados no registry;
- arquivos tocados informados pelo parent/control-plane;
- resultados de marker checks;
- rollback sugerido para arquivos inesperados ou falhas de contrato.

Decisões canônicas:

- `contractDecision=pass`: processo completou, arquivos tocados batem com declarados e markers passaram;
- `contractDecision=partial`: faltam sinais parent-side, por exemplo `touched_files` não informado;
- `contractDecision=fail`: processo falhou/timeout, arquivo inesperado, arquivo declarado ausente ou marker falhou.

Isso evita tratar `completed` como sucesso quando o provider cria paths errados, como ocorreu no canary Dashscope.

## Invariantes

- report-only
- sem dispatch
- sem autorização implícita para execução de agente
