---
title: Supply-chain CI Hardening
description: Runbook for pnpm, dependency cache and publish safety in this repository.
---

# Supply-chain CI Hardening

This guide is repository maintenance material. It documents the current `agents-lab` package-manager, CI cache and publish policy; it is not a generic user guide for packaged Pi skills.

## Current Inventory

- Package manager: `package.json` pins `pnpm` with `packageManager`.
- Workspace: `pnpm-workspace.yaml` owns `packages/*`, `minimumReleaseAge: 1440` and the explicit `allowBuilds` list.
- Lockfile: `pnpm-lock.yaml` is the canonical lockfile. `package-lock.json` is not used.
- Install path: `.github/actions/setup/action.yml` validates `pnpm-lock.yaml` and runs `pnpm install --frozen-lockfile`.
- Root scripts: workspace install, tests, audits, docs and release preparation use `pnpm`/`pnpm exec`.
- `npm` use is intentional only for registry semantics: `npm publish --provenance`, `npm pack` package smoke evidence and `npm deprecate` release recovery.
- `npx` use is public installer UX for `@aretw0/pi-stack`, not a development install path.
- GitHub Packages is not configured in the current publish workflow. Keep it `not-configured-opt-in` until there is a separate package visibility, credential and consumer-routing decision.
- CI cache: `.github/workflows/ci.yml` disables dependency cache writes on pull requests by passing `{% raw %}`cache-mode: ${{ github.event_name == 'pull_request' && 'off' || 'auto' }}`{% endraw %}.
- Publish cache: `.github/workflows/publish.yml` keeps dependency cache off and publishes only from an accepted release path with npm provenance.
- Audit: `.github/workflows/security-audit.yml` is isolated from pull requests and runs with read-only repository permissions.

## Change Policy

- Do not regenerate the lockfile as part of unrelated work.
- Do not add lifecycle build approval to `allowBuilds` without naming the package and why the build script is trusted.
- Do not turn CI dependency cache back on for pull requests.
- Do not change publish credentials, provenance, tags or package visibility in the same commit as dependency churn.
- Do not edit `node_modules`; fix source, manifests or lockfile through a reviewable commit.
- Treat any package-manager rollback to npm as protected scope: it needs a separate branch, generated `package-lock.json`, CI parity and operator approval before replacing pnpm as the canonical installer.

## Validation

For a focused supply-chain or CI cache change:

```bash
pnpm install --frozen-lockfile --offline
pnpm run test:ci:workflow
pnpm run release:package:smoke
pnpm run ci:local:parity
```

Use the offline install first when the store is already warm. If it fails because a package is genuinely absent from cache, stop and decide whether network install is part of the task.

## Rollback

- Config-only regression: revert the commit that touched `.github/workflows/*`, `.github/actions/setup/action.yml`, `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml`.
- CI cache regression: set the affected setup call to `cache-mode: "off"` in a small commit, then re-run `pnpm run test:ci:workflow`.
- Dependency resolution regression: restore the previous `pnpm-lock.yaml` and rerun `pnpm install --frozen-lockfile --offline`.
- Publish regression: do not retry manually until the release tag, package versions, provenance permission and npm token scope are rechecked.
- GitHub Packages regression: remove the package registry mutation unless the task explicitly approved GitHub Packages as a publish target and updated the smoke evidence.

## Evidence

The cached evidence packet is [`source-backed-pnpm-supply-chain-evidence-2026-05.md`]({{ '/research/source-backed-pnpm-supply-chain-evidence-2026-05.html' | relative_url }}). Treat it as prior art for this repo, not as authorization to mutate dependencies.
