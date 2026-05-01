# Escopo de run local-safe em ondas — 2026-05-01

## Objetivo

Executar um pacote maior de manutenção local-safe em ondas bounded, mantendo governança, validação focal e rollback simples por fatia.

## Limites operacionais

- Seed inicial: **12 tasks** (`TASK-BUD-488`..`TASK-BUD-499`)
- Wave size alvo: **4-6 tasks concluídas por rodada**
- WIP: **1 task `in-progress` por vez**
- Blast radius por task: curto e reversível
- Máximo: **3 waves** antes de recalibração humana explícita

## Waves propostas

### Wave 1 — contrato base e hardening imediato

- `TASK-BUD-488` — escopo e gates de waves
- `TASK-BUD-489` — invalid-input recommendationCode
- `TASK-BUD-490` — precedência de blockers
- `TASK-BUD-491` — matriz operacional blocker->ação
- `TASK-BUD-492` — evidência de summary/code/protectedDeps

### Wave 2 — consolidação e visibilidade read-only

- `TASK-BUD-493` — helper de diagnóstico de blockers
- `TASK-BUD-494` — snapshot read-only de saúde de dependências
- `TASK-BUD-495` — documentação da primitive de snapshot
- `TASK-BUD-496` — regressões do snapshot

### Wave 3 — priorização por score e fechamento de pacote

- `TASK-BUD-497` — score report-only de higiene de dependências
- `TASK-BUD-498` — surface/tool do score
- `TASK-BUD-499` — checklist de execução e evidência mínima por wave

## Gate de avanço entre waves

Avançar de uma wave para a próxima somente se:

1. validação focal da wave atual estiver toda verde;
2. não houver blocker de escopo protegido no plano local-safe;
3. checkpoint/handoff da wave estiver registrado;
4. não houver pressão persistente de contexto causada por diagnóstico volumoso.

## Condições de parada da run

- `no-eligible` para local-safe
- 2 falhas seguidas de validação focal
- acoplamento local-safe -> protected detectado durante execução
- drift de escopo sem justificativa bounded

## Checklist curto por wave (entrada/saída)

### Entrada da wave

- [ ] backlog da wave limitado a **4-6 tasks**
- [ ] nenhuma task protected no conjunto da wave
- [ ] validação focal conhecida para cada task da wave
- [ ] rollback simples por task (revert local)

### Saída da wave

- [ ] tarefas da wave concluídas ou stop reason explícito registrado
- [ ] nenhuma falha focal em aberto sem owner
- [ ] checkpoint/handoff atualizado com próximo `nextTaskId`
- [ ] decisão explícita: avançar para próxima wave ou pausar

## Evidência mínima por wave

- testes focais da wave
- 1 marker-check curto de âncoras documentais (quando houver doc)
- checkpoint/handoff com status da wave e próximo passo
