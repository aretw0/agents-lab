# Cleanup+Research Regression Pack — 2026-05-01

## Escopo

Validação curta da estabilidade dos contratos recém-adicionados na lane `cleanup-research-longrun`:

1. semeadura visível (`lane_brainstorm_seed_preview`),
2. captura de tangente aprovada (proveniência explícita),
3. score report-only de clareza de planejamento (`board_planning_clarity_score`).

## Cobertura mínima

- **caso bom**: score de clareza forte com recomendação de continuidade bounded;
- **caso simplista**: macro-task sem dependências aciona `planning-clarity-needs-decomposition`;
- **caso tangente aprovada**: task criada com `[provenance:tangent-approved]` + `source_task=...`.

## Comandos

- `npx vitest run packages/pi-stack/test/smoke/project-board-surface.test.ts packages/pi-stack/test/smoke/lane-brainstorm-packet.test.ts packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts`

## Invariantes preservados

- `recommendationCode` e `nextAction` presentes no preview de semeadura;
- `dispatchAllowed=false`, `mutationAllowed=false`, `authorization=none`;
- score de planejamento é diagnóstico (report-only), sem materialização automática.
