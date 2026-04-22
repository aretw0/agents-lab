# Worktree -> Main Selective Promotion (Blueprint) — 2026-04-22

## Objetivo
Evitar promoção manual por reescrita quando uma run em worktree produzir mistura de mudanças válidas e deriva fora de escopo.

## Regra
- Declarar escopo da run (`docs-only` | `code-scope:<globs>`).
- Coletar diff da worktree no fim da execução.
- Promover automaticamente **apenas** arquivos permitidos por allowlist.
- Registrar `promoted[]` e `skipped[]` com motivo.

## Fluxo mínimo (advisory-first)
1. `scopePolicy` definido no launch.
2. `candidateDiff` listado no COMPLETE.
3. `promoted = candidateDiff ∩ allowlist(scopePolicy)`.
4. Se `promoted.length === 0`: fallback explícito para L2 (`recovery required`).
5. Se `promoted.length > 0`: aplicar promoção seletiva + evidência canônica.

## Evidência canônica obrigatória
- `Final file inventory` com arquivos promovidos.
- `Skipped file inventory` com motivo por arquivo.
- `Validation command log` com comandos em backticks.
- Nota no board (`tasks`/`verification`) sem auto-close estratégico.

## Fallback/rollback
- Qualquer conflito de escopo ou evidência incompleta => não promover pacote inteiro.
- Manter execução como `candidate/recovery required` e retornar a L2.
