---
title: 0.8 Board Release Gate Classification
description: Classification of current board-state blockers for 0.8 release readiness.
---

# Classificacao do board release gate 0.8.0

Data: 2026-06-10  
Escopo: `release:readiness:v0.8.0`, `.project/tasks.json`, readiness 0.8.0

## Objetivo

Separar o que ainda e bloqueio tecnico do que e decisao de operador ou estado do board. Este arquivo nao promove tarefas, nao fecha tarefas e nao edita `.project/tasks.json`; ele apenas classifica a situacao atual para reduzir ambiguidade antes de qualquer decisao de release.

## Estado observado

O mapa de readiness registra:

- `agent-run-driver-gate` verde;
- `board-release-clear` ainda bloqueado por tarefas em andamento no board;
- `target-version-ready` deliberadamente falso enquanto os pacotes seguem em `0.7.0` e nao houve decisao de bump/tag/publish.

O board tem tres tarefas P3 `in_progress` que afetam o gate `board-release-clear`:

| Task | Tema | Estado | Natureza |
|---|---|---|---|
| `TASK-BUD-480` | `nousresearch/hermes-agent` | `in_progress` | influencia externa protegida |
| `TASK-BUD-521` | `mattpocock/sandcastle` | `in_progress` | influencia externa protegida |
| `TASK-BUD-676` | `aretw0/claude-mem` | `in_progress` | influencia externa protegida |

As tres aparecem no registro de influencias parked como referencias uteis, mas bounded. As notas do board tambem indicam escopo protegido, pesquisa externa e necessidade de foco humano explicito.

## Classificacao

| Gate | Classe | Bloqueia codigo? | Bloqueia release? | Acao segura |
|---|---|---:|---:|---|
| `agent-run-driver-gate` | tecnico | nao | nao | manter testes verdes |
| `target-version-ready` | decisao de operador | nao | sim, ate decisao de bump | decidir bump/tag/release quando pronto |
| `board-release-clear` | estado do board | nao diretamente | sim, pela politica atual | classificar cada task como assimilar, implementar, maturar, resolver ou parked |

## Leitura das tres tasks

| Task | Classificacao recomendada | Blocking default para 0.8.0 | Primeira acao local-safe |
|---|---|---:|---|
| `TASK-BUD-480` | assimilar | indefinido pelo operador | matriz report-only de padroes de agentes local-first, sem clonar/rodar codigo |
| `TASK-BUD-521` | assimilar | indefinido pelo operador | comparar conceitos de isolamento com os limites atuais de driver/spawn/log/registry |
| `TASK-BUD-676` | assimilar | indefinido pelo operador | comparar memoria/sessao com handoff, summaries, registry e arquivos de resultado do driver |

## Decisao recomendada

Para 0.8.0, estas tarefas devem ser tratadas como candidatas de evidencia de release, nao como trabalho tecnico automatico. Elas so devem virar hard blockers se o operador decidir que a 0.8.0 precisa assimilar uma dessas influencias antes do bump.

Sem essa decisao, o caminho mais conservador e:

1. manter `board-release-clear` como bloqueio visivel;
2. registrar que o bloqueio e de board-state, nao de gate tecnico;
3. executar no maximo uma assimilacao bounded por vez, via driver agnostico e artefato local;
4. nao fazer pesquisa externa, clone, provider real ou automacao forte sem autorizacao explicita.

## Proximo passo de demonstracao

Se o objetivo for provar que o projeto consegue trabalhar sobre si mesmo, a proxima fatia deve usar a cadeia agnostica ja validada:

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
