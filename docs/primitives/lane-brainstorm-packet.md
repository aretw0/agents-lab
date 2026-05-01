# lane_brainstorm_packet (read-only)

Status: proposta local-first para `TASK-BUD-437`.

Objetivo: transformar brainstorming em insumo operacional de lane, com priorização e fatias sugeridas, sem executar mudanças.

## Invariantes

- `dispatchAllowed=false`
- `mutationAllowed=false`
- `authorization=none`
- `mode=report-only`
- sem stage/commit/apply/scheduler/remote/offload

## Entrada (schema conceitual)

```json
{
  "goal": "reduzir gordura e manter lane produtiva",
  "constraints": {
    "localFirst": true,
    "protectedAutoSelect": false,
    "maxSlices": 5,
    "maxIdeas": 12
  },
  "boardSnapshot": {
    "candidateTasks": ["TASK-BUD-437", "TASK-BUD-438"],
    "blockedCount": 3,
    "protectedCount": 7
  },
  "signals": {
    "recommendationCode": "local-stop-protected-focus-required",
    "nextAction": "request explicit focus or create local-safe task"
  }
}
```

Campos mínimos:

- `goal` (string curta)
- `constraints.localFirst` (boolean)
- `constraints.maxSlices` (1..5)
- `constraints.maxIdeas` (1..12)
- `boardSnapshot` (resumo bounded)

## Saída (schema conceitual)

```json
{
  "decision": "ready-for-human-review",
  "recommendationCode": "seed-local-safe-lane",
  "nextAction": "materialize top 3 slices as board tasks",
  "ideas": [
    {
      "id": "idea-1",
      "theme": "dedupe semantics",
      "value": "high",
      "risk": "low",
      "effort": "small"
    }
  ],
  "selectedSlices": [
    {
      "id": "slice-1",
      "title": "centralize local-stop guidance",
      "acceptance": ["smoke green", "no scope expansion"],
      "rollback": "git revert commit"
    }
  ],
  "dispatchAllowed": false,
  "mutationAllowed": false,
  "authorization": "none",
  "mode": "report-only"
}
```

## Decision codes sugeridos

- `seed-local-safe-lane`
- `continue-existing-lane`
- `refresh-focus-checkpoint`
- `needs-human-focus-protected`
- `stop-no-local-safe`

## Semeadura visível (preview-only)

Quando houver slices candidatos, a semeadura deve passar por preview explícito (`lane_brainstorm_seed_preview`), sem criar tasks automaticamente.

Saída esperada do preview:

- `decision=needs-human-seeding-decision` ou `blocked`;
- `recommendationCode=brainstorm-seeding-preview|brainstorm-seeding-blocked`;
- `confirmationRequired=true` sempre;
- lista `proposals[]` derivada de `selectedSlices`;
- invariantes de segurança: `dispatchAllowed=false`, `mutationAllowed=false`, `authorization=none`, `mode=report-only`.

Origem da proposta deve ser visível no preview (`source=brainstorm|human|tangent-approved`). Materialização de task só ocorre após decisão humana explícita.

## Exemplo blocked/fail-closed

```json
{
  "decision": "blocked",
  "recommendationCode": "stop-no-local-safe",
  "nextAction": "local stop condition: create one local-safe task or choose protected focus explicitly",
  "blockers": ["no-local-safe-next-step"],
  "dispatchAllowed": false,
  "mutationAllowed": false,
  "authorization": "none",
  "mode": "report-only"
}
```

## Critérios de qualidade

- ideias limitadas e deduplicadas;
- slices com validação/rollback explícitos;
- sem texto livre como único contrato;
- decisão consumível por código (`recommendationCode` + `nextAction`).
