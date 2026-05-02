# Linux agent primitives radar 2026 (long-horizon, local-first)

Objetivo: manter um radar contínuo de primitives de OS/protocolo/memória para aumentar produtividade com segurança, sem quebrar governança local-first e sem forçar adoção precoce.

## North star de priorização (equilíbrio prático)

Sequência operacional para retorno de longo prazo:
1. **limpeza relevante** (remover fricção recorrente e custo operacional);
2. **pesquisa dirigida** (fechar gaps com evidência e critérios explícitos);
3. **escalabilidade de produtividade** (delegar/acelerar com controle e auditoria).

Regra de pacing: nenhuma promoção para experiment/integrate-later sem evidência mínima da etapa anterior.

## Primitives monitoradas (escopo obrigatório)

1. **BranchFS**
2. **`branch()` syscall** (branch() syscall)
3. **Agent Sandbox (gVisor/Kata)**
4. **MCP**
5. **Simple Semantic Paging**
6. **SLIM**
7. **Agent Discovery & Identity**

## Matriz de triagem (decisão: observe | experiment | integrate-later)

Avaliar cada primitive em 1..5 (5 melhor para adoção):

- **valor operacional**: redução de tempo/custo/contexto ou aumento de throughput;
- **risco de segurança**: superfície de escape, spoofing, isolamento imperfeito;
- **maturidade**: estabilidade técnica, documentação, uso em produção;
- **dependência externa**: lock-in de fornecedor/runtime/ecossistema;
- **impacto em governança local-first**: auditabilidade, rollback, no auto-dispatch protegido.

### Regras de decisão

- **observe**: maturidade baixa ou risco alto sem mitigação local;
- **experiment**: valor alto + risco controlável + rollback explícito + gate local-safe;
- **integrate-later**: bom potencial, mas dependência externa/operacional ainda não compensa.

## Snapshot inicial (2026-05)

| Primitive | Valor | Risco | Maturidade | Dependência externa | Governança local-first | Posição |
|---|---:|---:|---:|---:|---:|---|
| BranchFS | 4 | 3 | 2 | 4 | 3 | observe |
| `branch()` syscall | 4 | 4 | 1 | 4 | 2 | observe |
| Agent Sandbox (gVisor/Kata) | 5 | 2 | 4 | 3 | 4 | experiment |
| MCP | 4 | 3 | 4 | 3 | 3 | experiment |
| Simple Semantic Paging | 5 | 3 | 2 | 3 | 4 | experiment (report-only) |
| SLIM | 3 | 3 | 2 | 3 | 3 | observe |
| Agent Discovery & Identity | 4 | 4 | 3 | 3 | 3 | observe |

Notas:
- Snapshot inicial é deliberadamente conservador.
- Promotion exige telemetria local e evidência canônica no board/handoff.

## Cadência e gatilhos de promoção

### Cadência
- **mensal (light)**: revisar scoring, risco e sinais de mercado/implementação;
- **quarterly (deep)**: consolidar mudanças e decidir no máximo 1 experimento novo por ciclo.

### Gatilhos para promover `observe -> experiment` (local-safe)

Todos obrigatórios:
1. hipótese de valor explícita (tempo/custo/confiabilidade) com métrica;
2. escopo de experimento pequeno e reversível;
3. gate de validação focal definido antes da execução;
4. rollback não-destrutivo documentado;
5. ausência de auto-dispatch em escopo protegido;
6. checkpoint/handoff auditável no fim da fatia.

### Gatilhos para promover `experiment -> integrate-later`

1. repetibilidade em >=2 fatias independentes;
2. blocked-rate e falhas de governança dentro do limite aceito;
3. custo operacional proporcional ao ganho;
4. sem regressão nas políticas de soberania local e trilha de evidência.

## Backlog encadeado

- `TASK-BUD-624`: radar estratégico e critérios de adoção (este documento).
- `TASK-BUD-625`: isolamento/forking (BranchFS + `branch()` + sandbox) com experimento local-safe.
  - estudo v1: `docs/research/linux-isolation-forking-primitives-study-2026.md`
- `TASK-BUD-626`: protocolos (MCP/SLIM/identity) com posição de adoção por primitive.
  - estudo v1: `docs/research/agent-protocol-primitives-study-2026.md`
- `TASK-BUD-627`: memória/contexto (semantic paging) com continuidade auditável.
  - estudo v1: `docs/research/semantic-paging-context-strategy-2026.md`

## Contrato de execução (anti-forcing)

- Sem salto direto para integração ampla por ansiedade de throughput.
- Escalar delegação só após melhoria mensurável em limpeza+pesquisa.
- Cada avanço deve deixar trilha auditável (`task`, `verification`, `handoff`) e rollback claro.
