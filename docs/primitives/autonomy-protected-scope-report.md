# Autonomy Protected Scope Report (primitive)

## Objetivo

Explicar, em modo **report-only**, por que uma task foi classificada como `protected-scope` no seletor de lane autônoma.

## Surface

- Tool: `autonomy_lane_protected_scope_report`
- Fonte: `packages/pi-stack/extensions/guardrails-core-autonomy-task-selector.ts`

## Saída

Para cada task candidata (`planned`/`in-progress`), retorna:

- `protectedScope` (boolean)
- `primaryReasonCode` canônico (ou `local-safe`)
- `reasonCodes[]`
- `signals[]`
- `evidence[]` curta (origem + sinal + texto/arquivo)

Resumo agregado:

- total de `candidates`
- total `protected`
- total `localSafe`

## Invariantes

1. Sem mutação de board/tasks.
2. Sem dispatch/autorização implícita.
3. Diagnóstico curto para decisão humana e ajuste de heurística com baixo risco.
