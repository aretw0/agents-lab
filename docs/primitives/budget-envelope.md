# Primitiva: Budget Envelope

## Categoria

Avaliação / Coordenação / Planejamento

## Problema

Sistemas com múltiplos agentes (ex.: colônia/swarm) podem escalar custo rapidamente sem um contrato explícito de budget por execução.

## Definição

**Budget Envelope** = unidade de controle de custo acoplada a um objetivo de trabalho.

Estrutura mínima:
- `id`
- `goal`
- `maxCost`
- `scope` (session | colony | workflow)
- `owner`
- `status` (planned | active | completed | cancelled)
- `evidence` (usage/quota exports)
- `taskRefs` (.project/tasks)

## Invariantes

1. nenhuma execução de swarm sem budget envelope explícito;
2. toda execução gera evidência auditável (mínimo: consumo e janela);
3. fechamento de envelope exige revisão humana.

## Contrato canônico task/event (backend-agnostic v1)

Para sincronizar `.project`, GitHub/Gitea e SQLite sem lock-in, o envelope referencia um contrato comum de trabalho:

### Entidade `task`
- `id` (estável entre adapters)
- `description`
- `status` (`planned | in-progress | blocked | completed | cancelled`)
- `priority` (`P0 | P1 | P2`)
- `requiresHumanClose` (bool)
- `verificationRef` (opcional; obrigatório para fechamento estratégico)
- `updatedAt`

### Entidade `task_event`
- `eventId`
- `taskId`
- `type` (`start | progress | review | done_candidate | done_verified | recovery`)
- `source` (`colony | scheduler | human | ci`)
- `timestamp`
- `evidenceRefs` (lista opcional)

### Transições permitidas (núcleo)
- `planned -> in-progress`
- `in-progress -> blocked | completed`
- `blocked -> in-progress | cancelled`
- `completed -> in-progress` (somente quando `requiresHumanClose=true`, como reabertura/candidate)

### Regras de governança
- `done_candidate` nunca fecha task estratégica sozinho.
- `done_verified` exige verificação canônica vinculada.
- adapter pode enriquecer payload, mas não pode relaxar invariantes de budget/evidência/HITL.

## Implementação no ecossistema atual

- live provider windows: `/usage`
- histórico local: `/session-breakdown`
- export auditável: `/quota-visibility export`
- gate de swarm: `piStack.colonyPilot.budgetPolicy` + `ant_colony.maxCost`
- gestão de trabalho: `.project/tasks.json`

## Limite conhecido atual

`/colony <goal>` não expõe `maxCost` na CLI.

Logo, para enforcement hard de custo, o caminho recomendado é o fluxo com `ant_colony` e `maxCost`.

## Próximos incrementos

1. adapter `.project tasks` ↔ lifecycle da colônia (start/progress/end);
2. resumo de budget envelope no handoff da sessão;
3. política de aprovação para exceder hardCap (human-in-the-loop);
4. roteamento para modelos locais com envelopes separados por origem de custo.
