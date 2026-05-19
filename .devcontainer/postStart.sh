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

echo "[agents-lab-devcontainer] Post-start sanity check complete."
