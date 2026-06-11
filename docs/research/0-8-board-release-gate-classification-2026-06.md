---
title: 0.8 Board Release Gate Classification
description: Classification of current board-state blockers for 0.8 release readiness.
---

# Classificacao do board release gate 0.8.0

Data: 2026-06-11
Escopo: `release:readiness:v0.8.0`, `.project/tasks.json`, readiness 0.8.0

## Objetivo

Separar o que ainda e bloqueio tecnico do que e decisao de operador ou estado do board. Este arquivo nao promove tarefas, nao fecha tarefas e nao edita `.project/tasks.json`; ele apenas classifica a situacao atual para reduzir ambiguidade antes de qualquer decisao de release.

## Estado observado

O mapa de readiness registra agora:

- `agent-run-driver-gate` verde;
- `board-release-clear` verde;
- `target-version-ready` verde para `0.8.0`;
- `releaseBlockers: []`;
- draft/cut preview ainda protegidos por decisao explicita do operador.

O board tinha tres tarefas P3 protegidas que afetavam o gate `board-release-clear`; elas foram estacionadas para 0.8.0 como influencias externas protegidas:

| Task | Tema | Estado | Natureza |
|---|---|---|---|
| `TASK-BUD-480` | `nousresearch/hermes-agent` | `planned` | influencia externa protegida parked |
| `TASK-BUD-521` | `mattpocock/sandcastle` | `planned` | influencia externa protegida parked |
| `TASK-BUD-676` | `aretw0/claude-mem` | `planned` | influencia externa protegida parked |

As tres aparecem no registro de influencias parked como referencias uteis, mas bounded. As notas do board tambem indicam escopo protegido, pesquisa externa e necessidade de foco humano explicito.

## Classificacao

| Gate | Classe | Bloqueia codigo? | Bloqueia release? | Acao segura |
|---|---|---:|---:|---|
| `agent-run-driver-gate` | tecnico | nao | nao | manter testes verdes |
| `target-version-ready` | decisao de release aplicada | nao | nao | manter draft/cut em preview protegido |
| `board-release-clear` | estado do board | nao | nao | manter influencias externas parked/protected ate foco explicito |

## Leitura das tres tasks

| Task | Classificacao recomendada | Blocking default para 0.8.0 | Primeira acao local-safe |
|---|---|---:|---|
| `TASK-BUD-480` | parked/protected | nao | matriz report-only de padroes de agentes local-first, sem clonar/rodar codigo |
| `TASK-BUD-521` | parked/protected | nao | comparar conceitos de isolamento com os limites atuais de driver/spawn/log/registry |
| `TASK-BUD-676` | parked/protected | nao | comparar memoria/sessao com handoff, summaries, registry e arquivos de resultado do driver |

## Decisao recomendada

Para 0.8.0, estas tarefas foram tratadas como candidatas de evidencia de release e estacionadas, nao como trabalho tecnico automatico. Elas so devem virar hard blockers novamente se o operador decidir que uma release futura precisa assimilar uma dessas influencias antes do corte.

O caminho conservador atual e:

1. manter `board-release-clear` verde enquanto o board nao tiver P0/in-progress/blocked;
2. manter as influencias externas em parked/protected;
3. preparar no maximo uma assimilacao bounded por vez, via driver agnostico e artefato local;
4. nao fazer pesquisa externa, clone, provider real ou automacao forte sem autorizacao explicita.

## Proximo passo de demonstracao

Se o objetivo for provar que o projeto consegue trabalhar sobre si mesmo, a proxima fatia deve usar a cadeia agnostica ja validada e ja exposta em `agentRunDrivers.providerProtectedBoardPlanEvidence`:

1. gerar payload/packet local;
2. rodar um driver step bounded;
3. gravar resultado em arquivo;
4. construir outcome local;
5. transformar a evidencia em decisao de board.

O primeiro canario recomendado e `TASK-BUD-521`, porque isolamento/sandboxing conversa diretamente com a camada operacional que acabou de amadurecer (`agent_run_driver_step_dispatch`, registry, logPath, cwd guard e bloqueio de run duplicado).

## Nao feito

- Nao edita `.project/tasks.json`.
- Nao edita `decision.md`.
- Nao executa `ant_colony`.
- Nao usa rede ou GitHub externo.
- Nao muda versionamento.
