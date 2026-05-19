#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/workspaces/agents-lab"
LOCAL_AGENT_DIR="$REPO_ROOT/.sandbox/pi-agent"
SETTINGS_FILE="$LOCAL_AGENT_DIR/settings.json"

mkdir -p "$LOCAL_AGENT_DIR"
mkdir -p "${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
mkdir -p "${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}/bin"
mkdir -p "${PNPM_HOME:-/home/vscode/.local/share/pnpm}/store"
mkdir -p /home/vscode/.local/bin
mkdir -p /home/vscode/.pi /home/vscode/.claude /home/vscode/.codex

install_global_tool() {
  local command_name="$1"
  local package_name="$2"

  if command -v "$command_name" >/dev/null 2>&1; then
    echo "[agents-lab-devcontainer] $command_name already installed"
    return 0
  fi

  echo "[agents-lab-devcontainer] Installing $package_name..."
  pnpm add -g "$package_name"
}

if [[ ! -f "$SETTINGS_FILE" ]]; then
  cat > "$SETTINGS_FILE" <<'JSON'
{
  "packages": [],
  "notes": "workspace-local PI_CODING_AGENT_DIR (devcontainer)"
}
JSON
fi

corepack enable || true
corepack prepare --activate || true

install_global_tool claude @anthropic-ai/claude-code || true
install_global_tool codex @openai/codex || true

# Git — encoding PT-BR e nomes de arquivo legíveis em logs
git config core.quotepath false
git config i18n.commitEncoding UTF-8
git config i18n.logOutputEncoding UTF-8

if [[ -f pnpm-lock.yaml ]]; then
  pnpm install --frozen-lockfile --prefer-offline
else
  pnpm install --prefer-offline
fi
