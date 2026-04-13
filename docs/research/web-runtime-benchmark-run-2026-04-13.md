---
created: 2026-04-13
status: draft
---

# Web Runtime Benchmark — Run 2026-04-13 (completo)

## Contexto do run

- Escopo: validação runtime do overlap Web da stack.
- Execução: `pi -p --no-session --mode json` com parsing de tool events.
- Cobertura: **6/6 tarefas** (A1, A2, B1, B2, C1, C2).
- Artefatos:
  - `docs/research/data/web-benchmark/run-2026-04-13/results.json`
  - script: `scripts/benchmarks/run-web-overlap-benchmark.py`

## Resultado consolidado por tarefa

| Tarefa | Categoria | Tempo (s) | Tools únicas |
|---|---|---:|---|
| A1 | quick-lookup | 36.57 | `bash` |
| A2 | quick-lookup | 60.44 | `bash` |
| B1 | deep-research | 73.24 | `bash`, `read` |
| B2 | deep-research | 78.51 | `bash`, `read` |
| C1 | browser-automation | 51.61 | `bash` |
| C2 | browser-automation | 50.63 | `bash` |

## Leitura do comportamento observado

1. **Rota dominante foi `bash`** em todos os cenários.
2. **Deep research** usou `bash + read` e entregou evidência com permalink (B1/B2).
3. **Browser automation** (C1/C2) **não acionou CDP** (`web-browser`), resolvendo via shell/fetch indireto.
4. Em relação ao objetivo de overlap Web, o run mostrou que a ambiguidade principal é de **policy de roteamento**, não de conflito técnico de nomes.

## Score resumido (1-5)

| Dimensão | Score | Observação |
|---|---:|---|
| Latência útil | 4 | respostas úteis em ~36s–78s |
| Qualidade | 4 | respostas corretas e estruturadas na maior parte |
| Evidência | 4 | B1/B2 com permalinks fortes; quick/browser com links canônicos |
| Ruído operacional | 4 | baixo retrabalho no run final |
| Determinismo de rota | 2 | convergiu demais para `bash`, sem respeitar intenção de browser/CDP |

## Conclusões do run completo

1. **Quick lookup funciona bem com rota shell/web leve**, mas não valida preferência por ferramentas Web especializadas.
2. **Deep research está sólido** no padrão investigação em código com leitura/permalinks.
3. **Browser tasks precisam policy explícita** para forçar `web-browser` quando a intenção exigir navegação/interação real.
4. A consolidação first-party deve priorizar **regras de roteamento** (quando usar bash vs web tools vs CDP), além de filtrar overlaps de skill.

## Próxima ação recomendada

Adicionar guardrails no playbook (`source-research` + docs da stack):

- Se pedido contém “abrir/navegar/clicar/form”, priorizar `web-browser` (CDP).
- Se pedido contém “permalink/linhas/implementação”, priorizar `fetch_content` + `bash/read`.
- Se pedido é lookup curto factual, aceitar rota leve (bash/web_search), mas exigir URL canônica.
