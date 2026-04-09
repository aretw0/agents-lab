---
created: 2026-04-09
status: draft
---

# Taxonomia de Extensões Pi por Workflow

## Contexto

Nosso problema não é descobrir extensões. É entender quais combinações servem aos workflows que já usamos hoje com Copilot e quais lacunas ainda justificam investimento in-house.

## Metodologia

As categorias abaixo cruzam:

1. workflows já usados no laboratório
2. pacotes recorrentes no ecossistema Pi
3. julgamento sobre maturidade e sobreposição

## Categorias

| Workflow | Extensões e pacotes relevantes | Gap in-house |
|----------|-------------------------------|--------------|
| Planejamento | `@ifi/pi-plan`, `@ifi/pi-spec`, `@davidorex/pi-project`, `@davidorex/pi-workflows` | integração com nossos artefatos e backlog |
| Coding | core Pi, `oh-pi`, `git-guard`, `bg-process` | baixo |
| Code Review | `/review`, `pi-deep-review`, `pi-review-loop`, `@hyperprior/pi-review` | baixo |
| Pesquisa e exploração | `pi-web-access`, `context7`, `pi-finder-subagent`, `pi-librarian` | integração melhor com nossa base de docs |
| Documentação | `/document`, `pi-specdocs`, skills de README e changelog | templates próprios do laboratório |
| Debugging | `debug-helper`, `pi-conversation-retro`, `pi-evaluate` | baixo |
| Multi-agente | `ant-colony`, `pi-subagents`, `pi-teams`, `pi-orchestration` | alto, mas só depois de testes comparativos |
| Memória | `pi-memory`, `pi-brain`, `memex`, `pi-continuous-learning` | alto, pela importância estratégica |
| Avaliação | `pi-test-harness`, `pi-eval`, `pi-evaluate`, `pi-evalset-lab` | médio |
| Segurança e governança | `safe-guard`, `git-guard`, `pi-gate`, `pi-preflight`, `pi-sandbox` | médio |
| Qualidade de código | `pi-lens`, `biome`, `ruff`, `eslint`, `oxlint` (via pi-lens) | baixo |

## Leitura por Workflow

### Planejamento

Esta é a categoria mais importante para o momento atual do laboratório. Temos duas linhas claras:

- **planejamento operacional da sessão** com `@ifi/pi-plan` e `/spec`
- **planejamento estruturado e tipado de projeto** com `pi-project-workflows`

A lacuna não é falta de soluções. É integração com nossos próprios artefatos e convenções.

### Coding e execução

O core do Pi já resolve boa parte do trabalho. O valor adicional vem de camadas operacionais como checkpoint, footer, sessões nomeadas e backgrounding.

Conclusão: não parece haver justificativa para construir algo nosso cedo aqui.

### Code Review

Há várias soluções e prompts prontos. O risco maior não é falta de capability, e sim ruído entre opções parecidas.

Conclusão: adotar primeiro, customizar depois.

### Pesquisa e exploração

Essa categoria interessa muito ao laboratório porque grande parte do trabalho atual é curadoria. Há múltiplas opções de web search/fetch e subagentes exploratórios.

Conclusão: provavelmente precisaremos de uma combinação curada e talvez uma skill nossa para transformar pesquisa em artefato de docs.

### Documentação

O ecossistema cobre geração genérica, mas não cobre nossa estrutura interna nem nosso tom documental.

Conclusão: essa é uma candidata plausível para skill ou prompt template in-house relativamente cedo.

### Debugging

O ecossistema já oferece capacidades suficientes para investigação de erros, retros e análise de sessões.

Conclusão: adotar antes de inventar.

### Multi-agente

Esta é a categoria mais rica e mais confusa.

Há pelo menos quatro famílias de abordagem:

1. subagentes simples
2. orquestração em cadeia/paralelo/fork
3. swarms opinativos
4. times/agentes com papéis persistentes

Conclusão: evitar commitment arquitetural cedo. Precisamos comparar em uso real.

### Memória

Memória é uma capability estratégica para handoff e continuidade. Há múltiplos projetos promissores, mas sem convergência clara.

Conclusão: é uma das áreas mais prováveis de exigir curadoria forte e, mais adiante, construção própria.

### Avaliação

Aqui existem duas frentes:

- avaliação da sessão e do comportamento do agente
- teste determinístico de extensões e pacotes

Conclusão: `pi-test-harness` cobre a segunda frente muito bem e deve ser adotado como padrão quando entrarmos em extensão própria.

## Recomendação de Curadoria Inicial

### Adotar primeiro

- `oh-pi`
- `@davidorex/pi-project-workflows`
- `pi-web-access`
- `pi-lens`
- `@marcfargas/pi-test-harness`

### Testar comparativamente

- `ant-colony`
- `pi-subagents`
- `@0xkobold/pi-orchestration`
- uma solução de memória entre `memex`, `pi-memory` e `pi-brain`

### Construir depois

- skill de documentação do laboratório
- integração de pesquisa para `docs/research/`
- abstrações próprias de memória e handoff, se os testes mostrarem gaps reais

## Conclusões

- O ecossistema já cobre quase todos os workflows que usamos com Copilot.
- Os maiores gaps reais parecem estar em memória, curadoria multi-agente e integração com nossa estrutura documental.
- O primeiro movimento racional é montar uma stack mínima e medir atrito real, não desenhar extensões próprias cedo demais.

## Referências

- [pi.dev/packages](https://pi.dev/packages)
- [ifiokjr/oh-pi](https://github.com/ifiokjr/oh-pi)
- [davidorex/pi-project-workflows](https://github.com/davidorex/pi-project-workflows)
- [marcfargas/pi-test-harness](https://github.com/marcfargas/pi-test-harness)
- [apmantza/pi-lens](https://github.com/apmantza/pi-lens)
