# Pesquisa — agents-lab

Este diretório armazena pesquisas, análises e material de referência sobre o ecossistema de agentes de IA.

## Índice

> 🚧 Em construção — novos documentos serão adicionados conforme as sessões de pesquisa acontecem.

| Documento | Descrição | Status |
|-----------|-----------|--------|
| [pi-extension-scorecard.md](./pi-extension-scorecard.md) | Avaliação das principais referências e pacotes do ecossistema Pi | Inicial |
| [pi-extension-categories.md](./pi-extension-categories.md) | Taxonomia de extensões Pi por workflow do laboratório | Inicial |
| [extension-factory-blueprint.md](./extension-factory-blueprint.md) | Blueprint de como estruturar futura fábrica de extensões Pi | Inicial |
| [extension-factory-friction-analysis.md](./extension-factory-friction-analysis.md) | Fricções e riscos antes de abrir uma trilha in-house | Inicial |
| [overlap-matrix.md](./overlap-matrix.md) | Matriz de sobreposição entre pacotes da stack e direção de consolidação first-party | Draft |
| [web-overlap-scorecard.md](./web-overlap-scorecard.md) | Avaliação específica de overlap Web (oh-pi, pi-web-access, first-party) | Draft |
| [web-runtime-benchmark-plan.md](./web-runtime-benchmark-plan.md) | Plano de benchmark runtime para validar overlap Web em uso real | Draft |
| [web-runtime-benchmark-run-2026-04-13.md](./web-runtime-benchmark-run-2026-04-13.md) | Resultado completo do benchmark Web (6/6 tarefas) com evidências de roteamento | Draft |
| [web-routing-ab-protocol.md](./web-routing-ab-protocol.md) | Protocolo A/B com thresholds para decidir hard enforcement de web-browser | Draft |
| [web-routing-ab-run-2026-04-13.md](./web-routing-ab-run-2026-04-13.md) | Resultado A/B de roteamento web com decisão de sobriedade | Draft |
| [web-routing-ab-run-2026-04-13-novpn-cf.md](./web-routing-ab-run-2026-04-13-novpn-cf.md) | Revalidação A/B sem VPN focada em cenários npmjs/Cloudflare | Draft |
| [web-routing-next-steps.md](./web-routing-next-steps.md) | Backlog operacional da trilha de roteamento web (checklist vivo) | Draft |
| [colony-readiness-checklist.md](./colony-readiness-checklist.md) | Gate de prontidão para liberar colônias com guardrails e regressão | Draft |
| _(em breve)_ | Estado da arte em primitivas de agentes | Pendente |
| _(em breve)_ | Padrões de design para sistemas multi-agentes | Pendente |

## Temas de Pesquisa

### Convergência do Ecossistema

Análise de como ferramentas e frameworks independentes estão convergindo para conceitos similares — o que Pi "padronizou" e como isso se relaciona com o restante do ecossistema.

### Baixa Fricção Cognitiva

Pesquisa sobre qual é o estado da arte em **estruturas de baixa fricção cognitiva** para trabalhar com agentes:

- Quais abstrações reduzem a carga mental?
- Como organizar primitivas para máxima reutilização?
- Qual é a melhor estrutura de repositório para o longo prazo?

### Avaliação de Engines

Critérios e metodologias para comparar engines de agentes além do Pi, garantindo que o laboratório possa **superar o Pi** caso necessário.

## Formato de Pesquisa

Cada documento de pesquisa deve conter:

- **Contexto** — por que essa pesquisa é relevante
- **Metodologia** — como a pesquisa foi conduzida
- **Descobertas** — resultados e análises
- **Conclusões** — implicações práticas para o laboratório
- **Referências** — links e fontes
