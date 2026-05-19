#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/workspaces/agents-lab"
LOCAL_AGENT_DIR="$REPO_ROOT/.sandbox/pi-agent"
SETTINGS_FILE="$LOCAL_AGENT_DIR/settings.json"

mkdir -p "$LOCAL_AGENT_DIR"
mkdir -p "${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
mkdir -p "${PNPM_HOME:-/home/vscode/.local/share/pnpm}/store"

if [[ ! -f "$SETTINGS_FILE" ]]; then
  cat > "$SETTINGS_FILE" <<'JSON'
{
  "packages": [],
  "notes": "workspace-local PI_CODING_AGENT_DIR (devcontainer)"
}
JSON
fi

corepack enable || true

if [[ -f package-lock.json ]]; then
  npm ci --prefer-offline --no-audit --no-fund
else
  npm install --prefer-offline --no-audit --no-fund
fi
