# Session-triage provider-agnostic adapter slice — 2026-04-21

## Objetivo
Avançar `TASK-BUD-023` com ingestão canônica mais genérica, mantendo governança idêntica ao fluxo local.

## Mudanças

Arquivo principal:
- `scripts/session-triage.mjs`

Evoluções implementadas:
1. `--events` agora aceita **JSON** e **JSONL** (um evento por linha).
2. parsing canônico preserva `source.provider` e agrega volume por provider no report (`aggregate.providers`).
3. source de summaries canônicos incorpora provider (`canonical:<file>:<provider>`).
4. store local de branch summaries continua integrado ao merge determinístico (sessão + canônico + store).

Arquivos auxiliares:
- `docs/guides/session-triage.md` (docs do formato JSONL e agregação por provider)
- `docs/research/data/session-triage/canonical-events.example.jsonl` (exemplo cross-platform)

## Evidência de execução

1. JSON canônico:
```bash
node.exe scripts/session-triage.mjs --days 30 --events docs/research/data/session-triage/canonical-events.example.json --json
```
Resultado observado:
- provider `matrix` agregado em `aggregate.providers`
- summary bullets presentes (`Priorizar promotion c3`)

2. JSONL canônico:
```bash
node.exe scripts/session-triage.mjs --days 30 --events docs/research/data/session-triage/canonical-events.example.jsonl --json
```
Resultado observado:
- provider `telegram` agregado em `aggregate.providers`
- `COLONY_SIGNAL:COMPLETE` detectado
- summary bullets presentes (`Consolidar evidência`, `TASK-BUD-023`)

## Governança preservada

- nenhuma automação de fechamento de task foi introduzida;
- `.project/tasks` permanece board canônico;
- critérios HITL/evidência permanecem iguais para qualquer origem.
