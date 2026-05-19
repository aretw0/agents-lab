# Autonomy Protected Focus Packet (primitive)

## Objetivo

Padronizar decisão do operador para uma task de escopo protegido via packet **report-only** (`promote | skip | defer`) com sinais de valor/risco/esforço e evidência mínima.

## Surface

- Tool: `autonomy_lane_protected_focus_packet`
- Fonte: `packages/pi-stack/extensions/guardrails-core-autonomy-task-selector.ts`

## Saída esperada

- `decision`: `ready-for-operator-decision | blocked`
- `recommendedOption`: `promote | skip | defer`
- `recommendationCode` canônico
- `decisionPreview.recommendedOption` + `decisionPreview.options[]` (preview de decisão `promote|skip|defer` com `suitability`, `blockers`, `nextAction`)
- `decisionPreview.operatorRecommendation` (síntese direta para decisão do operador)
- `valuePotential`, `riskLevel`, `effortLevel`
- `reasonCodes[]`, `signals[]`, `evidence[]`
- `declaredFilesKnown`, `validationGateKnown`, `rollbackPlanKnown`
- `blockers[]`

## Invariantes

- `reviewMode=read-only`
- `mutationAllowed=false`
- `dispatchAllowed=false`
- `authorization=none`
- `mode=report-only`

Packet verde não autoriza execução protected automática; ele só prepara decisão auditável do operador.

Resumo compacto esperado inclui preview das opções, por exemplo:
- `preview=promote:blocked,skip:viable,defer:recommended`.
