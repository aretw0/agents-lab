# Growth Maturity Score Packet (primitive)

## Objetivo

Fornecer um packet **report-only** para decidir crescimento com sanidade em cada boundary, usando quatro dimensões explícitas:

- `safety`
- `calibration`
- `throughput`
- `simplicity`

## Surface

- Tool: `growth_maturity_score_packet`
- Fonte: `packages/pi-stack/extensions/guardrails-core-growth-maturity-surface.ts`

## Contrato de saída

- `decision`: `go | hold | needs-evidence`
- `recommendationCode` canônico
- `score` global (média das 4 dimensões quando completas)
- `dimensions.*` com `score` e `missing`
- `signals.debtBudgetOk`, `signals.criticalBlockers`
- `blockers[]`, `missingSignals[]`
- `summary` compacto

## Invariantes

- `reviewMode=read-only`
- `mutationAllowed=false`
- `dispatchAllowed=false`
- `authorization=none`
- `activation=none`

## Regra fail-closed

Se faltar qualquer dimensão obrigatória, a decisão padrão é:

- `decision=needs-evidence`
- `recommendationCode=growth-maturity-needs-evidence`

## Uso operacional sugerido

Rodar no turn boundary/checkpoint e registrar decisão no board/handoff antes de ampliar escopo.
