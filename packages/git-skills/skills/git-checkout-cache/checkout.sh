#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: checkout.sh <repo> [--path-only] [--force-update] [--dry-run] [--cache-root <dir>] [--stale-seconds <n>]

Repo forms:
  owner/repo
  github.com/owner/repo
  https://github.com/owner/repo(.git)
  git@github.com:owner/repo.git

Default cache root: ${GIT_CHECKOUT_CACHE_ROOT:-$HOME/.cache/checkouts}
USAGE
}

repo_ref=""
path_only=0
force_update=0
dry_run=0
cache_root="${GIT_CHECKOUT_CACHE_ROOT:-${HOME}/.cache/checkouts}"
stale_seconds=300

while [ "$#" -gt 0 ]; do
  case "$1" in
    --path-only)
      path_only=1
      shift
      ;;
    --force-update)
      force_update=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --cache-root)
      if [ "$#" -lt 2 ]; then
        usage
        exit 2
      fi
      cache_root="$2"
      shift 2
      ;;
    --stale-seconds)
      if [ "$#" -lt 2 ]; then
        usage
        exit 2
      fi
      stale_seconds="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "checkout-cache: unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      if [ -n "$repo_ref" ]; then
        echo "checkout-cache: multiple repo arguments: '$repo_ref' and '$1'" >&2
        usage
        exit 2
      fi
      repo_ref="$1"
      shift
      ;;
  esac
done

if [ -z "$repo_ref" ]; then
  usage
  exit 2
fi

trimmed="${repo_ref# }"
trimmed="${trimmed% }"
trimmed="${trimmed%.git}"

host=""
org=""
repo=""
clone_url=""

case "$trimmed" in
  http://*|https://*)
    without_scheme="${trimmed#http://}"
    without_scheme="${without_scheme#https://}"
    host="${without_scheme%%/*}"
    rest="${without_scheme#*/}"
    org="${rest%%/*}"
    repo="${rest#*/}"
    repo="${repo%%/*}"
    clone_url="https://${host}/${org}/${repo}.git"
    ;;
  git@*:*)
    host_part="${trimmed#git@}"
    host="${host_part%%:*}"
    rest="${host_part#*:}"
    org="${rest%%/*}"
    repo="${rest#*/}"
    repo="${repo%%/*}"
    clone_url="git@${host}:${org}/${repo}.git"
    ;;
  ssh://git@*/*/*)
    without_scheme="${trimmed#ssh://git@}"
    host="${without_scheme%%/*}"
    rest="${without_scheme#*/}"
    org="${rest%%/*}"
    repo="${rest#*/}"
    repo="${repo%%/*}"
    clone_url="git@${host}:${org}/${repo}.git"
    ;;
  */*/*)
    host="${trimmed%%/*}"
    rest="${trimmed#*/}"
    org="${rest%%/*}"
    repo="${rest#*/}"
    repo="${repo%%/*}"
    clone_url="https://${host}/${org}/${repo}.git"
    ;;
  */*)
    host="github.com"
    org="${trimmed%%/*}"
    repo="${trimmed#*/}"
    repo="${repo%%/*}"
    clone_url="https://${host}/${org}/${repo}.git"
    ;;
  *)
    echo "checkout-cache: repo must be owner/repo, host/owner/repo, URL, or git@host:owner/repo.git" >&2
    exit 2
    ;;
esac

if [ -z "$host" ] || [ -z "$org" ] || [ -z "$repo" ] || [ "$org" = "$repo" ]; then
  echo "checkout-cache: could not parse repo reference: $repo_ref" >&2
  exit 2
fi

case "$host/$org/$repo" in
  *..*|*//*|*' '*|*'~'*|*'\'*|*':'*)
    echo "checkout-cache: unsafe parsed cache path: $host/$org/$repo" >&2
    exit 2
    ;;
esac

checkout_path="${cache_root%/}/${host}/${org}/${repo}"

if [ "$dry_run" -eq 1 ]; then
  printf '%s\n' "$checkout_path"
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  echo "checkout-cache: git executable not found" >&2
  exit 127
fi

mkdir -p "$(dirname "$checkout_path")"

if [ ! -d "$checkout_path/.git" ]; then
  git clone --filter=blob:none "$clone_url" "$checkout_path" >&2
  printf '%s\n' "$(date +%s)" > "$checkout_path/.git/pi-checkout-cache-fetch-ts"
  printf '%s\n' "$checkout_path"
  exit 0
fi

now="$(date +%s)"
last_fetch=0
if [ -f "$checkout_path/.git/pi-checkout-cache-fetch-ts" ]; then
  last_fetch="$(cat "$checkout_path/.git/pi-checkout-cache-fetch-ts" 2>/dev/null || printf '0')"
fi
case "$last_fetch" in
  ''|*[!0-9]*) last_fetch=0 ;;
esac

if [ "$force_update" -eq 1 ] || [ $((now - last_fetch)) -ge "$stale_seconds" ]; then
  git -C "$checkout_path" fetch --prune origin >&2 || true
  printf '%s\n' "$now" > "$checkout_path/.git/pi-checkout-cache-fetch-ts"

  if git -C "$checkout_path" diff --quiet --ignore-submodules -- && \
     git -C "$checkout_path" diff --cached --quiet --ignore-submodules && \
     upstream="$(git -C "$checkout_path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    git -C "$checkout_path" merge --ff-only "$upstream" >&2 || true
  else
    echo "checkout-cache: checkout is dirty or has no upstream; fetched only" >&2
  fi
fi

if [ "$path_only" -eq 1 ]; then
  printf '%s\n' "$checkout_path"
else
  printf 'checkout-cache: %s\n' "$checkout_path"
fi
