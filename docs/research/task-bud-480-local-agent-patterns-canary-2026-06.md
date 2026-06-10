---
title: TASK-BUD-480 Local Agent Patterns Canary
description: Local-safe agent pattern evidence for the TASK-BUD-480 external influence lane.
---

# TASK-BUD-480 local agent patterns canary

Data: 2026-06-10  
Task: `TASK-BUD-480`  
Modo: local-safe, report-only, sem pesquisa externa

## Objetivo

Transformar `TASK-BUD-480` em um canario bounded de padroes de agentes sem consultar `nousresearch/hermes-agent` ainda. A pergunta local e:

> Quais padroes de agentes ja estao maduros no control-plane local-first, e quais ainda devem ficar fora do caminho 0.8.0?

## Resultado

O padrao maduro para 0.8.0 e **single-worker agent-first com contrato parent-side**. Multi-agent, background, swarm e colonias continuam fora do caminho de release ate haver gate proprio.

## Padroes locais ja assimilados

| Padrao | Evidencia atual | Estado |
|---|---|---|
| Control plane como autoridade | docs definem `board task -> typed invocation spec -> registry -> dispatch -> outcome -> verification/board/handoff -> commit` | maduro |
| Packet antes de processo | `agent-run:pi-driver-payload` emite pacote completo e `driverStepCall` antes do dispatch | maduro |
| Aprovacao estruturada | `execute=true` exige `operator_approval` estruturado | maduro |
| Execucao unica bounded | `agent-run:driver-step` executa no maximo um processo por dispatch aprovado | maduro |
| Registry-before-start | driver escreve `planned`, depois `running`, depois terminal | maduro |
| Outcome parent-side | `follow=true` + `build_outcome=true` materializa `agent-run-outcome-packet` | maduro |
| Mutacao com evidencia | mutation sem `touched_file`/marker fica `partial`, nao `pass` | maduro |
| Economia de worker | docs exigem declared files, saida curta, budget evidence e stop conditions | maduro como contrato |
| Readiness de delegacao | `subagent_readiness_status` e `delegation_mix_score` medem sinais locais antes de promocao | maduro como gate report-only |
| Orquestracao multi-step | workflow/sequencial ainda depende de runner first-party e checkpoint forte | lacuna futura |
| Multi-agent/background | ainda exige worktree/isolation/lifecycle/budget/abort/promocao propria | fora da 0.8.0 default |

## Padrao canonico para 0.8.0

Para tarefas local-safe pequenas, o fluxo preferido e:

1. selecionar foco e escopo declarado;
2. gerar payload/packet;
3. executar no maximo um worker com aprovacao estruturada quando houver dispatch real;
4. seguir/fazer outcome parent-side;
5. registrar evidencia em arquivo;
6. commitar pelo control plane depois da validacao.

Esse padrao libera o potencial do projeto sem transformar a 0.8.0 em promessa de swarm, scheduler remoto ou autonomia forte.

## Matriz para comparacao externa futura

Quando houver autorizacao explicita para consultar a influencia externa, comparar apenas estes pontos:

| Pergunta | Aceitar padrao externo se... | Rejeitar se... |
|---|---|---|
| Agent contract | melhora spec/output/schema sem ocultar runner | depende de prompt livre sem contrato |
| Orchestrator authority | reforca parent-side validation | deixa worker promover resultado sozinho |
| Tool boundary | reduz superficie por allowlist/declared files | amplia ferramentas por default |
| State/evidence | melhora registry/log/outcome/handoff | substitui evidencia por estado opaco |
| Multi-agent | oferece sequenciamento fail-closed | assume paralelismo/background como default |
| Recovery | melhora retry/resume com provenance | auto-retry sem stop condition clara |

## Lacunas intencionais

Estas lacunas nao devem bloquear o release se a promessa da 0.8.0 permanecer single-worker/local-first:

- workflow DAG com checkpoint real;
- reusable agent role registry com schema publico;
- worktree/container por worker;
- fan-in automatico para multiplos workers;
- scheduler/remoto/offload;
- agentes que alteram board/release sem confirmacao.

## Proximo passo recomendado

Antes de pesquisar fora, fortalecer a lacuna local mais barata:

1. documentar o `single-worker contract` como contrato distribuivel;
2. exigir que qualquer novo padrao de agente seja classificado como:
   - `single-worker`;
   - `sequential-worker`;
   - `workflow`;
   - `parallel/background`;
   - `remote/offload`;
3. deixar `single-worker` como unico default 0.8.0;
4. manter as demais classes report-only/protected ate haver gates dedicados.

## Decisao de release

`TASK-BUD-480` nao precisa bloquear a 0.8.0 por falta de pesquisa externa se esta decisao for aceita:

- 0.8.0 promete agent-first single-worker governado;
- 0.8.0 nao promete orquestracao multi-agent forte;
- pesquisa externa de padroes de agentes fica como assimilacao futura bounded.

## Nao feito

- Nao consulta rede.
- Nao clona `hermes-agent`.
- Nao executa `ant_colony`.
- Nao edita `.project/tasks.json`.
- Nao muda `decision.md`.
