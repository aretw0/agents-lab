# Board Dependency Health Snapshot (primitive)

## Objetivo

Fornecer uma leitura **report-only** da saúde de dependências do board, com foco em bloqueios canônicos:

- `missing-dependencies`
- `dependency-cycle`
- `local-safe-depends-on-protected`

## Surface

- Tool: `board_dependency_health_snapshot`
- Fonte: `packages/pi-stack/extensions/project-board-surface.ts`

## Parâmetros

- `milestone?`: filtra a amostragem para um milestone específico.
- `limit?`: limita linhas afetadas no payload (`rows`), padrão 20.

## Saída

- `metrics` com contagens de tarefas amostradas, tarefas com dependências e classes de bloqueio.
- `blockerTaskCounts` por classe (`missing`, `cycle`, `protectedCoupling`).
- `rows` com evidência compacta por task afetada.
- `recommendationCode` determinístico:
  - `board-dependency-health-strong`
  - `board-dependency-health-needs-reconcile`
  - `board-dependency-health-protected-coupling`

## Invariantes

- leitura somente (`report-only`)
- sem mutação de board
- sem auto-dispatch
- summary curto com `code=...` para triagem rápida
