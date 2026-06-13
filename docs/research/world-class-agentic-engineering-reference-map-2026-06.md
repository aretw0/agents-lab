---
title: World-class agentic engineering reference map
description: Curatorial map for continuing 0.8 work with agnostic workers and explicit external-research gates.
---

# World-class agentic engineering reference map

Data: 2026-06-13

## Decisao operacional

Release readiness verde nao significa release agora.

O estado `release-readiness-report: ready` deve ser lido como baseline
tecnica limpa, nao como decisao de lancamento. A direcao ativa continua sendo
usar o board para provar robustez por trabalho real, com workers agnosticos,
evidencia local e fan-in parent-side antes de qualquer promocao.

## World-class reference, sem dependencia implicita

World-class reference e uma curadoria honesta de padroes externos e internos:
ela inspira criterios, vocabulario, testes e tarefas locais. Ela nao entra como
dependencia, runtime, recall implicito, permissao de rede ou promessa publica
sem evidencia.

| Area | Evidencia local atual | Referencias assimiladas | Proxima pergunta |
|---|---|---|---|
| Pi/refarm | primitives de worker, driver step e release gates | evidencias locais do pi-stack e do board | Que contrato distribuivel falta para outros agentes usarem sem conhecer a conversa? |
| Agent/tool envelope | `docs/primitives/agent-worker-envelope.md` | `nousresearch/hermes-agent` via fan-in aprovado | O envelope cobre tool intent, declared files, approval, follow e outcome sem prometer swarm? |
| Memoria/sessao | `context-preload-consume` e `applicationMode` | `aretw0/claude-mem` via fan-in aprovado | Como preservar continuidade sem recall implicito nem contexto nao provenanceado? |
| Isolamento/sandbox | `docs/primitives/agent-worker-isolation.md` | `mattpocock/sandcastle` via fan-in aprovado | Quais claims de sandbox ficam bloqueadas ate teste local forte? |
| Engenharia agentica | board audit, fanout rehearsal, driver canary suite | referencias locais de dogfooding e docs de primitives | Que lacunas de qualidade impedem aumentar volume com seguranca? |

## Regras de pesquisa externa

Toda nova pesquisa externa deve passar por intake antes de URL fetch:

- usar `docs/primitives/external-influence-intake-template.md`;
- declarar hipotese, valor, risco, esforco, canario, rollback e stop conditions;
- aprovar fontes explicitamente por nome ou URL;
- bloquear clone, install e execucao de codigo externo por default;
- produzir artifact pequeno com provenance timestamp e aplicabilidade;
- converter o fan-in em tasks locais antes de qualquer codigo.

sem URL fetch e o default. URL fetch so acontece quando o operador aprova a
fonte e o escopo. Mesmo assim, pesquisa externa nao autoriza release, publish,
workflow dispatch, provider remoto ou `ant_colony`.

## Como workers agnosticos entram

Workers entram para atacar trabalho real, nao para criar movimento artificial.
Cada worker deve receber:

- `runSpec` ou handoff agnostico;
- arquivos declarados;
- contrato de output pequeno;
- stop conditions;
- expected artifact;
- criterio de outcome;
- fan-in parent-side.

Exemplos de slices adequadas:

| Slice | Worker adequado | Output esperado | Fan-in |
|---|---|---|---|
| Revisar envelope contra referencias locais | read-only worker | lacunas e proposta de patch | bloquear sem evidencia por arquivo/linha |
| Comparar memoria/sessao com schema local | read-only worker | matriz aplicavel/nao aplicavel | bloquear recall implicito |
| Testar isolamento de worker | local process worker | canary e outcome packet | bloquear touched files inesperados |
| Preparar nova pesquisa externa | report-only worker | intake preenchido | bloquear sem aprovacao literal de fonte |
| Assimilar pesquisa aprovada | read-only synthesis worker | task local com files/criteria/tests | bloquear clone/install/execucao externa |

## Criterios para 0.8 continuar aberta

Manter a 0.8 aberta enquanto uma destas condicoes for verdadeira:

1. existe referencia aprovada sem assimilacao local;
2. existe claim publica maior que a evidencia local;
3. existe worker flow que ainda precisa de operador como cola evitavel;
4. existe task protegida que pode ser destravada com intake local-safe;
5. existe teste/canary local que ainda nao prova o volume desejado.

Fechar a 0.8 so deve voltar a ser considerado quando o board estiver limpo e
essas condicoes forem revisadas explicitamente, nao apenas quando o release
readiness estiver verde.

## Nao objetivos

- transformar 0.8 em promessa de swarm amplo;
- acoplar a arquitetura a colony;
- usar pesquisa externa como recall automatico;
- criar primitive nova quando um report/intake existente resolve;
- liberar release/tag/publish por automacao;
- usar provider remoto para validar trabalho que pode ser provado localmente.
