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

ensure_pnpm() {
  local pnpm_home="${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
  repair_owned_dir "$pnpm_home"

  corepack prepare --activate || true

  if ! command -v pnpm >/dev/null 2>&1; then
    cat > "$pnpm_home/pnpm" <<'SH'
#!/usr/bin/env bash
exec corepack pnpm "$@"
SH
    chmod +x "$pnpm_home/pnpm"
  fi
}

install_global_tool_if_missing() {
  local command_name="$1"
  local package_name="$2"

  if command -v "$command_name" >/dev/null 2>&1; then
    return 0
  fi

  echo "[agents-lab-devcontainer] $command_name missing; installing $package_name..."
  pnpm add -g "$package_name" || {
    echo "[agents-lab-devcontainer][warn] $command_name still missing. Retry later: pnpm add -g $package_name"
    return 0
  }
}

install_claude_code_if_missing_or_broken() {
  if command -v claude >/dev/null 2>&1 && claude --version >/dev/null 2>&1; then
    return 0
  fi

  echo "[agents-lab-devcontainer] claude missing or incomplete; installing Claude Code native binary..."
  if curl -fsSL https://claude.ai/install.sh | bash; then
    return 0
  fi

  if command -v claude >/dev/null 2>&1 && claude --version >/dev/null 2>&1; then
    return 0
  fi

  echo "[agents-lab-devcontainer] Retrying Claude Code native install with --force..."
  curl -fsSL https://claude.ai/install.sh | bash -s -- --force || {
    echo "[agents-lab-devcontainer][warn] claude still missing. Retry later: curl -fsSL https://claude.ai/install.sh | bash -s -- --force"
    return 0
  }
}

install_workspace_if_pi_missing() {
  if [[ -x "$REPO_ROOT/node_modules/.bin/pi" ]]; then
    return 0
  fi

  echo "[agents-lab-devcontainer] pi missing from node_modules; restoring workspace install..."
  if [[ -f pnpm-lock.yaml ]]; then
    pnpm install --frozen-lockfile --prefer-offline --config.confirm-modules-purge=false \
      || pnpm install --prefer-offline --config.confirm-modules-purge=false \
      || true
  else
    pnpm install --prefer-offline --config.confirm-modules-purge=false || true
  fi
}

repair_owned_dir "${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
repair_owned_dir "${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}"
repair_owned_dir /home/vscode/.local/share
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}/store"
repair_owned_dir /home/vscode/.local/share/claude
repair_owned_dir /home/vscode/.local/bin
repair_owned_dir /home/vscode/.pi
repair_owned_dir /home/vscode/.claude
repair_owned_dir /home/vscode/.codex
if [[ -d "$REPO_ROOT/node_modules" ]]; then
  repair_owned_dir "$REPO_ROOT/node_modules"
fi

ensure_pnpm

if [[ -f package.json ]]; then
  pnpm run ops:disk:check --silent || true
fi

install_claude_code_if_missing_or_broken
install_global_tool_if_missing codex @openai/codex
install_workspace_if_pi_missing

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
