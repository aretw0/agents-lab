# TASK-BUD-074 — Closure (2026-04-21)

## Resultado
Blueprint de devcontainer opcional implementado para onboarding Docker Desktop + VS Code com isolamento local de runtime (`PI_CODING_AGENT_DIR` no workspace).

## Entregas
- `.devcontainer/devcontainer.json`
- `.devcontainer/Dockerfile`
- `.devcontainer/postCreate.sh`
- `scripts/devcontainer-farm.mjs`
- `package.json` (scripts `devcontainer:farm` e `devcontainer:farm:pi`)
- `docs/guides/unified-dogfood-isolation.md` (attach Linux/Windows + checklist TUI+WEB)
- `docs/research/devcontainer-blueprint-2026-04-21.md` (evidência do micro-slice)

## Verificação
- Comando de entrada simplificado validado por help:
  - `/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe scripts/devcontainer-farm.mjs --help`
- Inspeção confirma invariantes:
  - user não-root (`remoteUser: vscode`)
  - workdir correto (`/workspaces/agents-lab`)
  - runtime local (`PI_CODING_AGENT_DIR=/workspaces/agents-lab/.sandbox/pi-agent`)

## Critérios de aceite
1. Estrutura `.devcontainer/` alinhada ao fluxo do laboratório — **passed**.
2. Comando de entrada/attach estilo farm com usuário/workdir corretos — **passed**.
3. Checklist de validação TUI+WEB em isolamento por plataforma — **passed**.
