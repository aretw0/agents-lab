# Guias — agents-lab

Guias práticos para usar, operar, manter e distribuir a stack. Para escolher por perfil de leitura, use [../start-here.md](../start-here.md).

## Índice

### Instalação e Configuração

| Guia | Descrição |
|------|-----------|
| [recommended-pi-stack.md](./recommended-pi-stack.md) | Stack curada `@aretw0/pi-stack` — o que inclui, como instalar, filosofia |
| [terminal-setup.md](./terminal-setup.md) | Configuração de terminal por plataforma — Windows Terminal, Ghostty, WezTerm, VS Code |
| [monitor-overrides.md](./monitor-overrides.md) | Configuração provider-aware dos monitors (Copilot/Codex), diagnóstico e sincronização de overrides |
| [testing-isolation.md](./testing-isolation.md) | Testando extensões e temas em isolamento — flags `--no-*`, `PI_CODING_AGENT_DIR` |
| [pi-platform-compatibility.md](./pi-platform-compatibility.md) | Compatibilidade de plataforma (Windows/Linux/macOS) |
| [devcontainer-factory-contract.md](./devcontainer-factory-contract.md) | Contrato mínimo para fábrica devcontainer-first, wrapper de operador/agente e CI first-party |

### Contribuição e Release

| Guia | Descrição |
|------|-----------|
| [publishing.md](./publishing.md) | Workflow de release — changesets, versionamento lockstep, publish via tag |

### Operação da stack

| Guia | Descrição |
|------|-----------|
| [token-efficiency.md](./token-efficiency.md) | Diretivas de eficiência de tokens (T1–T11), segurança (S1–S3) e calibração de monitores |
| [consumption-visibility-surfaces.md](./consumption-visibility-surfaces.md) | Mapa das superfícies reais de consumo/quota na stack completa (usage, session-breakdown, quota-visibility) |
| [budget-governance.md](./budget-governance.md) | Budget envelope por execução, governança de colônia com `maxCost`, paridade e isolamento |
| [quota-visibility.md](./quota-visibility.md) | Como auditar consumo/cota local, projetar burn semanal e exportar evidência para contestação |
| [stack-sovereignty-user-guide.md](./stack-sovereignty-user-guide.md) | Guia operacional da soberania da stack (owners, defaults seguros, convivência) |
| [lab-user-surface-parity.md](./lab-user-surface-parity.md) | Higiene de paridade entre superfícies do laboratório e distribuídas para usuários |
| [github-repo-presence.md](./github-repo-presence.md) | Checklist de presença pública do repositório no GitHub: metadata, README e drift de docs/MDT |
| [doc-drift-mdt.md](./doc-drift-mdt.md) | Contrato advisory para MDT/doc-drift: check first, escopo pequeno e integração futura com CI |

### Operação do control plane

| Guia | Descrição |
|------|-----------|
| [web-session-gateway.md](./web-session-gateway.md) | Gateway web first-party para observabilidade local da sessão (health/state/prompt) |
| [control-plane-ux-curation.md](./control-plane-ux-curation.md) | Padrão de UX do control-plane (TUI+WEB): densidade adaptativa, anti-clutter e checklist de resize |
| [control-plane-evolution-playbook.md](./control-plane-evolution-playbook.md) | Playbook de evolução em fases: single control-plane -> delegação descartável -> federação multi-control-plane |
| [primitive-growth-sanity-plan.md](./primitive-growth-sanity-plan.md) | Plano de crescimento com sanidade: primitive-first, anti-gordura, orçamento de dívida e ladder de promoção segura |
| [control-plane-operating-doctrine.md](./control-plane-operating-doctrine.md) | Doutrina operacional do control-plane unattended: quando continuar, parar, reduzir gordura e escalar canários |
| [control-plane-glossary.md](./control-plane-glossary.md) | Glossário canônico do control-plane para reduzir alcunhas, aliases e progresso vazio |
| [unified-dogfood-isolation.md](./unified-dogfood-isolation.md) | Runbook para dogfood em ambiente isolado com TUI + WEB unificados |
| [colony-runtime-recovery.md](./colony-runtime-recovery.md) | Como localizar artefatos de colony (state/worktree/branch) e recuperar contexto após parada |
| [colony-provider-model-governance.md](./colony-provider-model-governance.md) | Governança de provider/model para colony e multi-agentes (usuário + dev) |
| [swarm-cleanroom-protocol.md](./swarm-cleanroom-protocol.md) | Protocolo cleanroom para runs de swarm (pre-run, execução, promoção, reconciliação) |
| [unattended-swarm-execution-plan.md](./unattended-swarm-execution-plan.md) | Plano de execução unattended por lotes P0 (OpenAI-only) com go/no-go e rollback |

### Manutenção do laboratório

| Guia | Descrição |
|------|-----------|
| [host-disk-recovery.md](./host-disk-recovery.md) | Runbook de recuperação de espaço em disco (dry-run, limpeza segura, modo agressivo com proteção de sessões) |
| [session-triage.md](./session-triage.md) | Triage do histórico recente de sessões/branches para consolidar pendências no board canônico |
| [scheduler-governance.md](./scheduler-governance.md) | Governança forte de ownership/lease do scheduler para evitar conflito entre sessões |
| [extension-acceptance-checklist.md](./extension-acceptance-checklist.md) | Checklist para aceitar nova extensão sem aumentar fragmentação |
| [first-party-assimilation-notes.md](./first-party-assimilation-notes.md) | Memória técnica de capacidades suprimidas por conflito para futura centralização first-party |
| [ci-governance.md](./ci-governance.md) | Troubleshooting dos gates de soberania no CI (annotations, registry, criticality, owner) |
| [dependency-upstream-governance.md](./dependency-upstream-governance.md) | Governança para atribuir mudanças entre stack local, upstream Pi e dependências antes de decidir `assimilate|hold|reject` |
| [agents-lab-editorial-pipeline.md](./agents-lab-editorial-pipeline.md) | Pipeline/template editorial para release notes e posts separando nossa stack, upstream Pi, deps e curadoria |
| [i18n-intents.md](./i18n-intents.md) | Runbook de intents soft/hard de internacionalização para comunicação e artefatos |
| [skill-guide-parity.md](./skill-guide-parity.md) | Protocolo de paridade guide-skill para discoverability e controle de drift documental |

### Evidência selecionada

Research não é guia operacional por padrão. Estas páginas ficam aqui apenas como atalhos para planejamento de release e devem ser promovidas para `guides`, `primitives` ou `architecture` quando virarem contrato estável.

| Documento | Uso |
|------|-----|
| [0.8 readiness map](../research/0-8-readiness-map.md) | Estado verificável e próximos passos da 0.8.0 |
| [0.8 local-safe compounding lane](../research/0-8-local-safe-compounding-lane.md) | Resumo da lane de estabilização 0.8 |
| [0.8 delegation long-run runway](../research/0-8-delegation-long-run-runway.md) | Runway de delegação/long-run para evolução controlada |
| [0.8 local-safe slice validation matrix](../research/0-8-local-safe-slice-validation-matrix.md) | Matriz de validação para fatias locais |
| [0.8 local-safe rollback cookbook](../research/0-8-local-safe-rollback-cookbook.md) | Cookbook de rollback local-safe |

### Embedding e Integração

| Guia | Descrição |
|------|-----------|
| [pi-embedding-cli.md](./pi-embedding-cli.md) | Como integrar pi em projetos CLI externos — config embedding, extension bundle, subprocess bridge |

### Migração e Filosofia

| Guia | Descrição |
|------|-----------|
| [copilot-to-pi-migration.md](./copilot-to-pi-migration.md) | Guia incremental de transição do Copilot para Pi |
| [workspace-philosophy.md](./workspace-philosophy.md) | Filosofia do workspace como superfície compartilhada |

## Pré-requisitos Gerais

Para desenvolvimento deste monorepo:

- **Node.js** >= 22
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
