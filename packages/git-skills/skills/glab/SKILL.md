---
name: glab
description: "Interact with GitLab using the `glab` CLI. Use for issues, merge requests, CI pipelines, and advanced API queries."
---

# GitLab Skill

Use the `glab` CLI to interact with GitLab. Always specify `--repo namespace/project` when not inside a git directory.

Provide all required fields explicitly to avoid interactive prompts:
```bash
glab mr create --title "..." --description "..." --yes
```

## Issues

```bash
# List open issues
glab issue list --repo namespace/project

# View an issue
glab issue view 42 --repo namespace/project

# Create an issue
glab issue create --title "..." --description "..." --repo namespace/project

# Close an issue
glab issue close 42 --repo namespace/project
```

## Merge Requests

```bash
# List MRs
glab mr list --repo namespace/project

# View an MR
glab mr view 55 --repo namespace/project

# Create an MR (always provide title and description)
glab mr create --title "..." --description "..." --yes --repo namespace/project

# Merge an MR
glab mr merge 55 --yes --repo namespace/project

# Check MR CI status
glab mr checks 55 --repo namespace/project
```

## CI / Pipelines

```bash
# List recent pipelines
glab ci list --repo namespace/project

# View pipeline status
glab ci status --repo namespace/project

# View detailed pipeline jobs
glab ci view --repo namespace/project

# View logs for a specific job
glab ci trace --repo namespace/project
```

## JSON Output

Use `--output json` for structured output and pipe to `jq`:

```bash
glab issue list --output json | jq '.[] | "\(.iid): \(.title)"'

glab mr list --output json | jq '.[] | "\(.iid) [\(.source_branch)]: \(.title)"'

# Get MR URL
glab mr view 55 --output json | jq .web_url
```

## API for Advanced Queries

Use `glab api` for anything not covered by subcommands:

```bash
# Get project details
glab api projects/namespace%2Fproject

# List merge requests with specific fields
glab api projects/namespace%2Fproject/merge_requests --field state=opened \
  | jq '.[] | "\(.iid): \(.title)"'

# Paginated results
glab api --paginate projects/namespace%2Fproject/issues | jq '.[].title'
```

Note: GitLab API uses URL-encoded namespace/project — replace `/` with `%2F`.
