# agents-lab

Laboratório local-first para curar, testar e distribuir primitivas reutilizáveis para agentes de IA, com foco atual no ecossistema Pi.

Site: <https://aretw0.github.io/agents-lab/>

## O Que Este Repositório Entrega

- `@aretw0/pi-stack`: stack curada para Pi, instalada por `npx @aretw0/pi-stack`.
- Skills first-party para git, web, desenvolvimento Pi e operação do laboratório.
- Extensões first-party com guardrails, diagnóstico, quota visibility, context watchdog, board/project surfaces e auditoria de stack.
- Docs e testes que separam superfície publicada, material de pesquisa e utilitários internos do laboratório.

O objetivo é manter uma stack pequena o bastante para uso diário e extensível o bastante para pesquisa, delegação e long-runs quando houver gates claros.

## Instalação

Para usuários Pi:

```bash
npx @aretw0/pi-stack
```

O perfil padrão é `strict-curated`: instala os pacotes first-party e o mínimo terceiro necessário para monitores/projeto.

Perfis explícitos:

```bash
npx @aretw0/pi-stack --runtime-extras
npx @aretw0/pi-stack --stack-full
npx @aretw0/pi-stack --local
npx @aretw0/pi-stack --local --baseline
npx @aretw0/pi-stack --remove
```

Instalação via git, para testar o estado atual do repositório:

```bash
pi install https://github.com/aretw0/agents-lab
```

Detalhes da stack: [packages/pi-stack/README.md](./packages/pi-stack/README.md).

## Pacotes First-Party

| Pacote | Papel |
|---|---|
| `@aretw0/pi-stack` | Installer, extensões, tema e governança da stack |
| `@aretw0/git-skills` | Skills `commit`, `git-workflow`, `github`, `glab` |
| `@aretw0/web-skills` | Skills de pesquisa/ferramentas web, incluindo CDP local |
| `@aretw0/pi-skills` | Skills para criar/testar skills, extensoes, temas e prompts Pi |
| `@aretw0/lab-skills` | Skills de curadoria: intake, primitive cultivation, stack feedback e provider discovery |

## Terceiros Curados

A stack não tenta vender dependência externa como first-party. Ela instala, filtra ou usa pacotes terceiros com ownership explícito:

| Pacote | Uso na curadoria |
|---|---|
| `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` | Runtime Pi usado para desenvolver e executar a stack |
| `@marcfargas/pi-test-harness` | Harness de testes para extensões Pi |
| `@davidorex/pi-project-workflows` | Monitores, project blocks e workflows usados no perfil padrao |
| `@ifi/oh-pi-extensions` | Extras de runtime; parte entra como opt-in e parte é filtrada quando conflita com first-party |
| `@ifi/oh-pi-skills`, `@ifi/oh-pi-themes`, `@ifi/oh-pi-prompts` | Skills, temas e prompts curados para perfis ampliados |
| `@ifi/oh-pi-ant-colony`, `@ifi/pi-web-remote`, `@ifi/pi-extension-subagents` | Capacidades de colônia, remoto e subagentes, mantidas como opt-in |
| `@ifi/pi-plan`, `@ifi/pi-spec` | Fluxos de planejamento/spec para perfis ampliados |
| `mitsupi`, `pi-lens`, `pi-web-access` | Capacidades complementares avaliadas, com filtros quando há colisão de skill/tool |

O contrato de instalação vive em [packages/pi-stack/package-list.mjs](./packages/pi-stack/package-list.mjs). Colisões conhecidas devem ser resolvidas por filtros do installer e cobertas por testes.

## Desenvolvimento

```bash
git clone https://github.com/aretw0/agents-lab.git
cd agents-lab
pnpm install
```

Comandos principais:

```bash
pnpm run pi:dev
pnpm run ci:local:parity
pnpm run test:smoke
pnpm run test:docs:site
pnpm run repo:discourse:audit
pnpm run docs:site:serve
```

No devcontainer, o atalho do operador é:

```bash
lab pi
```

## Documentação

- [Start Here](./docs/start-here.md)
- [Site map](./docs/site-map.md)
- [Guias](./docs/guides/)
- [Primitivas](./docs/primitives/)
- [Arquitetura](./docs/architecture/)
- [Engines](./docs/engines/)
- [Research](./docs/research/)

O site público é gerado a partir de `docs/` via GitHub Pages. Localmente:

```bash
pnpm run docs:site:install
pnpm run docs:site:serve
```

## Gates De Qualidade

O CI roda a paridade local por `pnpm run ci:local:parity`, incluindo:

- pins de GitHub Actions;
- testes de workflow, docs, package boundary e smoke;
- checks de installabilidade e superfície de usuário;
- auditoria de soberania, complexidade, bloat e discurso.

Antes de publicar material novo, prefira:

```bash
pnpm run test:docs:site
pnpm run repo:discourse:audit
pnpm run docs:package:check
```

## Release

Releases npm usam changesets e tags semver. O workflow `Publish` publica pacotes; GitHub Pages e publicado separadamente a partir de `main /docs`.

## Licença

MIT - veja [LICENSE](./LICENSE).
