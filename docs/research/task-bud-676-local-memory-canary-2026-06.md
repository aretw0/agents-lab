---
title: TASK-BUD-676 Local Memory Canary
description: Local-safe memory and session continuity evidence for the TASK-BUD-676 external influence lane.
---

# TASK-BUD-676 local memory canary

Data: 2026-06-10  
Task: `TASK-BUD-676`  
Modo: local-safe, report-only, sem pesquisa externa

## Objetivo

Transformar `TASK-BUD-676` em um canario bounded de memoria/sessao sem consultar `aretw0/claude-mem` ainda. A pergunta local e:

> A stack ja tem memoria operacional suficiente para retomar trabalho e coordenar agentes sem depender da conversa como unica fonte de verdade?

## Resultado

Sim, para memoria operacional. Ainda nao para memoria semantica autonoma.

A stack atual ja consegue preservar foco, evidencia e continuidade por arquivos locais auditaveis. O que falta antes de comparar uma ferramenta externa de memoria e uma classificacao explicita do tipo de memoria esperado por cada fluxo.

## Evidencia local

| Propriedade | Evidencia atual | Classificacao |
|---|---|---|
| Handoff local | `context_watch_checkpoint` escreve checkpoint bounded em `.project/handoff.json` | maduro para retomada operacional |
| Freshness/readiness | context-watch exporta freshness, budget, continuation readiness e auto-resume preview | maduro para decisao report-only |
| Preload de contexto | context-watch exporta `context-preload-pack` e leitura canonica de estado | maduro para preparar retomada curta |
| Registry de runs | `agent-run-driver-step` registra `.pi/reports/agent-runs.json` com estado, cwd, declared files, log e output bytes | maduro para memoria de execucao |
| Resultado em arquivo | `agent-run:driver-step --out`, `agent-run:pi-driver --out` e payload/result file-chain preservam pacotes fora do stdout | maduro para handoff entre agentes |
| Summary compacto | driver e pi-driver retornam summary de uma linha com decision, dispatch, follow, estado, bytes e contrato | maduro para leitura rapida |
| Outcome local | `follow=true` + `build_outcome=true` materializa `agent-run-outcome-packet` | maduro para evidencia verificavel |
| Board como memoria | `.project/tasks.json` preserva backlog/status/rationale, mas deve ser editado por superficies bounded | maduro como adapter inicial |
| Memoria semantica | nao ha camada canonica de fatos aprendidos, preferencias e recall por tema com politica de expiracao | lacuna intencional |
| Memoria multi-projeto | doutrina permite adapters externos, mas o contrato distribuido ainda e local-first | lacuna futura |

## Limite semantico

Esta stack deve chamar de **memoria operacional** aquilo que permite:

- saber qual era o foco;
- saber o que foi validado;
- saber quais commits/artefatos existem;
- saber qual run executou, com qual log e qual outcome;
- retomar com contexto curto e auditavel.

Ela nao deve chamar de memoria operacional:

- preferencias inferidas sem consentimento;
- fatos sem origem;
- resumo sem data/freshness;
- estado que nao pode ser auditado ou descartado;
- recall que muda decisao de execucao sem aprovacao.

## Comparacao futura de influencia externa

Quando houver autorizacao explicita para consultar a referencia externa, a comparacao deve usar esta matriz:

| Pergunta | Aceitar padrao externo se... | Rejeitar se... |
|---|---|---|
| Origem | todo item de memoria tem fonte e timestamp | depende de resumo opaco sem provenance |
| Escopo | memoria distingue projeto, task, run e preferencia | mistura fatos globais com estado local |
| Freshness | existe expiracao ou stale signal | recall antigo volta como verdade atual |
| Consentimento | memoria sensivel exige decisao explicita | coleta ou aplica preferencias automaticamente |
| Portabilidade | funciona com `.project/` e adapters externos | exige servico remoto como fonte primaria |
| Operacao | melhora handoff/retomada sem inflar contexto | injeta grandes blocos na conversa por default |

## Proximo passo recomendado

Antes de pesquisar fora, fortalecer a lacuna local mais barata:

1. adicionar uma taxonomia documentada de memoria:
   - `operational-state`;
   - `execution-evidence`;
   - `operator-preference`;
   - `project-fact`;
   - `external-influence`;
2. exigir `source`, `timestamp`, `freshness` e `scope` para qualquer memoria promovida;
3. manter `.project/` como adapter inicial, mas documentar que a primitive deve aceitar adapters equivalentes;
4. manter recall como report-only ate haver aprovacao para aplicar mudanca.

## Contrato local de aceite

Para `TASK-BUD-676`, a avaliacao protegida deve passar sem pesquisa externa
somente quando estes criterios locais estiverem explicitos:

- contrato local-first de memoria/sessao definido antes de consultar qualquer
  referencia externa;
- pesquisa externa e aplicacao automatica de recall exigem consentimento
  explicito do operador;
- toda memoria promovida carrega `source`, `timestamp`, `freshness`, `scope`,
  politica de retencao e criterio de expiracao;
- tipos de memoria sao classificados antes do uso:
  - `operational-state`;
  - `execution-evidence`;
  - `operator-preference`;
  - `project-fact`;
  - `external-influence`;
- recall e comparacao de influencia externa permanecem report-only ate
  aprovacao humana explicita.

Retencao canonica minima:

| Tipo | Retencao | Expiracao |
|---|---|---|
| `operational-state` | enquanto o run/task estiver ativo | quando houver outcome terminal ou handoff substituto |
| `execution-evidence` | enquanto o artefato de release/canario referenciar o run | quando o artefato for arquivado ou supersedido |
| `operator-preference` | somente com consentimento explicito | quando revogada, stale ou fora do escopo declarado |
| `project-fact` | enquanto a fonte versionada existir | quando a fonte mudar ou a evidencia ficar stale |
| `external-influence` | parked/protected por padrao | quando assimilada, rejeitada ou revalidada com aprovacao |

## Decisao de release

`TASK-BUD-676` nao precisa bloquear a 0.8.0 por falta de pesquisa externa se esta decisao for aceita:

- 0.8.0 promete memoria operacional auditavel;
- 0.8.0 nao promete memoria semantica autonoma;
- assimilacao externa de memoria fica como trabalho futuro bounded.

## Nao feito

- Nao consulta rede.
- Nao clona `claude-mem`.
- Nao executa `ant_colony`.
- Nao edita `.project/tasks.json`.
- Nao muda `decision.md`.
