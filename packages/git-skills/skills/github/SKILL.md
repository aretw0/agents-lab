---
name: github
description: "Interact with GitHub using the `gh` CLI. Use for issues, PRs, CI runs, releases, and advanced API queries."
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not inside a git directory, or pass URLs directly.

Disable interactive prompts in agent-run commands:
```bash
GH_PROMPT_DISABLED=1 gh <command>
```

## Issues

```bash
# List open issues
gh issue list --repo owner/repo

# View an issue
gh issue view 42 --repo owner/repo

# Create an issue
GH_PROMPT_DISABLED=1 gh issue create --title "..." --body "..." --repo owner/repo

# Close an issue
gh issue close 42 --repo owner/repo
```

## Pull Requests

```bash
# List PRs
gh pr list --repo owner/repo

# View a PR
gh pr view 55 --repo owner/repo

# Create a PR (always provide title and body — never rely on interactive editor)
GH_PROMPT_DISABLED=1 gh pr create --title "..." --body "..." --repo owner/repo

# Check CI status on a PR
gh pr checks 55 --repo owner/repo

# Merge a PR
GH_PROMPT_DISABLED=1 gh pr merge 55 --squash --delete-branch --repo owner/repo
```

## CI / Workflow Runs

```bash
# List recent runs
gh run list --repo owner/repo --limit 10

# View a specific run
gh run view <run-id> --repo owner/repo

# View only failed step logs
gh run view <run-id> --repo owner/repo --log-failed
```

## JSON Output

Most commands support `--json` with `--jq` for structured filtering:

```bash
gh issue list --repo owner/repo --json number,title,state \
  --jq '.[] | "\(.number): \(.title) [\(.state)]"'

gh pr list --repo owner/repo --json number,title,headRefName \
  --jq '.[] | "\(.number) [\(.headRefName)]: \(.title)"'
```

## API for Advanced Queries

Use `gh api` for anything not covered by subcommands:

```bash
# Get PR details
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'

# List labels
gh api repos/owner/repo/labels --jq '.[].name'

# Paginated results
gh api --paginate repos/owner/repo/issues --jq '.[].title'
```
