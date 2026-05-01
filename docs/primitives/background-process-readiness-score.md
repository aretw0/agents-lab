# Background Process Readiness Score (primitive)

## Objetivo

Medir prontidão de maturidade para evoluir de planejamento read-only de background process para contratos operacionais, sem autorizar execução.

## Surface

- Tool: `background_process_readiness_score`
- Fonte: `packages/pi-stack/extensions/guardrails-core-background-process.ts`

## Dimensões

- `capabilities` — cobertura de capacidades-base (registry, lease, log tail, stacktrace, healthcheck, graceful stop, cleanup)
- `surfaceWiring` — presença das surfaces de plano e lifecycle
- `operationalEvidence` — evidência de rehearsal e cobertura de `stopSource`

## recommendationCode

- `background-process-readiness-strong`
- `background-process-readiness-needs-capabilities`
- `background-process-readiness-needs-evidence`
- `background-process-readiness-needs-surface-wiring`

## Inferência e override

Quando parâmetros `has_*` não são fornecidos, a surface aplica inferência bounded a partir das tools disponíveis (ex.: `bg_status` sinaliza evidência de registry/log tail/stop controlado). Parâmetros explícitos sempre têm precedência sobre inferência.

## Invariantes

- `dispatchAllowed=false`
- `authorization=none`
- sem start/stop/restart real de processos
