# External Influence Intake Template (local-safe)

## Objetivo

Padronizar preparação **local-safe** antes de qualquer decisão de foco protected para pesquisa externa.

## Quando usar

Use quando uma influência externa (repo, artigo, framework, referência) surgir e a decisão ainda for `defer` ou incerta.

## Template mínimo (copiar/preencher)

```md
### External influence intake
- influence_ref: <url/repo>
- hypothesis: <o que podemos aprender/aplicar>
- expected_value: high|medium|low + motivo curto
- risk_level: high|medium|low + motivo curto
- effort_level: high|medium|low + motivo curto
- local_safe_prework: <o que pode ser feito sem pesquisa externa ativa>
- protected_need: <por que exigirá foco protected, se exigir>
- canary_scope_declared_files: [arquivo1, arquivo2]
- validation_gate: <teste/marker focal antes de promover>
- rollback_plan: <reversão não-destrutiva>
- stop_conditions: [condição1, condição2]
- recommendation: promote|skip|defer
```

## Alinhamento com primitives existentes

- `autonomy_lane_protected_focus_packet`: usa `promote|skip|defer` e sinaliza valor/risco/esforço.
- `protected-canary-one-slice`: usa `declaredFiles`, `validationGate`, `rollbackPlan` e stop conditions.

## Invariantes

1. Intake é preparação; não executa pesquisa externa por si.
2. Intake não autoriza dispatch nem promoção automática.
3. Cada decisão de promote continua exigindo confirmação humana explícita.
