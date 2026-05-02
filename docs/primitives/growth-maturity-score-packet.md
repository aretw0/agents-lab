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

Integração recomendada:

1. executar `growth_maturity_score_packet`;
2. propagar o snapshot para `turn_boundary_decision_packet` (campos opcionais `*_score`, `debt_budget_ok`, `critical_blockers`);
3. usar `summary` compacto para registrar `go|hold|needs-evidence` no checkpoint.

## Exemplos rápidos

### A) Go (expansão bounded)

Entrada:

```json
{
  "safety_score": 90,
  "calibration_score": 88,
  "throughput_score": 86,
  "simplicity_score": 87,
  "debt_budget_ok": true,
  "critical_blockers": 0
}
```

Saída esperada (resumo):

`decision=go code=growth-maturity-go-expand-bounded`

### B) Hold (estabilização)

Entrada:

```json
{
  "safety_score": 78,
  "calibration_score": 75,
  "throughput_score": 72,
  "simplicity_score": 74,
  "debt_budget_ok": true,
  "critical_blockers": 0
}
```

Saída esperada (resumo):

`decision=hold code=growth-maturity-hold-maintain`

### C) Needs-evidence (fail-closed)

Entrada:

```json
{
  "safety_score": 90
}
```

Saída esperada (resumo):

`decision=needs-evidence code=growth-maturity-needs-evidence`
