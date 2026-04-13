---
created: 2026-04-13
status: draft
---

# Web Routing A/B — Run 2026-04-13 (guardrails-core r1)

## Contexto

Primeira rodada de regressão estável após consolidar guardrails em uma única extensão (`guardrails-core`).

- Taskset: `cloudflare-recheck`
- Dataset: `docs/research/data/web-routing-ab/run-2026-04-13-guardrails-core-r1/results.json`
- Política ativa: pre-router determinístico + bloqueio hard de comandos proibidos em modo estrito

## Métricas agregadas

| Braço | Success rate | Tempo médio (s) | CDP-path rate | Fallback rate | Disallowed command rate |
|---|---:|---:|---:|---:|---:|
| A (baseline) | 1.00 | 76.42 | 1.00 | 0.00 | 0.00 |
| B (policy-strict) | 1.00 | 72.59 | 1.00 | 0.00 | 0.00 |

## Leitura da rodada

1. O enforcement técnico estabilizou o comportamento no cenário sensível (npmjs/Cloudflare-like).
2. Ambos os braços seguiram caminho CDP (`cdpPathRate=100%`) sem fallback para scraping.
3. Não houve comandos proibidos detectados em nenhum braço.
4. A latência ficou próxima entre braços (diferença pequena), sem regressão de sucesso.

## Implicação para a trilha

- Esta rodada conta como **1/3** da meta de estabilidade do taskset `cloudflare-recheck`.
- Próximo passo: repetir mais 2 rodadas para fechar o critério de estabilidade antes de avançar para Etapa B.
