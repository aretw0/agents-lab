# Devcontainer blueprint notes — 2026-04-21

## Contexto
Solicitação para preparar trilha de laboratório containerizado focada em onboarding mínimo:
- Docker Desktop
- Git
- VS Code

Referência externa para aprendizado:
- https://github.com/aretw0/refarm/tree/develop/.devcontainer

## Objetivo do blueprint
Criar um caminho opcional de execução do agents-lab em container, sem depender de configuração global do host (`~/.pi`), preservando a estratégia de isolamento já adotada no workspace.

## Requisitos operacionais capturados
1. Entrada simplificada estilo `farm` para corrigir automaticamente:
   - usuário dentro do container (evitar root no fluxo diário)
   - diretório de trabalho correto do projeto
2. Compatibilidade de attach por plataforma:
   - Linux: Kitty terminal
   - Windows: Windows Terminal (PowerShell)
3. Dogfood unificado TUI + WEB no container, com os mesmos gates do fluxo local.

## Princípios de desenho (sem implementar tudo agora)
- `PI_CODING_AGENT_DIR` deve apontar para área local do workspace/container.
- Sem publish automático; foco em reproducibilidade e maturidade operacional.
- Implementação em micro-slices (config base -> entry helper -> validação TUI/WEB).

## Micro-slice implementado (TASK-BUD-074)

Estrutura criada:
- `.devcontainer/devcontainer.json`
- `.devcontainer/Dockerfile`
- `.devcontainer/postCreate.sh`

Comando de entrada simplificado (estilo `farm`):
- `scripts/devcontainer-farm.mjs`
- `npm run devcontainer:farm -- <container-name> -- npm run pi:isolated`
- `npm run devcontainer:farm:pi` (atalho padrão)

Invariantes aplicados no blueprint:
- `remoteUser: vscode` (não-root)
- `workspaceFolder: /workspaces/agents-lab`
- `PI_CODING_AGENT_DIR` local no workspace (sem depender de `~/.pi` global)

Runbook atualizado:
- `docs/guides/unified-dogfood-isolation.md` agora inclui attach Linux/Windows e checklist TUI+WEB em isolamento.

## Registro canônico relacionado
- DEC-BUD-029
- REQ-BUD-036
- TASK-BUD-074
