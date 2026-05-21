# Pesquisa — agents-lab

Este diretório guarda evidência datada, investigações, scorecards e checkpoints. Research pode orientar decisão, mas não é contrato público nem documentação operacional até ser promovido para `docs/guides`, `docs/primitives` ou `docs/architecture`.

## Como ler

- Use research para entender contexto, decisão e evidência histórica.
- Prefira guias, primitives e architecture para comportamento atual.
- Trate `draft`, `run`, `checkpoint` e `closure` como material de bastidor.
- Ao promover uma conclusão, crie ou atualize a página canônica menor e deixe o research como referência.

## Índices selecionados

| Documento | Descrição | Status |
|-----------|-----------|--------|
| [0-8-readiness-map.md](./0-8-readiness-map.md) | Estado verificável e próximos passos da 0.8.0 | Promovido como evidência selecionada |
| [0-8-local-safe-compounding-lane.md](./0-8-local-safe-compounding-lane.md) | Lane local-safe de estabilização 0.8 | Evidência selecionada |
| [0-8-delegation-long-run-runway.md](./0-8-delegation-long-run-runway.md) | Runway de delegação e long-run | Evidência selecionada |
| [overlap-matrix.md](./overlap-matrix.md) | Matriz de sobreposição entre pacotes da stack e direção de consolidação first-party | Ativo |
| [pi-extension-scorecard.md](./pi-extension-scorecard.md) | Avaliação das principais referências e pacotes do ecossistema Pi | Inicial |
| [pi-extension-categories.md](./pi-extension-categories.md) | Taxonomia de extensões Pi por workflow do laboratório | Inicial |
| [extension-factory-blueprint.md](./extension-factory-blueprint.md) | Blueprint de como estruturar futura fábrica de extensões Pi | Inicial |
| [extension-factory-friction-analysis.md](./extension-factory-friction-analysis.md) | Fricções e riscos antes de abrir uma trilha in-house | Inicial |
| [web-overlap-scorecard.md](./web-overlap-scorecard.md) | Avaliação específica de overlap Web (oh-pi, pi-web-access, first-party) | Draft |
| [web-runtime-benchmark-plan.md](./web-runtime-benchmark-plan.md) | Plano de benchmark runtime para validar overlap Web em uso real | Draft |
| [web-runtime-benchmark-run-2026-04-13.md](./web-runtime-benchmark-run-2026-04-13.md) | Resultado completo do benchmark Web (6/6 tarefas) com evidências de roteamento | Draft |
| [web-routing-ab-protocol.md](./web-routing-ab-protocol.md) | Protocolo A/B com thresholds para decidir hard enforcement de web-browser | Draft |
| [web-routing-ab-run-2026-04-13.md](./web-routing-ab-run-2026-04-13.md) | Resultado A/B de roteamento web com decisão de sobriedade | Draft |
| [web-routing-ab-run-2026-04-13-novpn-cf.md](./web-routing-ab-run-2026-04-13-novpn-cf.md) | Revalidação A/B sem VPN focada em cenários npmjs/Cloudflare | Draft |
| [web-routing-ab-run-2026-04-13-guardrails-core-r1.md](./web-routing-ab-run-2026-04-13-guardrails-core-r1.md) | Rodada 1 de regressão estável após consolidação do guardrails-core | Draft |
| [web-routing-ab-stability-2026-04-13.md](./web-routing-ab-stability-2026-04-13.md) | Consolidação das 3 rodadas de estabilidade do roteamento web com guardrails-core | Draft |
| [web-routing-next-steps.md](./web-routing-next-steps.md) | Backlog operacional da trilha de roteamento web (checklist vivo) | Draft |
| [colony-readiness-checklist.md](./colony-readiness-checklist.md) | Gate de prontidão para liberar colônias com guardrails e regressão | Draft |
| [colony-monitor-interference-assessment.md](./colony-monitor-interference-assessment.md) | Avaliação inicial de interferência entre monitores de sessão e colônia | Draft |
| [colony-monitor-interference-run-2026-04-13-r1.md](./colony-monitor-interference-run-2026-04-13-r1.md) | Resultado A/B (monitors on/off) em execução real de colônia | Draft |
| [session-triage-run-2026-04-15.md](./session-triage-run-2026-04-15.md) | Execução de tidy up + triagem de sessões recentes para backlog operacional | Draft |

## Temas de Pesquisa

### Convergência do Ecossistema

Análise de como ferramentas e frameworks independentes implementam conceitos similares e onde isso afeta a stack do laboratório.

### Baixa Fricção Cognitiva

Pesquisa sobre estruturas de baixa fricção cognitiva para trabalhar com agentes:

- Quais abstrações reduzem a carga mental?
- Como organizar primitivas para máxima reutilização?
- Qual é a melhor estrutura de repositório para o longo prazo?

### Avaliação de Engines

Critérios e metodologias para comparar engines de agentes além do Pi e preservar portabilidade das primitivas quando fizer sentido.

## Formato recomendado

Cada documento de pesquisa deve conter:

- **Contexto** — por que essa pesquisa existe.
- **Método** — como a evidência foi coletada.
- **Achados** — o que foi observado.
- **Decisão ou próximo passo** — promover, manter em research ou descartar.
- **Referências** — links, comandos, commits ou artefatos usados.
