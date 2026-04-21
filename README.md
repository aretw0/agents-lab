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
| `@aretw0/pi-stack` | Installer da stack curada — instala todos os pacotes via `npx @aretw0/pi-stack` |
| `@aretw0/git-skills` | Skills de git: `commit`, `git-workflow`, `github` (`gh`), `glab` |
| `@aretw0/web-skills` | Skills de web: `web-browser` (CDP) |
| `@aretw0/pi-skills` | Skills de fábrica: `terminal-setup`, `create-pi-skill/extension/theme/prompt`, `test-pi-extension` |
| `@aretw0/lab-skills` | Skills experimentais: `evaluate-extension`, `cultivate-primitive`, `stack-feedback` |

### Pacotes Pi Relevantes (Terceiros)

| Pacote | Descrição |
|--------|-----------|
| `@mariozechner/pi-ai` | API unificada multi-provider para LLMs |
| `@mariozechner/pi-agent-core` | Runtime de agentes com tool calling e state management |
| `@mariozechner/pi-coding-agent` | CLI de coding agent interativo |
| `@mariozechner/pi-tui` | Terminal UI com renderização diferencial |
| `@marcfargas/pi-test-harness` | Test harness para extensões pi |

> **Nota:** Apesar do Pi ser a engine principal, a estrutura do laboratório é deliberadamente engine-agnóstica. Caso surjam implementações superiores, podemos migrar sem perder o trabalho acumulado.

## Estrutura do Repositório

```text
agents-lab/
├── packages/
│   ├── pi-stack/       # @aretw0/pi-stack — installer + extensions first-party
│   ├── git-skills/     # @aretw0/git-skills — commit, git-workflow, github, glab
│   ├── web-skills/     # @aretw0/web-skills — web-browser (CDP)
│   ├── pi-skills/      # @aretw0/pi-skills — terminal-setup, create-pi-*, test-pi-extension
│   └── lab-skills/     # @aretw0/lab-skills — evaluate, cultivate, feedback
├── scripts/
│   └── pi-source-switch.mjs  # Alterna entre dev local e pacotes npm
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

## Começando

### Instalando a Stack

A stack curada instala cada pacote individualmente no pi (mesmo padrão do oh-pi):

```bash
# Stack completa — instala 17 pacotes via pi install
npx @aretw0/pi-stack

# Com versão fixa para @aretw0/*
npx @aretw0/pi-stack --version 0.3.0

# Instalação local (projeto)
npx @aretw0/pi-stack --local

# Remover tudo
npx @aretw0/pi-stack --remove
```

Ou instale pacotes individuais:

```bash
pi install npm:@aretw0/git-skills
pi install npm:@aretw0/pi-skills
pi install npm:@ifi/oh-pi-themes
```

**Via git** (sempre atualizado, sem esperar publish):

```bash
pi install https://github.com/aretw0/agents-lab
```

### Desenvolvimento Local

Para desenvolver pacotes do monorepo usando o pi:

```bash
git clone https://github.com/aretw0/agents-lab.git
cd agents-lab
npm install

# Apontar pi para os pacotes locais do workspace
npm run pi:local

# Verificar configuração atual
npm run pi:status

# Checar paridade user-like vs laboratório (consumo/quota/superfícies)
npm run pi:parity
npm run pi:parity:project

# Voltar para pacotes publicados no npm
npm run pi:published

# Isolamento forte (recomendado para curadoria):
# roda o pi com PI_CODING_AGENT_DIR local do workspace (.sandbox/pi-agent)
npm run pi:isolated
# para retomar sessão isolada existente
npm run pi:isolated:resume
npm run pi:isolated:status
npm run pi:isolated:help
# copiar a sessão global mais recente para o sandbox local (quando necessário)
npm run pi:isolated:adopt-latest
# preview sem alterar arquivos (sem depender de flags do npm)
npm run pi:isolated:adopt-latest:dry
# reset do sandbox local quando quiser começar "do zero"
npm run pi:isolated:reset

# Overlay opcional para pilot de colony (/monitors, /remote, /colony)
# (escopo user por padrão, sem sujar .pi/settings.json do repositório)
npm run pi:pilot:on
npm run pi:pilot:status
npm run pi:pilot:off

# Se quiser alterar o settings do projeto explicitamente
npm run pi:pilot:on:project
npm run pi:pilot:off:project
```

O `.pi/settings.json` do projeto já aponta para os pacotes locais automaticamente.
Para cenários de pilot, use o overlay opcional acima (explícito e reversível).

### Testando Extensões

Este monorepo usa `@marcfargas/pi-test-harness` para testes automatizados:

```bash
# Rodar todos os testes
npm run test:smoke

# Testes unitários de extensões
npm test
```

A skill `test-pi-extension` (em `@aretw0/pi-skills`) documenta como criar testes para suas próprias extensões.

### Benchmark canônico — economia de contexto

```bash
npm run benchmark:context
```

O benchmark roda A/B reproduzível (`pi puro` vs `pi-stack default`) com prompt curto e gera artefato auditável em:

- `docs/research/data/context-economy/<run-id>/results.json`

Limites de segurança (bounded-by-default):

- sem logs brutos no output
- captura com teto de buffer por execução
- apenas métricas resumidas (tokens, latência, custo, tool calls)

### Recursos Recomendados

- [pi-mono — repositório oficial](https://github.com/badlogic/pi-mono)
- [Guias deste laboratório](./docs/guides/)
  - [Web Session Gateway](./docs/guides/web-session-gateway.md)
  - [Colony Runtime Recovery](./docs/guides/colony-runtime-recovery.md)
- [Pesquisas e análises](./docs/research/)

### Contribuindo

Veja [CONTRIBUTING.md](./CONTRIBUTING.md) para como participar deste laboratório.

## Roadmap

Veja [ROADMAP.md](./ROADMAP.md) para os próximos passos planejados.

## Licença

MIT — veja [LICENSE](./LICENSE).
