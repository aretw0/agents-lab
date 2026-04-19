# Unattended Swarm Execution Plan (OpenAI-only)

Data: 2026-04-19  
Escopo: execução por lotes dos P0 `TASK-BUD-010`, `TASK-BUD-020`, `TASK-BUD-024`, `TASK-BUD-026`, `TASK-BUD-029` com baixa interação humana.

## Princípios operacionais
- Um lote por vez (sem paralelismo de P0).
- `maxCost` explícito em toda colônia.
- Sem auto-close de P0.
- Sempre atualizar `.project/tasks.json` + mini-handoff de lote.

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
