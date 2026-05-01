# Board Planning Clarity Score (primitive)

## Objetivo

Fornecer leitura **report-only** da clareza/direção de planejamento no board para evitar execução longa com plano frágil.

## Surface

- Tool: `board_planning_clarity_score`
- Implementação: `packages/pi-stack/extensions/project-board-surface.ts`

## Sinais avaliados

1. **Decomposição**: macro-tasks abertas com `depends_on` explícito.
2. **Verificabilidade**: tasks `in-progress` já ligadas a verificação.
3. **Foco**: quantidade de tasks simultâneas `in-progress`.
4. **Cobertura de rationale**: tasks sensíveis com rationale registrado.

## Saída canônica

- `score` (0..100)
- `recommendationCode`:
  - `planning-clarity-strong`
  - `planning-clarity-needs-decomposition`
  - `planning-clarity-needs-focus`
- `metrics` + `subScores`
- `summary` compacto (`board-planning-score: ...`)

## Invariantes

- Não cria/edita tasks.
- Não fecha task automaticamente.
- Não autoriza dispatch; apenas diagnóstico para decisão humana/operacional.
