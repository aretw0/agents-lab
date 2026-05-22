---
title: Guides
description: Practical guides for agents-lab users, operators and maintainers.
permalink: /guides/
---

# Guias — agents-lab

Guias práticos para usar, operar, manter e distribuir a stack. Para escolher por perfil de leitura, use [Start Here]({{ '/start-here.html' | relative_url }}).

## Índice

### Instalação e Configuração

| Guia | Descrição |
|------|-----------|
| [recommended-pi-stack.md]({{ '/guides/recommended-pi-stack.html' | relative_url }}) | Stack curada `@aretw0/pi-stack` — o que inclui, como instalar, filosofia |
| [terminal-setup.md]({{ '/guides/terminal-setup.html' | relative_url }}) | Configuração de terminal por plataforma — Windows Terminal, Ghostty, WezTerm, VS Code |
| [monitor-overrides.md]({{ '/guides/monitor-overrides.html' | relative_url }}) | Configuração provider-aware dos monitors (Copilot/Codex), diagnóstico e sincronização de overrides |
| [testing-isolation.md]({{ '/guides/testing-isolation.html' | relative_url }}) | Testando extensões e temas em isolamento — flags `--no-*`, `PI_CODING_AGENT_DIR` |
| [pi-platform-compatibility.md]({{ '/guides/pi-platform-compatibility.html' | relative_url }}) | Compatibilidade de plataforma (Windows/Linux/macOS) |
| [devcontainer-factory-contract.md]({{ '/guides/devcontainer-factory-contract.html' | relative_url }}) | Contrato mínimo para fábrica devcontainer-first, wrapper de operador/agente e CI first-party |

### Contribuição e Release

| Guia | Descrição |
|------|-----------|
| [publishing.md]({{ '/guides/publishing.html' | relative_url }}) | Workflow de release — changesets, versionamento lockstep, publish via tag |
| [ROADMAP.md]({{ site.repo_url }}/blob/main/ROADMAP.md) | Direção macro da 0.8.0; estado diário continua em `.project/*` |

### Operação da stack

| Guia | Descrição |
|------|-----------|
| [token-efficiency.md]({{ '/guides/token-efficiency.html' | relative_url }}) | Diretivas de eficiência de tokens (T1–T11), segurança (S1–S3) e calibração de monitores |
| [consumption-visibility-surfaces.md]({{ '/guides/consumption-visibility-surfaces.html' | relative_url }}) | Mapa das superfícies reais de consumo/quota na stack completa (usage, session-breakdown, quota-visibility) |
| [budget-governance.md]({{ '/guides/budget-governance.html' | relative_url }}) | Budget envelope por execução, governança de colônia com `maxCost`, paridade e isolamento |
| [quota-visibility.md]({{ '/guides/quota-visibility.html' | relative_url }}) | Como auditar consumo/cota local, projetar burn semanal e exportar evidência para contestação |
| [stack-sovereignty-user-guide.md]({{ '/guides/stack-sovereignty-user-guide.html' | relative_url }}) | Guia operacional da soberania da stack (owners, defaults seguros, convivência) |
| [subagent-readiness-gate.md]({{ '/guides/subagent-readiness-gate.html' | relative_url }}) | Gate para decidir delegação/subagentes com sinais reproduzíveis |
| [swarm-preflight-15m.md]({{ '/guides/swarm-preflight-15m.html' | relative_url }}) | Checklist curto antes de lançar swarm com budget e contexto sob controle |

### Operação do control plane

| Guia | Descrição |
|------|-----------|
| [web-session-gateway.md]({{ '/guides/web-session-gateway.html' | relative_url }}) | Gateway web first-party para observabilidade local da sessão (health/state/prompt) |
| [control-plane-ux-curation.md]({{ '/guides/control-plane-ux-curation.html' | relative_url }}) | Padrão de UX do control-plane (TUI+WEB): densidade adaptativa, anti-clutter e checklist de resize |
| [control-plane-evolution-playbook.md]({{ '/guides/control-plane-evolution-playbook.html' | relative_url }}) | Playbook de evolução em fases: single control-plane -> delegação descartável -> federação multi-control-plane |
| [primitive-growth-sanity-plan.md]({{ '/guides/primitive-growth-sanity-plan.html' | relative_url }}) | Plano de crescimento com sanidade: primitive-first, anti-gordura, orçamento de dívida e ladder de promoção segura |
| [control-plane-operating-doctrine.md]({{ '/guides/control-plane-operating-doctrine.html' | relative_url }}) | Doutrina operacional do control-plane unattended: quando continuar, parar, reduzir gordura e escalar canários |
| [control-plane-glossary.md]({{ '/guides/control-plane-glossary.html' | relative_url }}) | Glossário canônico do control-plane para reduzir alcunhas, aliases e progresso vazio |
| [unified-dogfood-isolation.md]({{ '/guides/unified-dogfood-isolation.html' | relative_url }}) | Runbook para dogfood em ambiente isolado com TUI + WEB unificados |
| [colony-runtime-recovery.md]({{ '/guides/colony-runtime-recovery.html' | relative_url }}) | Como localizar artefatos de colony (state/worktree/branch) e recuperar contexto após parada |
| [colony-provider-model-governance.md]({{ '/guides/colony-provider-model-governance.html' | relative_url }}) | Governança de provider/model para colony e multi-agentes (usuário + dev) |
| [swarm-cleanroom-protocol.md]({{ '/guides/swarm-cleanroom-protocol.html' | relative_url }}) | Protocolo cleanroom para runs de swarm (pre-run, execução, promoção, reconciliação) |
| [unattended-swarm-execution-plan.md]({{ '/guides/unattended-swarm-execution-plan.html' | relative_url }}) | Plano de execução unattended por lotes P0 (OpenAI-only) com go/no-go e rollback |

### Manutenção distribuível

Estes guias descrevem manutenção que pode acompanhar a stack ou inspirar outros projetos. Se um guia for necessário para uma skill ou extensão instalada via pacote, ele deve estar listado em `scripts/sync-package-docs.mjs`.

| Guia | Descrição |
|------|-----------|
| [scheduler-governance.md]({{ '/guides/scheduler-governance.html' | relative_url }}) | Governança forte de ownership/lease do scheduler para evitar conflito entre sessões |
| [extension-acceptance-checklist.md]({{ '/guides/extension-acceptance-checklist.html' | relative_url }}) | Checklist para aceitar nova extensão sem aumentar fragmentação |
| [dependency-upstream-governance.md]({{ '/guides/dependency-upstream-governance.html' | relative_url }}) | Governança para atribuir mudanças entre stack local, upstream Pi e dependências antes de decidir `assimilate|hold|reject` |
| [host-disk-recovery.md]({{ '/guides/host-disk-recovery.html' | relative_url }}) | Recuperação dry-first de disco, cache e artefatos de sandbox sem perder continuidade |
| [session-triage.md]({{ '/guides/session-triage.html' | relative_url }}) | Triagem de sessões/eventos recentes para transformar histórico em backlog revisável |
| [reload-lifecycle-diagnostic.md]({{ '/guides/reload-lifecycle-diagnostic.html' | relative_url }}) | Packet read-only para diferenciar reload lento, reload travado e evidência insuficiente |
| [i18n-intents.md]({{ '/guides/i18n-intents.html' | relative_url }}) | Runbook de intents soft/hard de internacionalização para comunicação e artefatos |
| [mermaid-authoring.md]({{ '/guides/mermaid-authoring.html' | relative_url }}) | Regras portáveis para escrever Mermaid em Markdown, GitHub, Jekyll, Astro e Obsidian |

### Manutenção do laboratório

Estes guias existem para manter este monorepo, seus fluxos de release, seu site e seu histórico. Não entram em pacotes distribuídos salvo decisão explícita de promoção para a seção distribuível.

| Guia | Descrição |
|------|-----------|
| [first-party-assimilation-notes.md]({{ '/guides/first-party-assimilation-notes.html' | relative_url }}) | Memória técnica de capacidades suprimidas por conflito para futura centralização first-party |
| [ci-governance.md]({{ '/guides/ci-governance.html' | relative_url }}) | Troubleshooting dos gates de soberania no CI (annotations, registry, criticality, owner) |
| [lab-user-surface-parity.md]({{ '/guides/lab-user-surface-parity.html' | relative_url }}) | Higiene de paridade entre superfícies do laboratório e distribuídas para usuários |
| [github-repo-presence.md]({{ '/guides/github-repo-presence.html' | relative_url }}) | Checklist de presença pública do repositório no GitHub: metadata, README e drift de docs/MDT |
| [doc-drift-mdt.md]({{ '/guides/doc-drift-mdt.html' | relative_url }}) | Contrato advisory para MDT/doc-drift: check first, escopo pequeno e integração futura com CI |
| [agents-lab-editorial-pipeline.md]({{ '/guides/agents-lab-editorial-pipeline.html' | relative_url }}) | Pipeline/template editorial para release notes e posts separando nossa stack, upstream Pi, deps e curadoria |
| [skill-guide-parity.md]({{ '/guides/skill-guide-parity.html' | relative_url }}) | Protocolo de paridade guide-skill para discoverability e controle de drift documental |
| [supply-chain-ci-hardening.md]({{ '/guides/supply-chain-ci-hardening.html' | relative_url }}) | Runbook do laboratório para pnpm, cache de dependências no CI e publish seguro |

### Evidência selecionada

Research não é guia operacional por padrão. Estas páginas ficam aqui apenas como atalhos para planejamento de release e devem ser promovidas para `guides`, `primitives` ou `architecture` quando virarem contrato estável.

| Documento | Uso |
|------|-----|
| [0.8 readiness map]({{ '/research/0-8-readiness-map.html' | relative_url }}) | Estado verificável e próximos passos da 0.8.0 |
| [0.8 local-safe compounding lane]({{ '/research/0-8-local-safe-compounding-lane.html' | relative_url }}) | Resumo da lane de estabilização 0.8 |
| [0.8 delegation long-run runway]({{ '/research/0-8-delegation-long-run-runway.html' | relative_url }}) | Runway de delegação/long-run para evolução controlada |
| [0.8 local-safe slice validation matrix]({{ '/research/0-8-local-safe-slice-validation-matrix.html' | relative_url }}) | Matriz de validação para fatias locais |
| [0.8 local-safe rollback cookbook]({{ '/research/0-8-local-safe-rollback-cookbook.html' | relative_url }}) | Cookbook de rollback local-safe |

### Embedding e Integração

| Guia | Descrição |
|------|-----------|
| [pi-embedding-cli.md]({{ '/guides/pi-embedding-cli.html' | relative_url }}) | Como integrar pi em projetos CLI externos — config embedding, extension bundle, subprocess bridge |

### Migração e Filosofia

| Guia | Descrição |
|------|-----------|
| [copilot-to-pi-migration.md]({{ '/guides/copilot-to-pi-migration.html' | relative_url }}) | Guia incremental de transição do Copilot para Pi |
| [workspace-philosophy.md]({{ '/guides/workspace-philosophy.html' | relative_url }}) | Filosofia do workspace como superfície compartilhada |

## Pré-requisitos Gerais

Para desenvolvimento deste monorepo:

- **Node.js** >= 22; Node 24 recomendado para desenvolvimento diário
- **pnpm** via Corepack
- devcontainer recomendado para paridade local

Para uso público da `@aretw0/pi-stack` fora do monorepo:

- **Pi** instalado pelo método oficial atual
- Chave de API ou login de pelo menos um provider suportado

### Instalação Rápida

```bash
# Instalar a stack curada publicada
npx @aretw0/pi-stack

# Ou instalar a partir do repositório
pi install https://github.com/aretw0/agents-lab
```

## Recursos Externos

- [Documentação oficial do pi-mono](https://github.com/badlogic/pi-mono)
- [Pacotes Pi](https://shittycodingagent.ai/packages)
- [Comunidade Pi no Discord](https://discord.com/invite/3cU7Bz4UPx)
