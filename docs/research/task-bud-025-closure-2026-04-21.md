# TASK-BUD-025 closure note — 2026-04-21

## Escopo
Fechamento do gate hard de execução quando provider budget estiver em `BLOCK` no fluxo `ant_colony/colony-pilot`, com override explícito e trilha auditável.

## Critérios de aceitação

### AC1 — Bloqueio antes de lançar ant_colony quando provider está BLOCK
- `evaluateProviderBudgetGate` no `colony-pilot` bloqueia execução quando provider considerado está em `blocked` e não há override.
- Cobertura em teste: `evaluateProviderBudgetGate bloqueia provider em BLOCK sem override`.

### AC2 — Override explícito auditável
- Policy suporta `allowProviderBudgetOverride` + token de override (`providerBudgetOverrideToken`, default `budget-override:`).
- Quando override é aceito, runtime registra trilha via `pi.appendEntry("colony-pilot.provider-budget-override", ...)`.
- Cobertura em teste: `evaluateProviderBudgetGate permite override auditável` (captura `overrideReason`).

### AC3 — Mensagem de bloqueio orienta ação corretiva
No bloqueio, mensagem inclui:
- ajustar budgets/uso no provider;
- usar override auditável (`budget-override:<motivo>`);
- inspecionar `/quota-visibility budget <provider> <days>`.

## Validação executada

```bash
node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts
```

Resultado: **65 passed**.

## Conclusão
Task atendida com enforcement hard no colony-pilot, override auditável explícito e orientação operacional de remediação no próprio bloqueio.
