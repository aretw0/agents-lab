# Emergent Tangent Capture (primitive)

## Objetivo

Registrar trabalho emergente **aprovado** durante execução (tangente necessária) com proveniência explícita no board, sem perder visibilidade de origem.

## Contrato mínimo

Na criação da task, aceitar campos opcionais de proveniência:

- `provenance_origin`: `brainstorm | human | tangent-approved`
- `source_task_id`: task foco/origem
- `source_reason`: motivo curto do desvio

Se `provenance_origin` for informado, a task recebe nota canônica:

`[provenance:<origin>] source_task=<id|none> reason=<texto bounded>`

## Invariantes

1. Proveniência não fecha nem promove task automaticamente.
2. Fluxo continua sob gates normais de rationale/verificação.
3. Proveniência é trilha auditável, não autorização.

## Implementação de referência

- `packages/pi-stack/extensions/project-board-surface.ts` (`board_task_create` + `createProjectTaskBoard`)
- `packages/pi-stack/test/smoke/project-board-surface.test.ts`
