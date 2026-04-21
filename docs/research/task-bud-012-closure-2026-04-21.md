# TASK-BUD-012 — closure (2026-04-21)

## Objetivo
Definir contrato backend-agnostic para clock de trabalho (task/event model + adapters), com piloto em `.project` e trilha explícita para GitHub/Gitea/SQLite.

## Entregas
- `docs/primitives/budget-envelope.md`
  - seção **Contrato canônico task/event (backend-agnostic v1)** com:
    - campos obrigatórios de `task` e `task_event`;
    - transições permitidas;
    - invariantes de governança (no-auto-close estratégico + verificação canônica).
- `docs/research/colony-project-task-bridge.md`
  - consolidação do modelo canônico + mapa de adapters (`.project`, GitHub, Gitea, SQLite) com gaps mínimos.
- `.project/requirements.json`
  - novo requisito **REQ-BUD-042** (contrato backend-agnostic com invariantes de governança).
- `.project/decisions.json`
  - nova decisão **DEC-BUD-035** (coordenação por contrato canônico, backend como adapter).

## Validação
- `project-validate` limpo após atualização dos blocos canônicos.

## Resultado
Critérios da task atendidos: contrato canônico documentado, trilha de adapters explicitada e governança preservada independentemente do backend.
