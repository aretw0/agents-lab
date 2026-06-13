# External Influence Intake Template (target-agnostic, local-safe)

## Objetivo

Padronizar preparação **local-safe** antes de qualquer decisão de foco protected para pesquisa externa.

O template e target-agnostic: ele pode alimentar 0.8, releases futuras, pi-stack,
refarm ou agentes externos. A influencia entra como referencia curada; nao entra
como dependencia, runtime, recall implicito ou autorizacao de rede.

## Quando usar

Use quando uma influência externa (repo, artigo, framework, referência) surgir e a decisão ainda for `defer` ou incerta.

Use tambem quando uma referencia local ja assimilada precisar virar trabalho
worker-ready sem nova pesquisa externa.

## Template mínimo (copiar/preencher)

```md
### External influence intake
- influence_ref: <url/repo>
- target_scope: current-target|future-target|post-target|project-general
- intended_consumer: pi-stack|refarm|external-agent|docs-only|other
- hypothesis: <o que podemos aprender/aplicar>
- expected_value: high|medium|low + motivo curto
- risk_level: high|medium|low + motivo curto
- effort_level: high|medium|low + motivo curto
- local_safe_prework: <o que pode ser feito sem pesquisa externa ativa>
- protected_need: <por que exigirá foco protected, se exigir>
- applicable_patterns: [padrao1, padrao2]
- non_applicable_patterns: [padrao3]
- worker_suitable_slice:
  - objective: <tarefa pequena>
  - declared_files: [arquivo1, arquivo2]
  - expected_artifact: <path report-only>
  - file_contract: read-only|mutation
  - stop_conditions: [condição1, condição2]
- fan_in_contract:
  - required_outcomes: [outcome-id]
  - pass_when: <criterio parent-side>
  - block_when: [missing artifact, unexpected touched files, external execution]
- canary_scope_declared_files: [arquivo1, arquivo2]
- validation_gate: <teste/marker focal antes de promover>
- rollback_plan: <reversão não-destrutiva>
- stop_conditions: [condição1, condição2]
- non_goals: [release, publish, workflow dispatch, implicit recall]
- recommendation: promote|skip|defer
```

## Alinhamento com primitives existentes

- `autonomy_lane_protected_focus_packet`: usa `promote|skip|defer` e sinaliza valor/risco/esforço.
- `protected-canary-local-slice`: usa `declaredFiles`, `validationGate`, `rollbackPlan` e stop conditions.
- `agent_run_driver_step`: executa no maximo um step agnostico quando houver aprovacao estruturada.
- `board-next-scope-intake`: pode transformar referencias locais em candidatos report-only sem dispatch.
- `world-class-agentic-engineering-reference-map-2026-06`: define o contrato referencia -> intake -> trabalho local -> worker/outcome -> fan-in -> promocao.

## Invariantes

1. Intake é preparação; não executa pesquisa externa por si.
2. Intake não autoriza dispatch nem promoção automática.
3. Cada decisão de promote continua exigindo confirmação explícita do operador.
4. O campo `target_scope` nao autoriza release nem vincula a referencia a uma versao especifica.
5. Um `worker_suitable_slice` so pode ser executado por primitive agnostica com declared files e outcome parent-side.
6. `non_goals` deve listar explicitamente qualquer capacidade que a referencia nao prova.
