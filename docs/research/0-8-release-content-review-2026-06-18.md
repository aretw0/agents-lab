---
title: 0.8 Release Content Review - 2026-06-18
description: Operator-facing content review gate for agents-lab 0.8.0.
---

# 0.8 Release Content Review - 2026-06-18

Status: release content review gate
Target: 0.8.0
Decision: pass

This review is intentionally stricter than package smoke, package promise and dogfood coverage. Those checks prove that the installed surface is inventoried, covered and coherent. This file records whether the operator accepts the public content and package promise as ready to cut.

Review outcome as of 2026-06-18: recommended pass, pending explicit operator approval. The public entry path, package READMEs, installer profile language and non-claims were checked against the 0.8 scope boundary. No content blocker remains besides the approval decision.

## Package Promise

Current evidence:

- `package:promise:audit` passes for all release packages.
- Package READMEs list shipped skills, prompts, extensions and themes.
- `@aretw0/pi-stack` README now lists all 34 shipped extensions and the shipped theme.

Reviewed outcome:

- package descriptions now describe shipped surfaces rather than broad capability claims;
- `@aretw0/pi-stack` lists the complete installed extension/theme surface;
- `@aretw0/*-skills` READMEs list the skills users receive after installation;
- the `pi-stack` headline was softened from a broad "brings everything" claim to a curated local-first stack claim.

## Installed Surface

Current evidence:

- `pi-stack:user-surface` reports no lab-only or promotion-candidate scripts.
- shipped extension dogfood coverage is `34/34`.
- `release-package-smoke` blocks package-list/devDependency drift.

Reviewed outcome:

- every shipped extension is inventoried in the package README;
- `strict-curated` is stated as the default profile;
- `curated-runtime` and `stack-full` are framed as explicit opt-in profiles;
- lab-only root scripts are not exposed as user-surface blockers.

## Dogfood Evidence

Current evidence:

- each shipped extension has at least smoke-test or lab-wrapper coverage;
- release readiness includes `packageSmoke`, `packagePromise` and `userSurface` gates.

Reviewed outcome:

- current gate distinguishes smoke/package/user-surface evidence from release approval;
- advanced colony/swarm, hosted control plane, channel parity and broad benchmark claims remain non-claims;
- accepted experimental surfaces are framed as opt-in or lab evidence, not as default maturity.

## Public Docs

Current evidence:

- `docs:site:smoke` passes;
- `docs:package:check` passes;
- `repo:discourse:audit` reports zero findings;
- information architecture audit passes for indexed guides/primitives.

Reviewed outcome:

- public first path is README -> Start Here -> Recommended pi-stack / 0.8 scope boundary / Evidence ladder;
- 0.8 docs describe release boundaries, not release approval;
- research remains dated evidence and is explicitly not the canonical public contract until promoted.

## Installer Profiles

Current evidence:

- package-list exports `strict-curated`, `curated-runtime` and `stack-full`;
- README states `strict-curated` is default;
- third-party managed packages are declared in `packages/pi-stack/package.json`.

Reviewed outcome:

- default install is described as `strict-curated`;
- runtime extras are opt-in through `--runtime-extras`;
- `stack-full` is presented as broad coverage, not the recommended default.

## Non-Claims

0.8.0 must not claim:

- broad colony/swarm maturity;
- full Refarm runtime compatibility;
- vault-seed integration;
- hosted control plane readiness;
- Telegram/Matrix/channel parity;
- universal benchmark superiority;
- every research document being current.

## Operator Decision

Recommended decision: pass.

Decision remains `hold` until the operator explicitly accepts the package promise, public docs, installer profile language and release narrative.

To approve this gate, change the top-level decision line to:

```text
Decision: pass
```

Do not approve by changing tests alone.
