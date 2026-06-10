---
title: TASK-BUD-521 Local Isolation Canary
description: Local-safe isolation and sandboxing evidence for the TASK-BUD-521 external influence lane.
---

# TASK-BUD-521 local isolation canary

Data: 2026-06-10  
Task: `TASK-BUD-521`  
Modo: local-safe, report-only, sem pesquisa externa

## Objetivo

Transformar `TASK-BUD-521` em um canario bounded de isolamento/sandboxing sem consultar `mattpocock/sandcastle` ainda. A pergunta local e:

> A camada `agent-run` ja tem um envelope operacional suficientemente claro para comparar uma referencia externa de sandboxing sem contaminar a 0.8.0 com pesquisa aberta?

## Resultado

Sim, com limite claro. A camada local ja cobre isolamento operacional basico para um processo unico, mas ainda nao deve ser apresentada como sandbox forte.

## Evidencia local

| Propriedade | Evidencia atual | Classificacao |
|---|---|---|
| Preview sem execucao | `agent-run:driver-step` retorna `ready-for-operator-decision` com `dispatchAllowed=false` e `processStartAllowed=false` | maduro para preview |
| Aprovacao explicita | `execute=true` bloqueia sem `operator_approval` estruturado | maduro para dispatch controlado |
| Um processo por step | `dispatchRun` chama um unico `spawn(...)` por dispatch aprovado | maduro para single-run |
| Registry antes/depois | escreve `planned`, depois `running`, depois estado terminal (`completed`, `failed` ou `timed-out`) | maduro para auditoria basica |
| CWD guard | `execute-cwd-mismatch` bloqueia quando o `run_spec.cwd` difere do `cwd` do driver | maduro para evitar dispatch fora do workspace esperado |
| Duplicidade | `run-already-running` bloqueia novo dispatch para run em `running` | maduro para reentrada simples |
| Log rastreavel | `logPath` e tail bounded entram em follow/outcome | maduro para diagnostico |
| Shell desabilitado | spawn usa `shell: false` | maduro para reduzir interpolacao acidental |
| Outcome local | `follow=true` + `build_outcome=true` materializa `agent-run-outcome-packet` sem fan-in automatico | maduro para evidencia parent-side |
| Sandbox forte | nao ha namespace/container/worktree obrigatorio por run | lacuna intencional |

## Limite semantico

Esta camada e **driver operacional agnostico**, nao sandbox forte. Ela controla:

- quando um processo pode iniciar;
- qual `cwd` e aceito;
- qual comando/argv sera executado;
- como o processo e registrado;
- onde logs e outcomes ficam;
- quando uma run e terminal.

Ela ainda nao isola por si so:

- filesystem via worktree efemero;
- rede;
- CPU/memoria;
- namespace de processo;
- credenciais;
- escrita fora do workspace por um binario malicioso.

## Como comparar uma influencia externa depois

Quando houver autorizacao explicita para consultar a referencia externa, a comparacao deve se limitar a esta matriz:

| Pergunta | Aceitar padrao externo se... | Rejeitar se... |
|---|---|---|
| Workspace isolation | melhora `cwd/worktree` sem exigir runner remoto | depende de infraestrutura externa para caso local |
| Process lifecycle | melhora planned/running/terminal sem ocultar estado | substitui registry auditavel por estado implicito |
| Log/evidence | melhora logs/outcomes bounded | exige captura opaca ou sem replay |
| Policy boundary | torna rede/credenciais/FS mais explicitos | cria permissao ampla por default |
| Rollback | simplifica descarte de efeitos | exige limpeza manual ampla |

## Proximo passo recomendado

Antes de pesquisar fora, fortalecer a lacuna local mais barata:

1. adicionar um modo report-only de `agent-run` que classifique o isolamento efetivo da run (`logical`, `workspace`, `worktree`, `container`, `unknown`);
2. manter `logical` como default atual;
3. exigir evidencia explicita antes de qualquer classificacao maior que `logical`;
4. fazer o release readiness reportar essa classificacao como evidencia, nao como promessa de sandbox forte.

## Decisao de release

`TASK-BUD-521` nao precisa bloquear a 0.8.0 por falta de pesquisa externa se esta decisao for aceita:

- 0.8.0 promete driver local controlado e auditavel;
- 0.8.0 nao promete sandbox forte por processo;
- pesquisa externa de sandboxing fica como assimilacao futura bounded.

## Nao feito

- Nao consulta rede.
- Nao clona `sandcastle`.
- Nao executa `ant_colony`.
- Nao edita `.project/tasks.json`.
- Nao muda `decision.md`.
