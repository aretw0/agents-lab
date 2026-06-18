# Agent Skills Compatibility Check

Date: 2026-06-18

Decision: adopt core Agent Skills compatibility as a release gate for first-party skill packages.

Source: https://agentskills.io/specification

## Scope

The compatibility target is the portable skill directory format:

- `skills/<skill-name>/SKILL.md`
- YAML frontmatter with `name` and `description`
- `name` matches the parent directory and uses lowercase letters, numbers and hyphens
- optional `compatibility`, `metadata`, `allowed-tools`, `scripts/`, `references/` and `assets/`

Pi remains allowed to add distribution metadata through `package.json#pi.skills`. That field is a Pi package hint, not a replacement for the portable skill directory contract.

## Gate

`scripts/agent-skills-compat-audit.mjs` validates the first-party packages that publish `pi.skills`:

- `@aretw0/git-skills`
- `@aretw0/web-skills`
- `@aretw0/pi-skills`
- `@aretw0/lab-skills`

The gate is intentionally offline and does not fetch `skills-ref`; it encodes the stable core constraints locally so CI and release checks are reproducible.

## Current Result

The first-party packages expose 28 skills in the core Agent Skills shape. The project should claim compatibility as:

> Core Agent Skills format compatible; Pi package manifests add distribution metadata.

Do not claim registry or marketplace compatibility until a separate integration check exists for that target.
