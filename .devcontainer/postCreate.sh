#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/workspaces/agents-lab"
LOCAL_AGENT_DIR="$REPO_ROOT/.sandbox/pi-agent"
SETTINGS_FILE="$LOCAL_AGENT_DIR/settings.json"

export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}"
export PNPM_HOME="${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
export PATH="$REPO_ROOT/node_modules/.bin:$PNPM_HOME/bin:$PNPM_HOME:$NPM_CONFIG_PREFIX/bin:/home/vscode/.local/bin:$PATH"

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
repair_owned_dir /home/vscode/.local
repair_owned_dir /home/vscode/.local/state
repair_owned_dir /home/vscode/.config
repair_owned_dir /home/vscode/.cache
repair_owned_dir "${NPM_CONFIG_CACHE:-/home/vscode/.npm-cache}"
repair_owned_dir "${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}"
repair_owned_dir "${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}/bin"
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
# The container runtime may clone as root, leaving .git/objects subdirs as
# drwxr-xr-x and triggering "insufficient permission" on the first commit.
if [[ -d "$REPO_ROOT/.git/objects" ]]; then
  sudo chown -R "$(id -u):$(id -g)" "$REPO_ROOT/.git/objects" 2>/dev/null || true
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

install_claude_code() {
  if command -v claude >/dev/null 2>&1 && claude --version >/dev/null 2>&1; then
    echo "[agents-lab-devcontainer] claude already installed"
    return 0
  fi

  echo "[agents-lab-devcontainer] Installing Claude Code native binary..."
  if curl -fsSL https://claude.ai/install.sh | bash; then
    return 0
  fi

  if command -v claude >/dev/null 2>&1 && claude --version >/dev/null 2>&1; then
    return 0
  fi

  echo "[agents-lab-devcontainer] Retrying Claude Code native install with --force..."
  curl -fsSL https://claude.ai/install.sh | bash -s -- --force
}

if [[ ! -f "$SETTINGS_FILE" ]]; then
  cat > "$SETTINGS_FILE" <<'JSON'
{
  "packages": [],
  "notes": "workspace-local PI_CODING_AGENT_DIR (devcontainer)"
}
JSON
fi

ensure_pnpm

install_claude_code || true
install_global_tool codex @openai/codex || true

# Git — encoding PT-BR e nomes de arquivo legíveis em logs
git config core.quotepath false
git config i18n.commitEncoding UTF-8
git config i18n.logOutputEncoding UTF-8

if command -v gh >/dev/null 2>&1 && gh auth status -h github.com >/dev/null 2>&1; then
  gh auth setup-git >/dev/null 2>&1 || true
fi

if [[ -f pnpm-lock.yaml ]]; then
  pnpm install --frozen-lockfile --prefer-offline --config.confirm-modules-purge=false
else
  pnpm install --prefer-offline --config.confirm-modules-purge=false
fi
