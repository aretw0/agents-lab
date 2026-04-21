# Colony ↔ .project/tasks Bridge — estado atual

**Data (última atualização):** 2026-04-21

## Pergunta

A colônia (`@ifi/oh-pi-ant-colony`) acessa automaticamente as tasks do `.project/tasks.json`?

## Resposta curta

**Não, nativamente não.**
A integração ocorre via adapter no `colony-pilot` (opt-in), que projeta sinais de execução no board canônico.

## Evidências práticas

1. Runtime da colônia mantém tarefas internas em storage próprio (`ant-colony/.../tasks/*.json`).
2. O bridge de board está no task-sync do `colony-pilot`:
   - `upsertProjectTaskFromColonySignal(...)`
   - `ensureRecoveryTaskForCandidate(...)`
3. Sinais start/progress/end podem criar/atualizar task canônica quando `projectTaskSync.enabled=true`.

## Política operacional (single-board clock)

- `.project/tasks.json` = fonte oficial macro (governança/versionamento).
- Estado efêmero da colônia = telemetria operacional (não substitui board).
- Fechamento de task estratégica permanece human-in-the-loop (`requireHumanClose=true` mantém candidate).

## Estado atual de maturidade

- Adapter opt-in consolidado (TASK-BUD-005/007).
- Hardening single-writer/atômico aplicado no writer de tasks (TASK-BUD-010).
- Recovery task automática para candidates sem evidência final (TASK-BUD-013/052/082).

## Risco residual

Sem disciplina de evidência (inventário + validation command log), pode haver gap entre “run report” e promoção final no branch principal.
