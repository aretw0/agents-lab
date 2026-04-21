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

## Contrato backend-agnostic (v1)

### Modelo de task (canônico)
- `id`
- `description`
- `status`: `planned | in-progress | blocked | completed | cancelled`
- `priority`: `P0 | P1 | P2`
- `requiresHumanClose`
- `verificationRef` (quando aplicável)

### Modelo de evento (canônico)
- `eventId`
- `taskId`
- `type`: `start | progress | review | done_candidate | done_verified | recovery`
- `source`: `colony | scheduler | human | ci`
- `timestamp`
- `evidenceRefs`

### Invariantes
1. Sem auto-close estratégico: `done_candidate` não vira `completed` final sem `verification`.
2. Writer canônico deve ser single-writer/atômico para evitar corrida entre adapters.
3. Eventos podem ser ingestados de múltiplos backends, mas o board macro projeta o mesmo conjunto de estados.

## Mapa de adapters (mínimo viável)

| Backend | Persistência de task | Persistência de evento | Gap principal |
|---|---|---|---|
| `.project` (atual) | `tasks.json` | notas/sinais + verifications | padronizar trilha de evento separada |
| GitHub | issue/project item | issue comments/timeline/check runs | mapeamento de status e latência de sync |
| Gitea | issue/project board | comments/status checks | menor cobertura de metadados nativos |
| SQLite/browser | tabela `tasks` | tabela `task_events` | disciplina de migração/versionamento local |

## Estado atual de maturidade

- Adapter opt-in consolidado (TASK-BUD-005/007/008).
- Hardening single-writer/atômico aplicado no writer de tasks (TASK-BUD-010).
- Recovery task automática para candidates sem evidência final (TASK-BUD-013/052/082).

## Risco residual

Sem disciplina de evidência (inventário + validation command log), pode haver gap entre “run report” e promoção final no branch principal.
