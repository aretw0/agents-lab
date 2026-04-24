# Control-plane evolution playbook (foundations first)

Objetivo: evoluir de forma segura do control-plane local para delegação e, só depois, para federação multi-control-plane — sem misturar conceitos no mesmo ciclo.

## Princípios

1. **Playbook-first**: consolidar contrato operacional antes de ampliar arquitetura.
2. **State in parent**: estado canônico permanece no control-plane principal (`.project/*`).
3. **Workers are disposable**: subagentes/swarm são efêmeros (`spawn -> slice -> evidence -> kill`).
4. **Federation is a phase, not a flag**: queen-of-queens entra apenas após estabilidade comprovada das fases anteriores.

## Três modos (não misturar)

### Modo 1 — Single control-plane (agora)
- Escopo: 1 projeto / 1 board canônico.
- Fluxo: execução direta + micro-delegação controlada.
- Gate mínimo: readiness strict (`subagent_readiness_status(strict=true)`) + budget saudável.
- Critério de saída: 3+ ciclos estáveis com evidência reprodutível e sem recovery manual frequente.

### Modo 2 — Delegação descartável (próximo)
- Escopo: subagentes/swarm por fatia.
- Ciclo de vida padrão: `spawn -> executar -> retornar evidência -> encerrar`.
- Regras:
  - budget cap curto por run;
  - sem memória estratégica no worker;
  - decisão e priorização sempre no parent control-plane.
- Critério de saída: throughput melhora sem aumento de incidentes de contexto/budget.

### Modo 3 — Federação de control-planes (futuro)
- Escopo: múltiplas instâncias (projetos distintos) sob coordenação superior.
- Papel do coordenador: rotear, observar, consolidar sinais e governança global.
- Pré-condições:
  - contratos de handoff e evidência padronizados entre instâncias;
  - telemetria mínima comum (status/readiness/budget/health);
  - runbook de contenção para isolar instância degradada sem parar o ecossistema.

## Inspirado por `tuts-agentic-ai-examples`

Referência: <https://github.com/nilayparikh/tuts-agentic-ai-examples>

Mapeamento conceitual (adaptado ao ecossistema pi/refarm):
- **Single agent / sequential / parallel / coordinator / agent-as-tool / loop-critique** (trilha `agents/`) -> matriz de padrões de delegação progressiva.
- **A2A progressivo e capstone multiagente** (trilha `a2a/`) -> base para contrato entre instâncias e interoperabilidade de runtime.

Adaptação local obrigatória:
- manter board-first (`.project/*`) como fonte canônica;
- preservar `no-auto-close` para itens estratégicos;
- promoção por verificação (`verification`) antes de `completed`.

## Anti-patterns (evitar)

- transformar subagente em "memória longa" do sistema;
- acoplar decisão estratégica ao worker;
- abrir federação antes de estabilizar operação local;
- compensar arquitetura frágil com compactação frequente.

## Checklist GO/NO-GO — transição Modo 1 -> Modo 2

### GO (todos obrigatórios)
- `subagent_readiness_status(strict=true)` retorna `ready=true` por pelo menos 2 checks consecutivos.
- Últimas runs controladas não apresentam `BUDGET_EXCEEDED` no recorte operacional.
- Board canônico está íntegro (`project-validate` clean) e handoff atualizado.
- Delegações curtas já demonstraram retorno auditável (evidência + status de task sem auto-close indevido).

### NO-GO (qualquer item bloqueia)
- readiness strict oscilando (`ready=false` recorrente) por causas não diagnosticadas.
- falha de governança de budget (streak de bloqueio, retries exaustos sem contenção).
- dependência de memória de subagente para decisão estratégica.
- ausência de evidência canônica no parent control-plane.

## Envelope mínimo de telemetria — Modo 3 (federação)

Cada control-plane federado deve expor, no mínimo:

- `instanceId`: identidade estável da instância (workspace/projeto).
- `status`: `running|paused|degraded`.
- `readiness`: resultado gate strict (`ready`, checks críticos, timestamp).
- `budget`: estado resumido por provider/account (`ok|warn|block`).
- `lease`: owner + heartbeat + expiração.
- `workload`: fila pendente e task ativa (se houver).
- `lastHandoffAtIso`: timestamp da última atualização canônica.

Contrato de operação do coordenador (queen-of-queens):
- nunca decidir por contexto implícito de worker;
- sempre agir com base em telemetria explícita + evidência do board local;
- isolar instância degradada sem interromper as saudáveis.

## Rollout / rollback por modo

### Modo 1 (single control-plane)

Rollout:
1. validar saúde: `context_watch_status` + `project-validate`;
2. confirmar gate strict: `subagent_readiness_status(strict=true)`;
3. executar slices locais com board/handoff atualizados.

Rollback (voltar para estabilidade local):
- se houver oscilação de readiness/budget, pausar delegação e voltar para execução direta até 2 ciclos limpos.

### Modo 2 (delegação descartável)

Rollout canário:
1. escolher 1 task curta com critérios claros;
2. spawn controlado (`ant_colony` com `maxAnts` baixo + `maxCost` curto);
3. exigir evidência no parent antes de nova delegação;
4. encerrar worker após entrega (não manter sessão longa do worker).

Rollback:
- trigger: `FAILED` recorrente, `BUDGET_EXCEEDED`, ou ausência de evidência canônica;
- ação: descer para Modo 1 por 1 janela operacional (sem novas delegações) e corrigir causa raiz.

### Modo 3 (federação)

Rollout canário:
1. federar só 1 instância filha inicialmente;
2. validar envelope mínimo (`status/readiness/budget/lease/workload/handoff`);
3. testar isolamento: simular instância degradada sem afetar as demais.

Rollback:
- trigger: perda de telemetria mínima, lease inconsistente, ou decisões sem evidência local;
- ação: remover instância da federação, manter operação local autônoma, reintroduzir apenas após requalificação.

## Sinais esperados por estágio

- **Modo 1 saudável**:
  - `subagent_readiness_status(strict=true).ready == true`
  - `context_watch_status.level in {ok,warn-controlado}`
  - `project-validate.status == clean`
- **Modo 2 saudável**:
  - presença de `COMPLETE` nas runs controladas;
  - ausência de `BUDGET_EXCEEDED` no recorte operacional;
  - evidência registrada em `verification` para cada delegação relevante.
- **Modo 3 saudável**:
  - telemetria mínima disponível para todas as instâncias ativas;
  - coordenador sem decisões "cegas" (sempre com status/readiness/budget/lease);
  - isolamento comprovado de instância degradada sem efeito cascata.
