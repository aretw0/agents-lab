#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/workspaces/agents-lab"
cd "$REPO_ROOT"

echo "[agents-lab-devcontainer] Post-start sanity check..."

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

repair_owned_dir "${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
repair_owned_dir "${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}"
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}/store"
repair_owned_dir /home/vscode/.local/bin
repair_owned_dir /home/vscode/.pi
repair_owned_dir /home/vscode/.claude
repair_owned_dir /home/vscode/.codex
if [[ -d "$REPO_ROOT/node_modules" ]]; then
  repair_owned_dir "$REPO_ROOT/node_modules"
fi

if [[ -f package.json ]]; then
  pnpm run ops:disk:check --silent || true
fi

if [[ ! -d node_modules ]]; then
  echo "[agents-lab-devcontainer][warn] node_modules missing. Run: pnpm install"
fi

for tool in claude codex; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    package_name=$([[ "$tool" == "claude" ]] && echo "@anthropic-ai/claude-code" || echo "@openai/codex")
    echo "[agents-lab-devcontainer][warn] $tool missing. Rebuild, or run: pnpm add -g $package_name"
  fi
done

if [[ ! -x "$REPO_ROOT/node_modules/.bin/pi" ]]; then
  echo "[agents-lab-devcontainer][warn] pi missing from node_modules. Run: pnpm install"
fi

if [[ ! -f /home/vscode/.codex/auth.json ]]; then
  echo "[agents-lab-devcontainer][info] Codex login not found yet. Run: codex login"
fi

if [[ ! -f /home/vscode/.claude/settings.json && ! -f /home/vscode/.claude/CLAUDE.md ]]; then
  echo "[agents-lab-devcontainer][info] Claude user memory/settings not initialized yet. Run: claude"
fi

echo "[agents-lab-devcontainer] Post-start sanity check complete."
