# Roadmap — agents-lab

Planejamento e milestones do laboratório. Este é um documento vivo — evolui conforme o laboratório cresce.

## Fase 0 — Fundação (concluída)

**Objetivo:** Criar o solo que vai receber o brainstorm e as pesquisas futuras.

- [x] Estrutura inicial do repositório
- [x] README com missão, visão e filosofia
- [x] Estrutura de diretórios (`docs/`, `experiments/`, `primitives/`)
- [x] Documentação de convenções e contribuição
- [x] Definir estrutura de longo prazo do repositório
  - **Decisão:** monorepo com npm workspaces (`packages/*`)
  - [x] Criar `package.json` raiz com workspaces
  - [x] Criar meta-pacote `@aretw0/pi-stack` com `npx @aretw0/pi-stack`
  - [x] Configurar `.pi/settings.json` para dogfood local
  - [x] Bootstrap de changesets, CI e workflow de publish (tag → npm)

## Fase 1 — Pesquisa e Documentação

**Objetivo:** Organizar o material existente e construir base de conhecimento.

- [ ] Análise aprofundada do ecossistema Pi
  - [x] Mapa inicial do ecossistema e suas camadas
  - [ ] Mapeamento de todos os pacotes e suas responsabilidades
  - [x] Identificação inicial dos padrões de design usados
  - [ ] Análise de casos de uso (openclaw e outros)
  - [x] Scorecard inicial de referências e pacotes prioritários
  - [x] Avaliação de pi-lens como referência de qualidade de código
  - [x] Taxonomia inicial por workflow
- [ ] Catalogar material de referência externo
  - [ ] [tuts-agentic-ai-examples](https://github.com/nilayparikh/tuts-agentic-ai-examples) — padrões de AI Agents
  - [ ] Protocolo A2A (Agent-to-Agent)
- [ ] Pesquisa sobre estrutura de baixa fricção cognitiva
  - [ ] Avaliação de monorepo vs. repositórios independentes
  - [ ] Análise de projetos similares na comunidade
  - [x] Blueprint inicial da futura fábrica de extensões Pi
  - [x] Análise inicial das fricções da factory
  - [ ] Resolver modelo de workspace meta (dogfooding vs. consumo) — [experimento](experiments/202604-pi-meta-workspace/README.md)
- [ ] Análise de engines alternativas ao Pi (LangChain, AutoGen, CrewAI, etc.)
- [ ] Preparação para migração controlada de Copilot para Pi
  - [x] Definição da stack inicial recomendada
  - [x] Guia inicial de migração incremental
  - [x] Análise de compatibilidade de plataforma (Windows/Linux/macOS)
  - [x] Decisão sobre devcontainer (adiado para Fase 2-3)
  - [x] Instalar Pi e validar a stack no uso real
  - [x] Registrar a primeira validação prática e os artefatos gerados no workspace

## Fase 2 — Primeiros Experimentos

**Objetivo:** Rodar experimentos concretos e começar a identificar primitivas.

- [ ] Investigar monitores comportamentais do Pi stack (`hedge` e similares)
  - [x] Reproduzir a falha do `hedge` em ambiente autenticado com `github-copilot`
  - [x] Confirmar override local via `.pi/agents/hedge-classifier.agent.yaml`
  - [x] Verificar que o padrão de modelo sem provider se repete nos classificadores embutidos
  - [x] Validar em execução que `work-quality` também exige alinhamento explícito de provider
  - [x] Validar em execução um sensor orientado a tool use (`fragility`)
  - [x] Padronizar overrides locais para todos os classificadores empacotados
  - [x] Separar configuração versionável (`.pi/agents/`) de saída operacional de runtime (`.project/`)
  - [x] Abrir issue upstream com a reprodução consolidada e a hipótese causal
- [x] Primeiro experimento com `pi-agent-core`
- [ ] Experimento com tool calling em Pi
  - [x] Validar baseline de `read`, `write` e `bash` no núcleo puro do Pi
  - [x] Validar uma microedição real em arquivo existente do projeto (`README.md`) no núcleo puro
  - [ ] Rodar fluxo multi-etapa com tool calling em arquivos reais do projeto
  - [ ] Comparar o mesmo tipo de tarefa com a stack completa ativada
- [ ] Experimento de paridade GitHub via `gh`
  - [x] Confirmar ausência inicial do `gh` no ambiente
  - [x] Instalar `gh` em escopo de usuário sem depender de admin
  - [x] Confirmar que a próxima fricção é autenticação do `gh`, não inferência do Pi
  - [x] Autenticar `gh` e validar leitura de `issues` e `prs`
  - [x] Definir política de isolamento entre credenciais de provider e credenciais operacionais de utilitários externos
  - [x] Validar uma primeira operação de escrita controlada via `gh`
  - [ ] Medir ergonomia de Pi + `gh` contra o fluxo atual com GitHub Copilot
  - [ ] Avançar de issue ops para PR ops com o mesmo modelo controlado e reversível
- [ ] Experimento com múltiplos providers de LLM
- [ ] Experimento com A2A protocol
- [ ] Identificar padrões recorrentes candidatos a primitivas

## Fase 3 — Primeiras Primitivas (atual)

**Objetivo:** Formalizar as primeiras primitivas reutilizáveis como pacotes first-party.

- [x] Definir estrutura padrão de pacote (`packages/*`, npm workspaces)
- [x] Definir estratégia de versionamento (lockstep com changesets)
- [x] Criar `@aretw0/git-skills` — commit, git-workflow, github, glab
- [x] Criar `@aretw0/web-skills` — native-web-search, web-browser CDP
- [x] Criar `@aretw0/pi-skills` — terminal-setup, create-pi-skill/extension/theme/prompt
- [x] Criar `@aretw0/lab-skills` — evaluate-extension, cultivate-primitive, stack-feedback
- [x] Criar `@aretw0/pi-stack` com `install.mjs` (npx + fallback Windows)
- [x] Extension `monitor-provider-patch` — fix automático de classifiers para github-copilot (14 testes)
- [x] Publicar scope `@aretw0` no npm e configurar `NPM_TOKEN` no repositório
- [x] Primeiro release (`v0.1.0`) publicado no npm
- [x] Branch protection ativada — PRs + 1 review + conventional commits
- [ ] Release `v0.2.0` com todos os 5 pacotes
- [ ] Avaliar e migrar primitivas de monitors (`@davidorex/pi-behavior-monitors`)
- [ ] Avaliar e migrar primitivas de extensions (`@ifi/oh-pi-extensions`)
- [ ] Avaliar Adaptive Routing do `@ifi/oh-pi` como primitiva futura de roteamento
- [ ] Consolidar guardrails first-party em uma extensão única (`guardrails-core`)
- [ ] Definir gate objetivo de colony-readiness (guardrails + regressão + observabilidade)

## Fase 4 — Comunidade e Escala

**Objetivo:** Abrir o laboratório para contribuições externas e escalar o ecossistema.

- [x] Branch protection e gateways de qualidade
- [x] Primeiro contribuidor adicionado
- [ ] Guia de onboarding para novos colaboradores (skills `pi-skills` e `lab-skills` cobrem parcialmente)
- [ ] Processo de avaliação e promoção de primitivas (skill `evaluate-extension` + `cultivate-primitive`)
- [ ] Validar instalação via `pi install https://github.com/aretw0/agents-lab`
- [ ] Avaliar `@aretw0/terminal-configs` como pacote de configuração puro (issue #3)

---

## Decisões Pendentes

| Decisão | Contexto | Prazo |
|---------|----------|-------|
| ~~Monorepo ou não?~~ | **Decidido:** monorepo com npm workspaces | ✅ Fase 0 |
| Linguagem principal | TypeScript (Pi) vs. Python vs. poliglota | Fase 2 |
| Modelo de workspace meta | Monorepo unificado vs. separado vs. perfis — como dogfoodar sem poluir | Fase 2-3 |
| ~~Estratégia de publicação~~ | **Decidido:** npm com changesets + lockstep + publish on tag | ✅ Fase 3 |

## Notas

- O roadmap é orientativo, não prescritivo. A natureza experimental do laboratório exige flexibilidade.
- Novas descobertas nas fases iniciais podem reordenar ou reescrever fases futuras.
- Cada milestone deve ser discutido antes de ser iniciado.
- Comportamentos opinativos de engines e extensões devem ser entendidos antes de serem limpos, ignorados ou removidos.
- Integrações futuras com utilitários autenticados devem começar com isolamento de credenciais; qualquer compartilhamento entre autenticação do provider e autenticação operacional deve ser explícito, configurável e reversível.
