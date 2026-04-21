# TASK-BUD-082 — closure (2026-04-21)

## Objetivo
Endurecer retenção de artefatos de colônia em terminal states (`failed`/`budget_exceeded`) para evitar perda prática de worktree sem evidência reaplicável.

## Entregas
- Runtime snapshot em terminal state no `colony-pilot`:
  - `packages/pi-stack/extensions/colony-pilot-candidate-retention.ts`
  - `packages/pi-stack/extensions/colony-pilot.ts`
- Retention record ampliado com:
  - `runtimeColonyId`
  - `runtimeSnapshotPath`
  - `runtimeSnapshotTaskCount`
  - `runtimeSnapshotMissingReason`
- Surface operacional (`colony_pilot_artifacts`/status) mostra caminho de recovery.
- Política documentada como `snapshot-first` (com exceção explícita de debug):
  - `docs/guides/unattended-swarm-execution-plan.md`
  - `docs/research/colony-worktree-retention-2026-04-21.md`

## Validação
- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-retention.test.ts packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`
  - Resultado: `2 passed`, `69 passed`

## Resultado por critério
1. Artefato reaplicável em `failed/budget_exceeded`: **atendido** (snapshot em `.pi/colony-retention/runtime-artifacts/`).
2. Caminho determinístico de recuperação no relatório/surface: **atendido** (`runtimeSnapshotPath` + `recovery:` em artifacts/status).
3. Policy de retenção vs cleanup: **atendido** (snapshot-first default; keep-worktree só debug explícito).
