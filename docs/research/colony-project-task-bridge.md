# Colony ↔ .project/tasks Bridge — estado atual

**Data (última atualização):** 2026-04-22

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

## Mapeamento canônico de evento por backend

| `task_event.type` | `.project` (atual) | GitHub | Gitea | SQLite/browser (Refarm target) |
|---|---|---|---|---|
| `start` | `status=in-progress` + note | issue comment + label/status | comment + board move | insert em `task_events` + update `tasks.status=in-progress` |
| `progress` | append note | timeline/comment | comment | append `task_events` |
| `review` | append note + candidato para revisão humana | review requested/check-run pending | review comment/status | append `task_events` + flag review-pending |
| `done_candidate` | mantém `in-progress` (HITL) + note | issue comment "candidate" (sem close) | comment "candidate" (sem close) | append `task_events`; `tasks.status=in-progress` |
| `done_verified` | `status=completed` com `verification` | close item + link de evidência | close issue/board item + evidência | append `task_events`; `tasks.status=completed` |
| `recovery` | `status=blocked` + recovery note/task | reopen/blocked label + follow-up issue | blocked label + follow-up issue | append `task_events`; `tasks.status=blocked` |

## Runtime primitives já disponíveis (adapter-first)

No `colony-pilot-task-sync`, o contrato canônico agora tem helpers explícitos para reduzir divergência entre backends:

- `colonyPhaseToCanonicalTaskEventType(...)`
- `buildCanonicalTaskEventFromColonySignal(...)`
- `canonicalTaskEventTypeToProjectTaskStatus(...)`
- `applyCanonicalTaskEventToProjectTask(...)`

Isso permite que adapters externos consumam o mesmo envelope canônico (`task_event`) e projetem status no board sem reimplementar semântica de fechamento/candidate/recovery.

## Migração incremental agents-lab → Refarm (SQLite/browser)

1. **Dual-write controlado (observação):** manter `.project/tasks` como board oficial e espelhar `task_event` em SQLite sem mudar autoridade.
2. **Replay determinístico:** reconstruir `tasks.status` em SQLite a partir de `task_events` usando `canonicalTaskEventTypeToProjectTaskStatus(...)`; comparar com `.project` em modo relatório.
3. **Read-model paralelo:** UI/browser lê snapshot SQLite, mas fechamento (`completed`) continua gated por `verification` no board canônico.
4. **Handoff de autoridade (opt-in):** só após paridade estável, promover SQLite como read/write adapter primário, preservando export reversível para `.project`.
5. **Fallback seguro:** qualquer divergência crítica retorna para `.project` como writer primário, sem auto-close de tarefas estratégicas.

## Estado atual de maturidade

- Adapter opt-in consolidado (TASK-BUD-005/007/008).
- Hardening single-writer/atômico aplicado no writer de tasks (TASK-BUD-010).
- Recovery task automática para candidates sem evidência final (TASK-BUD-013/052/082).

## Risco residual

Sem disciplina de evidência (inventário + validation command log), pode haver gap entre “run report” e promoção final no branch principal.
