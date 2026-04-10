---
name: git-workflow
description: >
  Git workflow assistant for branching, PRs, and conflict resolution. Use when
  the user asks about git strategy, branch management, PR workflow, or needs
  non-interactive git operations.
---

# Git Workflow

Help with Git operations and workflow strategy.

## Branch Strategy

```bash
# Inspect current state
git branch -a
git log --oneline -20
git status
```

Recommend strategy based on project context:

- **Solo**: `main` + short-lived feature branches
- **Team**: `main` + `develop` + `feature/*` / `fix/*` branches
- **Release cadence**: GitFlow (`main` / `develop` / `release/*` / `hotfix/*`)

## PR / MR Workflow

1. `git diff main --stat` — review what changed
2. Draft a clear title and description
3. Suggest reviewers based on touched files: `git log --format='%an' -- <files>`
4. Always include the full PR/MR URL in any summary or status update:
   ```
   PR: https://github.com/owner/repo/pull/42
   ```
   Retrieve with: `gh pr view --json url --jq .url` (GitHub) or `glab mr view --output json | jq .web_url` (GitLab)

## Conflict Resolution

1. `git diff --name-only --diff-filter=U` — find conflicted files
2. Read each conflicted file
3. Understand both sides of the conflict
4. Resolve with minimal changes, preserving intent from both sides

## Interactive Rebase

Guide through `git rebase -i` for cleaning history before a PR.

If resolving conflicts during rebase, continue non-interactively:
```bash
GIT_EDITOR=true git rebase --continue
```

## Non-Interactive Safety

When the agent runs `git` or `gh`/`glab`, never open an interactive editor or prompt.

**Commits** — always pass message on the command line:
```bash
git commit -m "fix(scope): message"
```

**Rebase continue** — `--no-edit` is not supported, use:
```bash
GIT_EDITOR=true git rebase --continue
# or
git -c core.editor=true rebase --continue
```

**Merge** — reuse existing message:
```bash
git merge --no-edit
```

**Any other git command that could open an editor:**
```bash
GIT_EDITOR=true git <command>
```

**GitHub CLI** — disable prompts and provide all fields explicitly:
```bash
GH_PROMPT_DISABLED=1 gh pr create --title "..." --body "..."
GH_PROMPT_DISABLED=1 gh pr merge --squash --delete-branch
```

**GitLab CLI** — same principle:
```bash
glab mr create --title "..." --description "..." --yes
glab mr merge --yes
```

Only allow interactive editors or prompts when the user explicitly asks for them.
