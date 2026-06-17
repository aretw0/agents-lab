---
title: Context Economy Calibration
description: Evidence-first primitive for context-window, cache and compaction tactics.
---

# Primitiva: Calibração de Economia de Contexto

## Categoria

Memória / Observabilidade / Governança

## Problema

Técnicas para lidar com janela de contexto envelhecem rápido. Cache, preload, compactação, sumarização, memória externa e seleção de modelo podem melhorar uma aplicação e piorar outra. Quando viram regra global sem medição, elas criam bloat, mascaram regressões e passam a depender de vibes.

## Objetivo

Tratar qualquer técnica de economia de contexto como hipótese calibrada, não como doutrina permanente. A primitiva existe para decidir `promote | hold | rollback` com evidência curta e reproduzível.

## Contrato Mínimo

Um experimento de economia de contexto precisa declarar:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `scope` | sim | Runtime, modelo ou aplicação onde a hipótese vale. |
| `hypothesis` | sim | Exemplo: reduzir histórico do classificador diminui tokens sem aumentar falso positivo. |
| `baseline` | sim | Estado comparável antes da mudança. |
| `variant` | sim | Mudança testada: cache, preload, summary, compact threshold, modelo, payload curto. |
| `metrics` | sim | Pelo menos uma métrica de custo e uma de qualidade. |
| `validUntil` | sim | Data, versão de runtime ou condição que exige recalibração. |
| `rollback` | sim | Como desativar a técnica sem perder continuidade. |
| `decision` | sim | `promote`, `hold` ou `rollback`. |

Métricas mínimas:

- custo: tokens, bytes de handoff, tamanho de payload, latência ou uso de quota;
- qualidade: taxa de conclusão, falso positivo/negativo, necessidade de reload, perda de evidência ou retrabalho;
- ruído: número de avisos, prompts redundantes ou payloads abertos sem necessidade.

## Invariantes

1. **Model-aware, não model-bound**: registrar provider/model/runtime como escopo, mas não transformar um ajuste de um modelo em regra global.
2. **Sem cache implícito permanente**: cache e preload têm validade, origem e rollback.
3. **Compactação não é sucesso**: reduzir tokens só conta se preservar decisão, evidência e continuidade.
4. **Payload curto antes de memória mágica**: preferir summary fields, selectors e packets bounded antes de recall amplo.
5. **Report-only antes de automação**: sinais de economia são advisory até existir canário e rollback.
6. **Recalibração por mudança relevante**: trocar modelo, provider, runtime, prompt base ou tipo de tarefa invalida a conclusão anterior.

## Método Local No agents-lab

Use esta sequência quando houver suspeita de bloat de contexto:

1. Capturar baseline com um comando ou surface existente.
2. Definir uma variante pequena.
3. Rodar comparação bounded.
4. Registrar artefato em `docs/research/data/context-economy/` ou verificação curta no board.
5. Promover apenas se custo melhora sem degradar qualidade.

Superfícies já existentes:

- `context_watch_status` e sinais de `contextEconomy` para oportunidades passivas;
- `context_watch_freshness_status` para frescor de preload/handoff;
- `scripts/benchmarks/run-context-economy-ab.mjs` para comparação A/B;
- `quota-visibility` e `session-analytics` para consumo observado;
- board summaries e decision packets para reduzir payload sem esconder evidência.

## Decisão

| Resultado | Decisão |
|---|---|
| Custo menor e qualidade estável | `promote` com `validUntil` explícito |
| Custo menor mas qualidade incerta | `hold` e manter report-only |
| Qualidade piora, evidência some ou ruído aumenta | `rollback` |
| Resultado depende de modelo específico | `promote` apenas para aquele escopo |

## Antipadrões

- Ajustar thresholds de compactação sem observar retrabalho ou perda de evidência.
- Adicionar cache/preload porque parece sofisticado.
- Manter summaries longos e também payload completo no mesmo hot path.
- Usar benchmark antigo após troca de modelo/runtime como prova atual.
- Transformar regra de uma aplicação em default da stack.

## Estado Atual

O agents-lab já tem peças suficientes para operar esta primitiva sem criar runtime novo: context-watchdog, context-preload, quota/session analytics e benchmark A/B. A direção correta é consolidar esses sinais como calibração periódica, não empilhar novas técnicas de memória.
