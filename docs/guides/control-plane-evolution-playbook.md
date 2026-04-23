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

## Próximo micro-slice

1. Formalizar checklist GO/NO-GO de transição Modo 1 -> Modo 2.
2. Definir envelope mínimo de telemetria para Modo 3 (status, readiness, budget, lease).
