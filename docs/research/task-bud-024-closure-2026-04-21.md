# TASK-BUD-024 closure note — 2026-04-21

## Escopo
Consolidação final do budget semanal por provider em `quota-visibility` com evidência em runtime + teste.

## Critérios de aceitação

### AC1 — Config aceita `providerBudgets` com cap absoluto ou percentual
Evidências:
- parser e avaliação de budgets cobertos em `packages/pi-stack/test/smoke/quota-visibility-parsers.test.ts`
- casos com share percentual e caps resolvidos (`periodTokensCap`, `periodCostUsdCap`, requests monthly)

### AC2 — `/quota-visibility budget` e tool equivalente retornam estado por provider
Evidências:
- command `quota-visibility` com subcomando `budget` registrado em `packages/pi-stack/extensions/quota-visibility.ts`
- tool equivalente `quota_visibility_provider_budgets` registrada e executada em runtime (retornando provider `openai-codex` com `state=ok` e percentuais)

### AC3 — status/export incluem avaliação por provider + warnings de alocação inválida
Evidências:
- runtime `quota_visibility_status` mostra `providerBudgetPolicy` e `providerBudgets`
- runtime `quota_visibility_export` gerou evidência em `.pi/reports/quota-visibility-*.json`
- teste novo de regressão confirma warning quando shares >100%:
  - `buildProviderBudgetStatuses alerta quando shares excedem 100%`
  - valida presença de `shareTokensPct soma ... (>100%)`

## Execução de validação

```bash
# runtime evidence
quota_visibility_provider_budgets(days=14)
quota_visibility_status(days=14)
quota_visibility_export(days=14)

# test evidence
node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/quota-visibility-parsers.test.ts
```

Resultado do teste: **30 passed**.

## Conclusão
TASK-BUD-024 atendida com cobertura de parser/eval + superfícies runtime (`status`, `budget`, `export`) e proteção explícita para warnings de alocação inválida.
