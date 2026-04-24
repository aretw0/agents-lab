# TASK-BUD-145 — Contrato para mutação segura de arquivo grande + consultas estruturadas

Data: 2026-04-24  
Status: design slice (sem alteração de runtime neste passo)

## Problema
Em arquivos grandes e consultas estruturadas (ex.: SQL), edição/string ad-hoc aumenta risco de:
- corrupção parcial,
- mudanças fora de escopo,
- diffs difíceis de revisar,
- regressão silenciosa por falta de preflight/rollback.

## Objetivo
Definir uma superfície determinística para operações de alto risco com:
1. **dry-first**,
2. **patch tipado**,
3. **preflight explícito**,
4. **rollback verificável**,
5. **evidência auditável**.

---

## Superfície proposta (fase 1)

### 1) `safe_mutate_large_file`
Operação orientada a blocos/âncoras (não substituição textual ampla cega).

Entrada:
- `path`: string
- `operation`: `replace-block | insert-after-anchor | insert-before-anchor | remove-block`
- `anchor`: objeto tipado (ex.: `id`, `heading`, `jsonPath`, `regex` restrito)
- `payload`: conteúdo novo (quando aplicável)
- `dryRun`: boolean (default `true`)
- `maxTouchedLines`: number (guardrail)

Saída:
- `applied`: boolean
- `changed`: boolean
- `touchedLines`: number
- `preview`: diff resumido
- `rollbackToken`: id/hash para reversão
- `reason`: motivo em caso de não aplicação

### 2) `structured_query_plan`
Planejamento/normalização de query estruturada sem executar implicitamente.

Entrada:
- `dialect`: `postgres|mysql|sqlite|generic`
- `intent`: string curta
- `constraints`: limites tipados (tables allowlist, maxRows, forbidMutation etc.)
- `dryRun`: boolean (default `true`)

Saída:
- `normalizedQuery`: string
- `parameters`: lista tipada
- `safetyChecks`: lista de checagens aplicadas
- `riskLevel`: `low|medium|high`
- `reason`: quando bloqueado

---

## Guardrails obrigatórios
- **No apply sem preview**: `dryRun=true` default.
- **Blast radius cap**: bloquear se `touchedLines` > limite configurado.
- **Anchor validation**: falha explícita se âncora for ambígua ou ausente.
- **Query policy**: negar mutação (`INSERT/UPDATE/DELETE/DDL`) quando `forbidMutation=true`.
- **Evidence trail**: registrar input normalizado + decisão + output + limites aplicados.

## Matriz de decisão (operacional)

### `safe_mutate_large_file`
- `risk=low`: `touchedLines <= 40` e âncora única -> `apply` permitido (ainda com preview obrigatório).
- `risk=medium`: `41..120` linhas -> `apply` apenas com confirmação explícita.
- `risk=high`: `>120` linhas ou âncora ambígua -> bloquear e pedir split por blocos.

### `structured_query_plan`
- `risk=low`: `SELECT` com tables allowlist + limite de linhas.
- `risk=medium`: joins amplos/subqueries sem índice conhecido -> gerar plano + recomendação de limite.
- `risk=high`: mutação (`INSERT/UPDATE/DELETE/DDL`) com `forbidMutation=true` -> bloquear com razão canônica.

## Exemplos de saída canônica

```json
{
  "applied": false,
  "changed": false,
  "riskLevel": "high",
  "reason": "blocked: blast-radius-exceeded",
  "touchedLines": 184,
  "maxTouchedLines": 120,
  "rollbackToken": null
}
```

```json
{
  "normalizedQuery": "SELECT id, status FROM tasks WHERE status = $1 ORDER BY id LIMIT $2",
  "parameters": ["planned", 50],
  "riskLevel": "low",
  "safetyChecks": ["allowlist-ok", "limit-present", "mutation-forbidden-ok"]
}
```

## Rollback mínimo
Para mutação aplicada:
- `rollbackToken` + hash anterior do alvo,
- inventário de blocos tocados,
- comando/procedimento canônico de reversão.

## Critérios de rollout

### Fase A (atual)
- contrato documentado + integração no runbook.

### Fase B
- wrappers first-party (tool/command) com payload tipado.

### Fase C
- integração com policy do guardrails-core para enforcement progressivo (advisory -> strict por perfil).

## Relação com TASK-BUD-144
TASK-BUD-144 cobre macro-operações de refactor recorrente.  
TASK-BUD-145 cobre operações de maior risco (arquivo grande/query), reaproveitando os mesmos princípios: dry-first, audit e rollback.
