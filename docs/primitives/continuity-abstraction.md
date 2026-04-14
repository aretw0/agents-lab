# Primitiva: Continuidade como Abstração

## Categoria

Memória / Coordenação / Governança

## Problema

"Continuidade" costuma ficar acoplada ao lugar onde o trabalho está salvo (chat local, `.project`, issue tracker, banco local etc.).
Isso trava portabilidade e força os agentes a dependerem de um único backend.

## Definição

**Continuidade como Abstração** = contrato canônico de estado + eventos + gates, independente do backend.

A continuidade deixa de ser "onde está" e passa a ser "qual semântica preservamos".

## Contrato canônico mínimo

- `workItem` (task/issue/card)
- `event` (start/progress/review/done/recovery)
- `evidence` (arquivos alterados, comandos de validação, custo)
- `decisionGate` (ex.: no-auto-close, human approval)
- `deliveryState` (`reported` | `artifact-produced` | `applied` | `recovery-required`)

## Invariantes

1. **Backend-agnostic**: o mesmo fluxo deve funcionar em `.project`, GitHub/Gitea, SQLite, etc.
2. **Runner-agnostic**: vale para TUI/Web/local e para CI runners.
3. **No auto-close**: conclusão estratégica exige revisão humana.
4. **Evidência obrigatória**: sem evidência mínima, estado deve ir para `recovery-required`.
5. **Replay idempotente**: reprocessar eventos não pode corromper estado.

## Adapters (camada de infraestrutura)

- **Storage adapters**: `.project`, GitHub Issues/Projects, Gitea, SQLite (Refarm)
- **Runner adapters**: sessão local, swarm em worktree, GitHub Actions/CI
- **Projection adapters**: board, wiki, timeline, PR comments, dashboards

Todos implementam o mesmo contrato; o usuário escolhe o backend/interface.

## Modelo operacional sugerido

1. Agente decide próxima task elegível (prioridade + dependências + policy).
2. Execução emite eventos canônicos.
3. Adapter persiste no backend escolhido.
4. Gate valida evidência/delivery.
5. Humano aprova fechamento final.

## Estado atual no agents-lab

- Backend local de referência: `.project` (`@davidorex/pi-project-workflows`)
- Governança hard em evolução no `colony-pilot` (budget/delivery/no-auto-close)
- Trilha de portabilidade: contratos e adapters para CI/PR/issues + Refarm/SQLite

## Próximos incrementos

1. consolidar `task/event contract` formal em schema/versioning;
2. implementar adapter translacional issue/PR ↔ clock canônico;
3. adicionar handoff determinístico entre sessões via event journal;
4. validar portabilidade ponta-a-ponta em runner externo (CI).
