# Swarm Preflight 15m (execução curta)

Checklist rápido para iniciar um swarm sem estourar budget/contexto.

## 0-3 min — Estado e higiene
- `git status --short` (workspace limpo)
- confirmar task ativa no `.project/tasks.json`
- revisar `HANDOFF.md` (se sessão nova)

## 3-7 min — Governança de budget/provider
- `quota-visibility status 30`
- `quota-visibility budget 30`
- `quota-visibility route balanced`
- `handoff` **somente** se provider atual estiver WARN/BLOCK

## 7-10 min — Policy + delivery
- `/colony-pilot status`
- validar `modelPolicy` e `budgetPolicy`
- definir `maxCost` explícito para o run
- escolher delivery mode (`apply-to-branch` ou `patch-artifact`)

## 10-13 min — Contexto seguro
- quebrar objetivo em micro-lote (3-5 decisões)
- criar mini-handoff inicial com template:
  - `docs/guides/mini-handoff-template.md`

## 13-15 min — Go/No-Go
- **GO** se budget não bloqueado + policy ok + task ativa definida
- **NO-GO** se contexto em risco (2 ciclos sem decisão, >3 trilhas sem checkpoint, ou planejamento extenso sem mini-handoff)

## Evidência mínima pós-run
- inventário de arquivos alterados
- validação executada (test/verify/smoke)
- mini-handoff final + atualização no `.project/tasks.json`
