# Board Dependency Hygiene Score (primitive)

## Objetivo

Oferecer um score único (0..100), **report-only**, para priorizar manutenção de dependências do board em runs local-safe.

## Surface

- Tool: `board_dependency_hygiene_score`
- Fonte: `packages/pi-stack/extensions/project-board-surface.ts`

## Dimensões

- `coupling` — penaliza acoplamento local-safe -> protected
- `consistency` — penaliza ciclos de dependência
- `traceability` — penaliza referências ausentes

## recommendationCode

- `board-dependency-hygiene-strong`
- `board-dependency-hygiene-needs-reconcile`
- `board-dependency-hygiene-critical-protected-coupling`

## Invariantes

- read-only/report-only
- sem mutação
- sem auto-dispatch
- summary curto com `score` e `code`
