# Source-backed pnpm/supply-chain evidence — 2026-05

Status: cached evidence packet for future read-only worker canaries.

## Evidence contract

- This artifact is source-backed evidence, not model-memory evidence.
- Every quoted claim below has a declared URL and retrieval date.
- A worker may synthesize this file with local repo files, but must not invent external facts beyond the quoted evidence.
- Model weights are not evidence.
- This packet does not authorize package-manager, CI, publish, lockfile, or credential mutation.

Retrieval date: 2026-05-15.

## Sources and excerpts

### pnpm workspace structure

Source: <https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/workspaces.md>

Quoted excerpt:

> pnpm has built-in support for monorepositories (AKA multi-package repositories, multi-project repositories, or monolithic repositories). You can create a workspace to unite multiple projects inside a single repository. A workspace must have a [`pnpm-workspace.yaml`] file in its root.

Use in this repo: compare the existing `pnpm-workspace.yaml` and package workspaces before claiming pnpm is operationally enforced.

### pnpm CI behavior

Source: <https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/continuous-integration.md>

Quoted excerpt:

> In all the provided configuration files the store is cached. However, this is not required, and it is not guaranteed that caching the store will make installation faster. So feel free to not cache the pnpm store in your job.

Quoted excerpt:

> When pnpm detects that it is running in CI, it switches to frozen-lockfile mode automatically. Since v11, pnpm also fails on incompatible lockfiles in CI.

Use in this repo: distinguish cache optimization from correctness, and check whether CI explicitly uses pnpm before relying on pnpm CI semantics.

### pnpm/Corepack package manager pinning

Source: <https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/installation.md>

Quoted excerpt:

> You can pin the version of pnpm used on your project using the following command: `corepack use pnpm@latest-11`. This will add a `"packageManager"` field in your local `package.json` which will instruct Corepack to always use a specific version on that project.

Use in this repo: check whether root `package.json` has a `packageManager` field before claiming package-manager pinning exists.

### npm provenance requirements

Source: <https://docs.npmjs.com/generating-provenance-statements>

Quoted excerpt:

> To update your GitHub Actions workflow to publish your packages with provenance, you must: Give permission to mint an ID-token: `permissions: id-token: write`; Run on a GitHub-hosted runner; Add the `--provenance` flag to your publish command: `npm publish --provenance`.

Use in this repo: compare `.github/workflows/publish.yml` permissions and publish commands before claiming provenance is complete.

### GitHub Actions hardening

Source: <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>

Quoted excerpt:

> Principle of least privilege ... ensure that the credentials being used within workflows have the least privileges required.

Quoted excerpt:

> You should therefore make sure that the `GITHUB_TOKEN` is granted the minimum required permissions. It's good security practice to set the default permission for the `GITHUB_TOKEN` to read access only for repository contents. The permissions can then be increased, as required, for individual jobs within the workflow file.

Use in this repo: inspect workflow-level and job-level `permissions` before recommending publish/release changes.

### GitHub dependency cache behavior

Source: <https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows>

Quoted excerpt:

> If no exact match is found, it will search for partial matches of the key. If there is still no match found, and you've provided `restore-keys`, these keys will be checked sequentially for partial matches.

Quoted excerpt:

> If no cache exactly matches the provided key, this is considered a cache miss. On a cache miss, the action automatically creates a new cache if the job completes successfully.

Use in this repo: review cache keys/restore keys before adopting dependency caching, especially in workflows that can run on untrusted refs.

## Parent-side synthesis rules

1. Treat this file as the evidence boundary for workers.
2. Require workers to cite this file and local file paths when producing ADOPT/ADAPT/REJECT recommendations.
3. Any claim that needs a source not present here must be returned as `PARENT-CHECK`, not filled from model memory.
4. Separate evidence intake from code mutation: this file can inform a plan, not execute package-manager or workflow changes.
