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
  npm install -g "$package_name"
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

install_global_tool claude @anthropic-ai/claude-code || true
install_global_tool codex @openai/codex || true

if [[ -f package-lock.json ]]; then
  npm ci --prefer-offline --no-audit --no-fund
else
  npm install --prefer-offline --no-audit --no-fund
fi
