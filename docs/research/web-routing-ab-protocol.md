---
created: 2026-04-13
status: draft
---

# Protocolo A/B — Roteamento Web (sobriedade para hard enforcement)

## Objetivo

Decidir com critério se vale ativar **hard enforcement** para intents interativas de web (`web-browser`/CDP), evitando decisão por impressão.

## Hipótese

Uma política mais rígida de roteamento para tarefas interativas aumenta sucesso e determinismo sem custo operacional excessivo.

## Braços do experimento

- **A (baseline):** comportamento atual da stack.
- **B (policy-strict):** instrução de roteamento explícita no prompt de sistema:
  - intent interativo → `web-browser` primeiro
  - search/extract → `web_search`/`fetch_content`
  - fallback para `bash` scraping somente após falha de browser

## Conjunto de tarefas

Focar em tarefas com intenção interativa real (abrir/navegar/clicar/form):

1. abrir docs e navegar para seção específica
2. abrir site e coletar dado após interação
3. fluxo com múltiplas etapas de navegação
4. tarefa mista (interação + síntese)

## Métricas

| Métrica | Definição |
|---|---|
| Success rate | resposta útil para a tarefa |
| Tempo útil | segundos até resposta final |
| Determinismo de rota | frequência de caminho esperado para intent interativo |
| CDP-path rate | % de tarefas interativas com evidência de scripts `web-browser` |
| Fallback rate | % de tarefas que desviam para scraping/shell sem browser |

## Critérios de decisão (gate)

Recomendar **hard enforcement** apenas se braço B atender simultaneamente:

1. `success_rate_B >= success_rate_A + 20pp`
2. `tempo_medio_B <= tempo_medio_A * 1.10`
3. `cdp_path_rate_B >= 70%`
4. `fallback_rate_B <= 15%`

Se não bater, manter soft policy e continuar refinando instruções/ambiente.

## Artefatos esperados

- dataset bruto em `docs/research/data/web-routing-ab/`
- relatório em `docs/research/web-routing-ab-run-YYYY-MM-DD.md`
- atualização de conclusão em `docs/research/overlap-matrix.md`
