#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/workspaces/agents-lab"
cd "$REPO_ROOT"

export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}"
export PNPM_HOME="${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
export PATH="$REPO_ROOT/node_modules/.bin:$PNPM_HOME/bin:$PNPM_HOME:$NPM_CONFIG_PREFIX/bin:/home/vscode/.local/bin:$PATH"

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
  repair_owned_dir "$pnpm_home/bin"

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

workspace_install_needed() {
  if [[ ! -x "$REPO_ROOT/node_modules/.bin/pi" ]]; then
    return 0
  fi

  if [[ ! -e "$REPO_ROOT/packages/pi-stack/node_modules/@ifi/oh-pi-extensions/package.json" ]]; then
    return 0
  fi

  return 1
}

install_workspace_if_needed() {
  if ! workspace_install_needed; then
    return 0
  fi

  echo "[agents-lab-devcontainer] workspace install missing or has broken package links; restoring..."
  if [[ -f pnpm-lock.yaml ]]; then
    pnpm install --frozen-lockfile --prefer-offline --config.confirm-modules-purge=false \
      || pnpm install --prefer-offline --config.confirm-modules-purge=false \
      || true
  else
    pnpm install --prefer-offline --config.confirm-modules-purge=false || true
  fi
}

check_agent_sandbox_tools() {
  local missing=()

  for tool in bwrap fd gh jq rg shellcheck shfmt tree uv; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing+=("$tool")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo "[agents-lab-devcontainer][warn] Missing sandbox tools: ${missing[*]}"
    echo "[agents-lab-devcontainer][warn] Rebuild the devcontainer so Dockerfile/features tool installs are applied."
  fi

  if command -v bwrap >/dev/null 2>&1; then
    if ! bwrap --ro-bind / / true >/dev/null 2>&1; then
      echo "[agents-lab-devcontainer][warn] bubblewrap is installed but cannot create namespaces."
      echo "[agents-lab-devcontainer][warn] Rebuild/reopen the devcontainer, or enable unprivileged user namespaces on the host."
    fi
  fi
}

repair_owned_dir /home/vscode/.local
repair_owned_dir /home/vscode/.local/state
repair_owned_dir /home/vscode/.config
repair_owned_dir /home/vscode/.cache
repair_owned_dir "${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
repair_owned_dir "${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}"
repair_owned_dir /home/vscode/.local/share
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}/bin"
repair_owned_dir "${PNPM_HOME:-/home/vscode/.local/share/pnpm}/store"
repair_owned_dir /home/vscode/.local/share/claude
repair_owned_dir /home/vscode/.local/bin
repair_owned_dir /home/vscode/.config/gh
repair_owned_dir /home/vscode/.pi
repair_owned_dir /home/vscode/.claude
repair_owned_dir /home/vscode/.codex
if [[ -d "$REPO_ROOT/node_modules" ]]; then
  repair_owned_dir "$REPO_ROOT/node_modules"
fi

ensure_pnpm
check_agent_sandbox_tools

if [[ -f package.json ]]; then
  pnpm --silent run ops:disk:check || true
fi

install_claude_code_if_missing_or_broken
install_global_tool_if_missing codex @openai/codex
install_workspace_if_needed

if ! command -v gh >/dev/null 2>&1; then
  echo "[agents-lab-devcontainer][warn] gh missing. Rebuild the devcontainer to install GitHub CLI."
elif gh auth status -h github.com >/dev/null 2>&1; then
  gh auth setup-git >/dev/null 2>&1 || true
elif [[ -z "${GH_TOKEN:-}" ]]; then
  echo "[agents-lab-devcontainer][info] GitHub CLI login not found yet. Run: gh auth login"
fi

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
