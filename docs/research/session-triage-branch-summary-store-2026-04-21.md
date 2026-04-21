# Session-triage branch-summary store — 2026-04-21

## Objetivo
Fechar lacuna de `TASK-BUD-022`: manter retornos de branch summary em formato parseável local, sem depender de cópia manual, para agregação no triage.

## Implementação

Arquivo alterado:
- `scripts/session-triage.mjs`

Comportamento novo:
1. store local padrão: `.sandbox/pi-agent/triage/branch-summary-store.json`
2. merge determinístico entre:
   - summaries extraídos das sessões recentes
   - summaries vindos de `--events` (fonte canônica)
   - summaries já persistidos no store
3. deduplicação por fingerprint de conteúdo (`nextSteps/inProgress/blocked`)
4. saída JSON inclui metadados do store (`loaded/merged/sessionExtracted`).

Flags:
- `--summary-store <path>`
- `--no-summary-store`

## Evidência de execução

1. `node.exe scripts/session-triage.mjs --json`
   - `branchSummaryStore.enabled=true`
   - store path presente no report.

2. `node.exe scripts/session-triage.mjs --days 30 --events docs/research/data/session-triage/canonical-events.example.json --json`
   - agregação inclui bullets de summary do evento canônico
   - `aggregate.branchSummariesCount=1`

3. Store materializado com entrada parseável:
- `.sandbox/pi-agent/triage/branch-summary-store.json`

## Resultado

`TASK-BUD-022` pode ser considerada atendida neste slice: summaries de branch agora ficam acessíveis localmente em formato estruturado e reaproveitáveis no triage subsequente.
