#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/workspaces/agents-lab"
cd "$REPO_ROOT"

echo "[agents-lab-devcontainer] Post-start sanity check..."

if [[ -f package.json ]]; then
  npm run ops:disk:check --silent || true
fi

if [[ ! -d node_modules ]]; then
  echo "[agents-lab-devcontainer][warn] node_modules missing. Run: npm ci"
fi

for tool in claude codex; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[agents-lab-devcontainer][warn] $tool missing. Rebuild, or run: npm install -g $([[ "$tool" == "claude" ]] && echo "@anthropic-ai/claude-code" || echo "@openai/codex")"
  fi
done

if [[ ! -f /home/vscode/.codex/auth.json ]]; then
  echo "[agents-lab-devcontainer][info] Codex login not found yet. Run: codex login"
fi

if [[ ! -f /home/vscode/.claude/settings.json && ! -f /home/vscode/.claude/CLAUDE.md ]]; then
  echo "[agents-lab-devcontainer][info] Claude user memory/settings not initialized yet. Run: claude"
fi

echo "[agents-lab-devcontainer] Post-start sanity check complete."
