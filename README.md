# agents-lab 🧪

> Um laboratório para experimentar, discutir e construir primitivas reutilizáveis de agentes de IA.

## Missão

**agents-lab** é um espaço de pesquisa e desenvolvimento dedicado ao ecossistema de agentes de IA. O objetivo central é canalizar todo o potencial ao redor em um único local onde possamos:

- 🔬 **Experimentar** — rodar experimentos controlados com diferentes engines de agentes
- 📚 **Documentar** — organizar pesquisas, análises e aprendizados de forma acessível
- 🧩 **Construir primitivas** — criar blocos reutilizáveis que possam ser compartilhados com a comunidade
- 📊 **Avaliar** — comparar abordagens, frameworks e filosofias de design
- 🚀 **Evoluir** — superar qualquer engine específica caso o ecossistema avance

## Engine Principal: Pi

A engine primária deste laboratório é o **[pi](https://github.com/badlogic/pi-mono)** — um toolkit altamente extensível para construção de agentes de IA e gerenciamento de LLMs. Pi se prova excelente para "mess around and find out" e serve como engine de sistemas maiores.

### Por que Pi?

- **Extensibilidade** — projetado para ser a fundação de outros sistemas (ex.: openclaw)
- **Filosofia sólida** — convergência natural para o que uma engine de agentes precisa ser
- **Ecossistema crescente** — [pacotes disponíveis](https://pi.dev/packages) em constante expansão
- **Multi-provider** — suporta OpenAI, Anthropic, Google e outros via `@mariozechner/pi-ai`

### Pacotes Pi Relevantes

| Pacote | Descrição |
|--------|-----------|
| `@mariozechner/pi-ai` | API unificada multi-provider para LLMs |
| `@mariozechner/pi-agent-core` | Runtime de agentes com tool calling e state management |
| `@mariozechner/pi-coding-agent` | CLI de coding agent interativo |
| `@mariozechner/pi-web-ui` | Web components para interfaces de chat com IA |
| `@mariozechner/pi-tui` | Terminal UI com renderização diferencial |

> **Nota:** Apesar do Pi ser a engine principal, a estrutura do laboratório é deliberadamente engine-agnóstica. Caso surjam implementações superiores, podemos migrar sem perder o trabalho acumulado.

## Estrutura do Repositório

```
agents-lab/
├── docs/
│   ├── research/       # Pesquisas, análises e material de referência
│   ├── guides/         # Guias práticos de uso e configuração
│   ├── primitives/     # Conceitos e catálogo de primitivas de agentes
│   └── engines/        # Comparações e análises de engines (Pi e alternativas)
├── experiments/        # Experimentos práticos e provas de conceito
├── primitives/         # Código reutilizável de primitivas de agentes
├── CONTRIBUTING.md     # Como contribuir
└── ROADMAP.md          # Planejamento e milestones futuros
```

## Filosofia de Design

### Primitivas Reutilizáveis

O laboratório busca identificar e extrair as **primitivas fundamentais** do design de agentes:

- **Memória** — como agentes armazenam e recuperam contexto
- **Ferramentas** — como agentes interagem com o mundo externo
- **Planejamento** — como agentes decompõem tarefas complexas
- **Coordenação** — como múltiplos agentes colaboram (A2A, MAS)
- **Avaliação** — como medir a qualidade e confiabilidade de agentes

### Baixa Fricção Cognitiva

Um princípio central é minimizar a fricção cognitiva para quem experimenta e para quem usa as primitivas. Isso significa:

- Documentação clara e acessível
- Exemplos autocontidos
- Abstrações que mapeiam naturalmente para os conceitos do domínio

## Começando

### Recursos Recomendados

- [pi-mono — repositório oficial](https://github.com/badlogic/pi-mono)
- [tuts-agentic-ai-examples — exemplos de padrões de agentes](https://github.com/nilayparikh/tuts-agentic-ai-examples)
- [Guias deste laboratório](./docs/guides/)
- [Pesquisas e análises](./docs/research/)

### Contribuindo

Veja [CONTRIBUTING.md](./CONTRIBUTING.md) para como participar deste laboratório.

## Roadmap

Veja [ROADMAP.md](./ROADMAP.md) para os próximos passos planejados.

## Licença

MIT — veja [LICENSE](./LICENSE).
