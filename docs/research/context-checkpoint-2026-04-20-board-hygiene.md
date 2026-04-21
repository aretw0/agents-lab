# Context checkpoint — 2026-04-20 (board hygiene)

## Feito nesta sessão
- `.project` adotado explicitamente como fonte canônica (`DEC-BUD-020`, `REQ-BUD-031`).
- Backfill de verificação legado aplicado e validado (`project-validate` = clean).
- Script persistente criado: `scripts/project/backfill-task-verification.mjs`.
- Scripts de execução adicionados no `package.json`:
  - `project:verification:check`
  - `project:verification:backfill`
- Handoff estruturado em `.project/handoff.json`.

## Estado atual
- Board íntegro: tasks `completed` com `verification`.
- Verificações legadas foram marcadas como `partial` (não mascara histórico).
- Próxima frente recomendada: `TASK-BUD-055` (ritual leve de hygiene).

## Próximos 3 passos
1. Formalizar rotina curta de hygiene (5-10 min por sessão) e registrar no board.
2. Manter WIP=1 para evitar novo inchaço de contexto.
3. Só depois retomar otimização de runtime/contexto (lean defaults e monitor tuning).

## Prompt de retomada (copiar/colar)
```text
Retomar a partir de TASK-BUD-055.
Objetivo: fechar rotina leve de hygiene do .project com WIP=1 e handoff curto.
Antes de qualquer frente nova: rodar project:verification:check e project-validate.
Atualizar .project/handoff.json ao final com delta operacional.
```
