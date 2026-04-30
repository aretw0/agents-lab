---
name: git-checkout-cache
description: "Cache and refresh remote git repositories under ~/.cache/checkouts/<host>/<org>/<repo> for reuse. Use when the user points you to a remote git repository as reference, or when you need to read, search or analyze a remote repo locally without full clone overhead."
---

Use this skill when the user points you to a remote git repository (GitHub/GitLab/Bitbucket URLs, `git@...`, or `owner/repo` shorthand) as a reference for reading or analysis.

The goal is to keep a reusable local checkout that is:
- **stable** (predictable path)
- **up to date** (periodic fetch + fast-forward when safe)
- **efficient** (partial clone with `--filter=blob:none`, no repeated full clones)

## Cache location

```
~/.cache/checkouts/<host>/<org>/<repo>
```

Example: `github.com/aretw0/agents-lab` → `~/.cache/checkouts/github.com/aretw0/agents-lab`

## Command

Use the versioned helper from this skill directory. From the repository root:

```bash
bash packages/git-skills/skills/git-checkout-cache/checkout.sh <repo> --path-only
```

Examples:

```bash
bash packages/git-skills/skills/git-checkout-cache/checkout.sh aretw0/agents-lab --path-only
bash packages/git-skills/skills/git-checkout-cache/checkout.sh github.com/mitsuhiko/minijinja --path-only
bash packages/git-skills/skills/git-checkout-cache/checkout.sh https://github.com/mitsuhiko/minijinja --path-only
bash packages/git-skills/skills/git-checkout-cache/checkout.sh git@github.com:mitsuhiko/minijinja.git --path-only
```

Avoid recipes that set shell variables in the pi `bash` tool command string (for example `CACHE=...; echo $CACHE`), because some harnesses can pre-expand `$VAR` before the command reaches bash. Prefer direct helper arguments and literal paths.

The script will:
1. Parse the repo reference into `host/org/repo`
2. Clone if missing (partial clone with `--filter=blob:none`)
3. Reuse existing checkout if present
4. Fetch from `origin` when stale (default interval: 300s)
5. Attempt fast-forward merge if checkout is clean and has upstream

## Force refresh

```bash
bash packages/git-skills/skills/git-checkout-cache/checkout.sh <repo> --force-update --path-only
```

## Dry-run/path validation

For local smoke checks or path-only planning without network access:

```bash
bash packages/git-skills/skills/git-checkout-cache/checkout.sh <repo> --dry-run --path-only
```

The dry-run mode parses the repo reference and prints the deterministic cache path without cloning or fetching.

## Recommended workflow

1. Resolve path via `checkout.sh --path-only`
2. Use that path for `grep`, `read`, `find`, and analysis
3. On later references to the same repo, call `checkout.sh` again — hits cache

## Notes

- `owner/repo` shorthand defaults to `github.com`.
- Prefer not to edit directly in the shared cache — create a worktree or copy for task-specific changes.
- If the helper is unavailable, do not improvise a long shell-variable recipe. Either use `git clone --filter=blob:none <url> <literal-cache-path>` with escaped variables avoided, or record an Ops blocker and continue the main lane with already available local evidence.
- The helper accepts `--cache-root <dir>` for tests/sandboxes and `--stale-seconds <n>` for refresh tuning.
