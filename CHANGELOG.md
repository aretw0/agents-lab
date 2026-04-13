# Changelog — agents-lab (fork)

Este arquivo registra todas as mudanças significativas deste fork de
[aretw0/agents-lab](https://github.com/aretw0/agents-lab).

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

> **Nota:** Os pacotes `@aretw0/*` em `packages/` possuem seu próprio
> `CHANGELOG.md` gerenciado por [Changesets](https://github.com/changesets/changesets).
> Este arquivo cobre mudanças no laboratório (docs, experimentos, primitivas,
> configuração de workspace e diretivas deste fork).

## [Não lançado]

### Adicionado
- Experimento `202604-token-efficiency-calibration`: calibração de eficiência de tokens e monitores portada do workspace `potlabs`
- Guia `docs/guides/token-efficiency.md`: diretivas T1–T11 de tokens, S1–S3 de segurança, calibração de monitores
- Templates de `APPEND_SYSTEM.md` para eficiência de tokens e proibição de `sudo`

### Modificado
- Classificadores de sensor (5 arquivos em `.pi/agents/`): migrados de `claude-sonnet-4.6` (thinking on) para `claude-haiku-4-5` (thinking off)
- Índice `docs/guides/README.md`: nova seção "Otimização e Operação"
- Tabela de experimentos em `experiments/README.md`

---

## [Histórico herdado do upstream]

> Os itens abaixo são retroativos, reconstruídos a partir do histórico de
> commits do repositório original incorporado neste fork.

### 2026-04-12

#### Adicionado
- Template de mensagem de commit (`.gitmessage`) com tipos Conventional Commits

### 2026-04-11

#### Corrigido
- `@aretw0/pi-stack`: registra como pi package para carregar `environment-doctor`
- `environment-doctor`: usa `WSL_INTEROP` para detecção de WSL, `npm.cmd` no win32

#### Adicionado
- `@aretw0/web-skills`: assimila `pi-web-access/librarian` como `source-research`

#### Testado
- `@aretw0/pi-stack`: detecta colisões de skill names entre pacotes + `devDependencies` para CI

### 2026-04-10

#### Adicionado
- Experimento `202604-pi-agent-core-baseline`: baseline do `pi-agent-core`
- Experimento `202604-pi-gh-cli-basics`: operações de leitura e escrita com `gh`
- Experimento `202604-pi-hedge-monitor-investigation`: investigação do monitor `hedge`
- Experimento `202604-pi-tool-calling-real-files`: tool calling em arquivos reais
- Experimento `202604-pi-meta-workspace`: modelo de workspace meta (dogfooding vs. consumo)
- Isolamento de credenciais de provider vs. utilitários externos documentado
- Padronização de overrides locais para todos os classificadores empacotados (`.pi/agents/`)

#### Corrigido
- `@aretw0/pi-stack`: múltiplos fixes de carregamento de extensões e conflitos de skills
- `@aretw0/web-skills`: remove `postinstall`, `ws` vira dependency direta (v0.3.1)

### 2026-04-09

#### Adicionado
- Scaffold inicial do repositório (`docs/`, `experiments/`, `primitives/`)
- Estrutura de monorepo com npm workspaces (`packages/*`)
- `@aretw0/pi-stack` v0.1.0 — meta-installer da stack curada
- `@aretw0/git-skills` — skills: `commit`, `git-workflow`, `github`, `glab`
- `@aretw0/web-skills` — skills: `web-browser` (CDP), `native-web-search`
- `@aretw0/pi-skills` — skills: `terminal-setup`, `create-pi-*`, `test-pi-extension`
- `@aretw0/lab-skills` — skills: `evaluate-extension`, `cultivate-primitive`, `stack-feedback`
- Extension `monitor-provider-patch` — fix automático de classifiers para `github-copilot`
- CI: validação de Conventional Commits, changeset check e smoke tests
- Workflow de publish: tag `vX.Y.Z` → npm (GitHub Actions)
- `CONTRIBUTING.md`, `ROADMAP.md`, `README.md` com missão e estrutura
- Pesquisas iniciais: mapa do ecossistema Pi, blueprint da factory, scorecard de extensões
- Guias: stack mínima, compatibilidade de plataforma, migração incremental do Copilot
- Experimento `202604-pi-first-validation`: primeira validação prática do Pi
- Branch protection com PRs + 1 review + conventional commits
- Changesets com versionamento lockstep para `@aretw0/*`

---

*Para o histórico detalhado dos pacotes, consulte `packages/<nome>/CHANGELOG.md`.*
