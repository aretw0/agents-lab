---
title: 0.8 Potential Completeness Map
description: Local-safe map for continuing board work before considering 0.8.0 release close.
---

# 0.8 potential completeness map

Data: 2026-06-12

## Decisao operacional

Release readiness verde nao significa release agora.

O gate de release mostrou que a baseline pode ser publicada quando houver
decisao explicita, mas a direcao de trabalho continua sendo o board: usar as
evidencias locais e workers para atacar lacunas reais ate a 0.8.0 parecer
robusta por uso, nao apenas por checklist.

## Separacao de conceitos

| Conceito | Estado | Implicacao |
|---|---|---|
| Release gate | Verde e protegido | Pode esperar; nao deve puxar tag automaticamente |
| Board real | Reaberto com tasks local-safe | Fonte primaria do proximo trabalho |
| Workers | Meio de execucao e revisao | Devem acelerar tarefas reais, nao virar objetivo abstrato |
| Influencias externas parked | Local evidence passou | Podem ser assimiladas por contrato local sem consultar rede |
| Engine agnostica | Obrigatoria | Core/primitives devem ficar separados de adapters Pi |

## Lanes executaveis

| Lane | Task | Trabalho real | Local-safe/protected | Resultado esperado |
|---|---|---|---|---|
| Completeness map | `TASK-BUD-1099` | Converter roadmap/evidencias em lanes executaveis | local-safe | este mapa e board acionavel |
| Agent patterns | `TASK-BUD-1100` | Assimilar `TASK-BUD-480` em primitive de worker envelope | local-safe | contrato distribuivel de single-worker |
| Isolation | `TASK-BUD-1101` | Assimilar `TASK-BUD-521` em requisitos/testes de isolamento | local-safe | requisitos executaveis para driver/spawn |
| Operational memory | `TASK-BUD-1102` | Assimilar `TASK-BUD-676` em schema/canary local | local-safe | validacao de memoria operacional sem recall externo |
| External agent/tool influence | `TASK-BUD-1113` | Assimilar vocabulario externo aprovado no envelope agnostico | local-safe | influencia documentada sem promessa de swarm |
| External memory vocabulary | `TASK-BUD-1114` | Comparar vocabulario de memoria/sessao com schema local | local-safe | sem recall implicito |
| Sandbox comparison | `TASK-BUD-1115` | Registrar comparacao de isolamento sem prometer sandbox forte sem evidencia | local-safe 0.8 hardening | hardening da 0.8 com claim evidence-gated |

## External influence fan-in de 2026-06-13

O fan-in local em `.project/reports/external-influence-fanin-0-8.json`
converteu tres fontes externas aprovadas em trabalho local:

- `nousresearch/hermes-agent`: influencia de agent/tool flow aplicavel ao
  envelope agnostico, sem virar promessa de swarm na 0.8;
- `aretw0/claude-mem`: influencia de memoria/sessao aplicavel a provenance,
  timestamp e freshness, sem recall implicito;
- `mattpocock/sandcastle`: vocabulario util para isolamento, classificado como
  hardening da 0.8; a claim de sandbox forte continua bloqueada ate existir
  teste local suficiente.

Essa assimilacao nao adiciona dependencias externas e nao autoriza nova rede,
clone, install, execucao de codigo externo, release, publish, workflow dispatch
ou `ant_colony`.

Clarificacao de escopo: "nao prometer" nao significa "adiar para depois da
0.8". O trabalho pode e deve entrar no board da 0.8 quando for local-safe; o
que fica bloqueado e apenas a afirmacao publica de capacidade forte sem
evidencia local.

Memoria operacional para influencia externa deve usar `type:
external-influence` e `applicationMode` explicito. Modos aceitos:
`reference-only`, `operator-reviewed`, `local-task-seed` e `none`.
`implicit-recall` e blocker semantico: a influencia pode orientar revisao local, mas nao
autoriza recuperar ou aplicar contexto automaticamente.

## Como usar workers daqui para frente

Workers devem ser usados para tarefas reais quando o board ja declarar:

- arquivos primarios;
- acceptance criteria;
- limite local-safe/protected;
- output esperado;
- criterio de fan-in ou conclusao parent-side.

O aumento de volume deve vir depois de ciclos passarem com:

- worker terminal;
- outcome `pass`;
- `touchedFiles` coerente com o contrato;
- fan-in ou parent validation sem reparo manual;
- evidencias registradas no board/docs.

## Proxima fatia recomendada

Atacar `TASK-BUD-1100` primeiro.

Motivo: ela transforma a evidencia de agente/worker ja aprovada em um
contrato distribuivel, agnostico e reutilizavel. Isso fortalece qualquer uso
seguinte de workers sem depender de release, colônia ou provider especifico.

## Nao objetivos desta fase

- criar tag `v0.8.0`;
- publicar pacote;
- consultar influencias externas;
- promover swarm como default;
- executar protected scope sem aprovacao literal;
- tratar coordenacao de workers como fim em si.
