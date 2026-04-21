# TASK-BUD-020 closure note — 2026-04-21

## Escopo
Fechar pipeline de triagem recente (sessões + branch summaries) com split operacional reproduzível.

## ACs

### AC1 — comando único com visão recente + sinais
Validação:
- `node.exe scripts/session-triage.mjs --days 1 --limit 8`
- saída contém `## Recent sessions` e sinais `COLONY_SIGNAL` agregados.

### AC2 — agrega Next Steps / In Progress / Blocked
Validação:
- saída contém `## Branch-summary aggregation` com as três seções.
- JSON também expõe `aggregate.nextSteps/inProgress/blocked`.

### AC3 — split unlock-now vs later reproduzível
Validação:
- saída contém `## Board pending split`, `### Unlock swarm now`, `### Later stabilization`.
- JSON expõe `board.unlockNow` e `board.later`.

## Conclusão
TASK-BUD-020 atendida no runtime atual com triagem determinística e saída auditável em modo humano + JSON.
