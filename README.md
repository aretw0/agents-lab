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

### Pacotes First-Party (`@aretw0/*`)

Este repositório é a fábrica onde a curadoria nasce. Os pacotes first-party são construídos aqui e distribuídos via npm:

| Pacote | Descrição |
|--------|----------|
| `@aretw0/pi-stack` | Meta-pacote da stack curada — instala tudo com `npx @aretw0/pi-stack` |
| `@aretw0/git-skills` | Skills de git: `commit`, `git-workflow`, `github` (`gh`), `glab` |
| `@aretw0/web-skills` | Skills de web: `native-web-search`, `web-browser` (CDP) |
| `@aretw0/pi-skills` | Skills de fábrica: `terminal-setup`, `create-pi-skill/extension/theme/prompt` |
| `@aretw0/lab-skills` | Skills experimentais: `evaluate-extension`, `cultivate-primitive`, `stack-feedback` |

Ver [`docs/guides/publishing.md`](./docs/guides/publishing.md) para o workflow de release.

### Pacotes Pi Relevantes (Terceiros)

| Pacote | Descrição |
|--------|-----------|
| `@mariozechner/pi-ai` | API unificada multi-provider para LLMs |
| `@mariozechner/pi-agent-core` | Runtime de agentes com tool calling e state management |
| `@mariozechner/pi-coding-agent` | CLI de coding agent interativo |
| `@mariozechner/pi-web-ui` | Web components para interfaces de chat com IA |
| `@mariozechner/pi-tui` | Terminal UI com renderização diferencial |

> **Nota:** Apesar do Pi ser a engine principal, a estrutura do laboratório é deliberadamente engine-agnóstica. Caso surjam implementações superiores, podemos migrar sem perder o trabalho acumulado.

## Estrutura do Repositório

```text
agents-lab/
├── packages/
│   ├── pi-stack/       # @aretw0/pi-stack — meta-pacote + monitor-provider-patch
│   ├── git-skills/     # @aretw0/git-skills — commit, git-workflow, github, glab
│   ├── web-skills/     # @aretw0/web-skills — native-web-search, web-browser (CDP)
│   ├── pi-skills/      # @aretw0/pi-skills — terminal-setup, create-pi-*
│   └── lab-skills/     # @aretw0/lab-skills — evaluate, cultivate, feedback
├── docs/
│   ├── research/       # Pesquisas, análises e material de referência
│   ├── guides/         # Guias práticos de uso, configuração e publicação
│   ├── primitives/     # Conceitos e catálogo de primitivas de agentes
│   └── engines/        # Comparações e análises de engines (Pi e alternativas)
├── experiments/        # Experimentos práticos e provas de conceito
├── primitives/         # Código reutilizável de primitivas de agentes
├── .changeset/         # Changesets pendentes para o próximo release
├── .github/workflows/  # CI (conventional commits) e publish (tag → npm)
├── CONTRIBUTING.md     # Como contribuir e como fazer releases
└── ROADMAP.md          # Planejamento e milestones futuros
```

A estrutura acima organiza o laboratório para facilitar tanto a exploração prática quanto a consulta de material de apoio.

- Em [`experiments/`](./experiments/), você encontra os resultados práticos do roadmap, incluindo experimentos e provas de conceito.
- Em [`docs/research/`](./docs/research/), estão reunidas análises, pesquisas e referências usadas para orientar as decisões do laboratório.
- Em [`docs/guides/`](./docs/guides/), ficam os guias práticos de uso, configuração e navegação pelo workspace.

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

### Workspace como Superfície de Trabalho

O laboratório trata o workspace como parte da interface de trabalho entre humanos, agentes e ferramentas.

Isso significa que arquivos, diretórios e artefatos projetados por uma engine ou extensão não devem ser vistos apenas como detalhe técnico. Eles podem revelar:

- intenção arquitetural
- forma de colaboração
- memória operacional
- novas convenções de trabalho

Nosso objetivo não é controlar cedo demais o workspace de ninguém, e sim entender como ele passa a estruturar o trabalho conjunto.

Ver também: [docs/guides/workspace-philosophy.md](./docs/guides/workspace-philosophy.md)

## Começando

### Instalando a Stack

A stack curada pode ser instalada de duas formas:

**Via npm** (recomendado quando publicado):

```bash
# Stack completa
pi install npm:@aretw0/pi-stack

# Ou pacotes individuais
pi install npm:@aretw0/git-skills
pi install npm:@aretw0/pi-skills
```

**Via git** (sempre atualizado, sem esperar publish):

```bash
# Stack completa direto do repositório
pi install https://github.com/aretw0/agents-lab

# Ou para projeto local
pi install -l https://github.com/aretw0/agents-lab
```

> **Nota:** A instalação via git traz o repositório inteiro. O pi descobre automaticamente os pacotes dentro de `packages/` via o manifesto `pi` de cada `package.json`.

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
