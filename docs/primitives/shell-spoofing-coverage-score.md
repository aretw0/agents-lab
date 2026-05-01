# Shell Spoofing Coverage Score (primitive)

## Objetivo

Medir, em modo **report-only**, a cobertura anti-spoofing de variáveis shell com score único e recomendação de manutenção.

## Surface

- Tool: `shell_spoofing_coverage_score`
- Fonte: `packages/pi-stack/extensions/guardrails-core-shell-spoofing-score.ts`

## Dimensões

1. `policyCoverage`
2. `runtimePrevention`
3. `regressionCoverage`
4. `observabilityCoverage`

Saída inclui:

- `score` (0..100)
- `recommendationCode`:
  - `shell-spoofing-coverage-strong`
  - `shell-spoofing-coverage-gap-runtime`
  - `shell-spoofing-coverage-gap-regression`
  - `shell-spoofing-coverage-gap-observability`
  - `shell-spoofing-coverage-gap-policy`

## Invariantes

- `dispatchAllowed=false`
- `authorization=none`
- `mode` report-only (sem mutação e sem auto-dispatch)
