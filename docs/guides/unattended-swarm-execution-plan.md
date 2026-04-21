# Unattended Swarm Execution Plan (OpenAI-only)

Data: 2026-04-19  
Escopo: execução por lotes dos P0 `TASK-BUD-010`, `TASK-BUD-020`, `TASK-BUD-024`, `TASK-BUD-026`, `TASK-BUD-029` com baixa interação humana.

## Princípios operacionais
- Um lote por vez (sem paralelismo de P0).
- `maxCost` explícito em toda colônia.
- Sem auto-close de P0.
- Sempre atualizar `.project/tasks.json` + mini-handoff de lote.
- Spark-aware: default em cota normal; `gpt-5.3-codex-spark` só com gatilho explícito (`planning recovery` ou `scout burst`).

## Ordem recomendada (com dependências reais)
1. **Lote A — TASK-BUD-010** (single-writer/reconciler).
2. **Lote B — TASK-BUD-020 + TASK-BUD-024** (triage + budget semanal por provider).
3. **Lote C — TASK-BUD-025 (unlock) + TASK-BUD-026** (gate hard + governor global).
4. **Lote D — TASK-BUD-027 (unlock) + TASK-BUD-029** (routing advisor + RC de governança).

## Go / No-Go por lote
### GO
- `git status` limpo.
- provider ativo = `openai-codex`.
- budget em estado `ok`.
- task alvo marcada `in-progress` no board.

### NO-GO
- board inconsistente/JSON inválido.
- budget block/hard gate ativo.
- colônia anterior sem consolidação em docs + board.

## Comandos mínimos por lote
1. Preflight:
   - `quota-visibility status 30`
   - `quota-visibility route balanced`
   - `colony-pilot preflight`
   - confirmar goal semântico do lote (se houver Spark): incluir trigger explícito e justificativa auditável.
2. Execução:
   - `ant_colony` com goal estrito + `maxCost` (3 a 10 USD conforme lote).
3. Pós-run:
   - consolidar mini-handoff em `docs/research/`
   - atualizar notas no `.project/tasks.json`

## Checklist de evidência e rollback
- Evidência mínima:
  - arquivos alterados,
  - resultado de validação,
  - próximos 3 passos.
- Rollback:
  - manter commits por lote,
  - reversão via `git revert` do lote,
  - reabrir task no board com motivo explícito.

## Retenção pós-falha (`failed` / `budget_exceeded`)
- Em terminal state com worktree isolada, o runtime pode remover worktree/branch no cleanup.
- O control-plane deve persistir snapshot reaplicável em:
  - `.pi/colony-retention/runtime-artifacts/<colony-id>.runtime-snapshot.json`
- O registro canônico de retenção (`.pi/colony-retention/<colony-id>.json`) deve apontar para o campo `runtimeSnapshotPath`.
- Política operacional (snapshot-first):
  - default: cleanup imediato da worktree + retenção por snapshot reaplicável;
  - exceção: `keep-worktree-on-failure` apenas em debug explícito e temporário.
- Fluxo de recuperação mínimo:
  1. `colony_pilot_artifacts` para localizar o retention record.
  2. Abrir `runtimeSnapshotPath` e usar `workspace.branch/worktreeRoot` + tarefas capturadas para promoção manual determinística.
  3. Atualizar `.project/tasks.json` com nota de recovery (sem auto-close).

## Template determinístico de evidência (delivery-policy friendly)
Use este trecho no resumo final da execução para evitar falso negativo no parser:

```md
Final file inventory:
- packages/pi-stack/extensions/colony-pilot.ts
- packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts

Validation command log:
- /mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts
- /mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-retention.test.ts
```

Regras:
- manter heading explícito `Final file inventory` + `Validation command log`;
- cada comando em linha própria (`- <comando>`), com caminho real executável;
- manter coerência com comandos realmente executados no slice.

