#!/usr/bin/env bash
set -euo pipefail

script="packages/git-skills/skills/git-checkout-cache/checkout.sh"
cache_root="/tmp/pi-checkout-cache-smoke"

if [ ! -f "$script" ]; then
  echo "missing checkout helper: $script" >&2
  exit 1
fi

bash -n "$script"

expect_path() {
  local repo_ref="$1"
  local expected="$2"
  local actual
  actual="$(bash "$script" "$repo_ref" --dry-run --path-only --cache-root "$cache_root")"
  if [ "$actual" != "$expected" ]; then
    echo "unexpected path for $repo_ref" >&2
    echo "expected: $expected" >&2
    echo "actual:   $actual" >&2
    exit 1
  fi
}

expect_path "aretw0/agents-lab" "$cache_root/github.com/aretw0/agents-lab"
expect_path "github.com/mitsuhiko/agent-stuff" "$cache_root/github.com/mitsuhiko/agent-stuff"
expect_path "https://github.com/mitsuhiko/agent-stuff.git" "$cache_root/github.com/mitsuhiko/agent-stuff"
expect_path "git@github.com:mitsuhiko/agent-stuff.git" "$cache_root/github.com/mitsuhiko/agent-stuff"

if bash "$script" "not-a-repo" --dry-run --path-only --cache-root "$cache_root" >/tmp/pi-checkout-cache-smoke.out 2>/tmp/pi-checkout-cache-smoke.err; then
  echo "invalid repo unexpectedly succeeded" >&2
  exit 1
fi

printf 'git-checkout-cache-smoke: ok\n'
