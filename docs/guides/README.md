# Guias — agents-lab

Guias práticos para trabalhar com o ecossistema de agentes deste laboratório.

## Índice

### Instalação e Configuração

| Guia | Descrição |
|------|-----------|
| [recommended-pi-stack.md](./recommended-pi-stack.md) | Stack curada `@aretw0/pi-stack` — o que inclui, como instalar, filosofia |
| [terminal-setup.md](./terminal-setup.md) | Configuração de terminal por plataforma — Windows Terminal, Ghostty, WezTerm, VS Code |
| [monitor-overrides.md](./monitor-overrides.md) | Configuração provider-aware dos monitors (Copilot/Codex), diagnóstico e sincronização de overrides |
| [testing-isolation.md](./testing-isolation.md) | Testando extensões e temas em isolamento — flags `--no-*`, `PI_CODING_AGENT_DIR` |
| [pi-platform-compatibility.md](./pi-platform-compatibility.md) | Compatibilidade de plataforma (Windows/Linux/macOS) |

### Contribuição e Release

| Guia | Descrição |
|------|-----------|
| [publishing.md](./publishing.md) | Workflow de release — changesets, versionamento lockstep, publish via tag |

### Otimização e Operação

| Guia | Descrição |
|------|-----------|
| [token-efficiency.md](./token-efficiency.md) | Diretivas de eficiência de tokens (T1–T11), segurança (S1–S3) e calibração de monitores |
| [consumption-visibility-surfaces.md](./consumption-visibility-surfaces.md) | Mapa das superfícies reais de consumo/quota na stack completa (usage, session-breakdown, quota-visibility) |
| [budget-governance.md](./budget-governance.md) | Budget envelope por execução, governança de colônia com `maxCost`, paridade e isolamento |
| [quota-visibility.md](./quota-visibility.md) | Como auditar consumo/cota local, projetar burn semanal e exportar evidência para contestação |
| [web-session-gateway.md](./web-session-gateway.md) | Gateway web first-party para observabilidade local da sessão (health/state/prompt) |
| [control-plane-ux-curation.md](./control-plane-ux-curation.md) | Padrão de UX do control-plane (TUI+WEB): densidade adaptativa, anti-clutter e checklist de resize |
| [control-plane-evolution-playbook.md](./control-plane-evolution-playbook.md) | Playbook de evolução em fases: single control-plane -> delegação descartável -> federação multi-control-plane |
| [unified-dogfood-isolation.md](./unified-dogfood-isolation.md) | Runbook para dogfood em ambiente isolado com TUI + WEB unificados |
| [colony-runtime-recovery.md](./colony-runtime-recovery.md) | Como localizar artefatos de colony (state/worktree/branch) e recuperar contexto após parada |
| [host-disk-recovery.md](./host-disk-recovery.md) | Runbook de recuperação de espaço em disco (dry-run, limpeza segura, modo agressivo com proteção de sessões) |
| [colony-provider-model-governance.md](./colony-provider-model-governance.md) | Governança de provider/model para colony e multi-agentes (usuário + dev) |
| [swarm-cleanroom-protocol.md](./swarm-cleanroom-protocol.md) | Protocolo cleanroom para runs de swarm (pre-run, execução, promoção, reconciliação) |
| [unattended-swarm-execution-plan.md](./unattended-swarm-execution-plan.md) | Plano de execução unattended por lotes P0 (OpenAI-only) com go/no-go e rollback |
| [session-triage.md](./session-triage.md) | Triage do histórico recente de sessões/branches para consolidar pendências no board canônico |
| [scheduler-governance.md](./scheduler-governance.md) | Governança forte de ownership/lease do scheduler para evitar conflito entre sessões |
| [stack-sovereignty-user-guide.md](./stack-sovereignty-user-guide.md) | Guia operacional da soberania da stack (owners, defaults seguros, convivência) |
| [extension-acceptance-checklist.md](./extension-acceptance-checklist.md) | Checklist para aceitar nova extensão sem aumentar fragmentação |
| [first-party-assimilation-notes.md](./first-party-assimilation-notes.md) | Memória técnica de capacidades suprimidas por conflito para futura centralização first-party |
| [ci-governance.md](./ci-governance.md) | Troubleshooting dos gates de soberania no CI (annotations, registry, criticality, owner) |

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

- **Node.js** >= 22
- **npm** >= 9
- **Pi** instalado: `npm install -g @mariozechner/pi-coding-agent`
- Chave de API de pelo menos um provider (GitHub Copilot, Anthropic, OpenAI, Google, etc.)

### Instalação Rápida

```bash
# Instalar pi
npm install -g @mariozechner/pi-coding-agent

# Instalar a stack curada (via npm)
pi install npm:@aretw0/pi-stack

# Ou via git (sempre atualizado)
pi install https://github.com/aretw0/agents-lab
```

## Recursos Externos

- [Documentação oficial do pi-mono](https://github.com/badlogic/pi-mono)
- [Pacotes Pi](https://shittycodingagent.ai/packages)
- [Comunidade Pi no Discord](https://discord.com/invite/3cU7Bz4UPx)
