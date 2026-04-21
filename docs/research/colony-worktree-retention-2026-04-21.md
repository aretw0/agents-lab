# Colony worktree retention — 2026-04-21

## Problema confirmado
Em colônias com workspace isolada (worktree), terminal states como `failed` e `budget_exceeded` podem encerrar com cleanup que remove `worktreeRoot` e branch temporária. Isso deixa o relatório com path histórico, mas sem diretório vivo para inspeção posterior.

## Mitigação implementada (short-term patch)
Escopo: `packages/pi-stack/extensions/colony-pilot*`

1. Ao receber `COLONY_SIGNAL` terminal em `failed|budget_exceeded`, o `colony-pilot` tenta capturar snapshot do runtime no mirror da colônia.
2. Snapshot é persistido em:
   - `.pi/colony-retention/runtime-artifacts/<colony-id>.runtime-snapshot.json`
3. Retention record passa a incluir:
   - `runtimeColonyId`
   - `runtimeSnapshotPath`
   - `runtimeSnapshotTaskCount`
   - `runtimeSnapshotMissingReason` (quando não foi possível capturar)
4. `colony_pilot_artifacts`/status exibem caminho de recovery (`recovery:`) quando disponível.

## Conteúdo do snapshot
- metadados da colônia (status/goal/maxCost/metrics)
- `workspace` (branch/worktreeRoot/etc.)
- estado e tarefas capturadas (com `resultExcerpt`/`errorExcerpt`)
- origem do snapshot (`mirrorRoot`, `statePath`, `tasksDir`)

## Limites conhecidos
- Snapshot é evidência reaplicável para promoção manual; não substitui recovery fully-automatic.
- Se o mirror não contiver `state.json` compatível, o retention record marca `runtimeSnapshotMissingReason`.

## Política atual
- Estratégia adotada no patch: **snapshot-first**.
- Worktree não é preservada por padrão em terminal state; a recuperação parte do snapshot canônico.
- Preservar worktree fica restrito a debug explícito/temporário (`keep-worktree-on-failure`).

## Próximo passo (first-party)
Evoluir de snapshot passivo para fluxo first-party de recovery (apply assistido), incluindo comando dedicado de promoção/rehydration com trilha auditável no board canônico.
