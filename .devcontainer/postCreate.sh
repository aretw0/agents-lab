#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/workspaces/agents-lab"
LOCAL_AGENT_DIR="$REPO_ROOT/.sandbox/pi-agent"
SETTINGS_FILE="$LOCAL_AGENT_DIR/settings.json"

mkdir -p "$LOCAL_AGENT_DIR"

if [[ ! -f "$SETTINGS_FILE" ]]; then
  cat > "$SETTINGS_FILE" <<'JSON'
{
  "packages": [],
  "notes": "workspace-local PI_CODING_AGENT_DIR (devcontainer)"
}
JSON
fi

npm install
