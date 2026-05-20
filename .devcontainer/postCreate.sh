#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/workspaces/agents-lab"
LOCAL_AGENT_DIR="$REPO_ROOT/.sandbox/pi-agent"
SETTINGS_FILE="$LOCAL_AGENT_DIR/settings.json"

repair_owned_dir() {
  local dir="$1"
  mkdir -p "$dir" 2>/dev/null || {
    if command -v sudo >/dev/null 2>&1; then
      sudo mkdir -p "$dir"
    else
      return 0
    fi
  }
  if [[ ! -w "$dir" ]] && command -v sudo >/dev/null 2>&1; then
    sudo chown -R "$(id -u):$(id -g)" "$dir" || true
  fi
}

repair_owned_dir "$LOCAL_AGENT_DIR"
repair_owned_dir "${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
repair_owned_dir "${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}"
repair_owned_dir "${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}/bin"
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}/store"
repair_owned_dir /home/vscode/.local/bin
repair_owned_dir /home/vscode/.pi
repair_owned_dir /home/vscode/.claude
repair_owned_dir /home/vscode/.codex
if [[ -d "$REPO_ROOT/node_modules" ]]; then
  repair_owned_dir "$REPO_ROOT/node_modules"
fi

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
