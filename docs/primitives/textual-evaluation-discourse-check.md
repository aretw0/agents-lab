# Textual evaluation discourse check

Status: initial primitive

## Purpose

A textual evaluation discourse check catches wording that is useful in a live
conversation but too loaded, broad or self-congratulatory for canonical project
surfaces.

This is a reusable primitive for agents-lab, vault-seed-style Markdown vaults and
future consumers that need text quality gates without turning editorial taste
into hidden policy.

## Problem

Operators often use vivid shorthand while thinking: strong adjectives, release
slogans, ecosystem claims, internal nicknames or urgency language. That can be
helpful during exploration, but it should not automatically land in guides,
README files, release notes, primitives or benchmark summaries.

Without a check, the project drifts in two directions:

- public docs inherit conversation language and overclaim maturity;
- agents overcorrect manually, with no reusable rule or score.

## Contract

Input:

- text content;
- path or surface class;
- optional allowlist for historical research, code identifiers and quoted input.

Output:

- `decision`: `pass|advisory|block-canonical`;
- findings with `rule`, `severity`, `line`, `excerpt` and `suggestedAction`;
- summary counts by rule and severity;
- explicit non-claims.

Minimum rule families:

| Rule family | Detects | Default severity |
|---|---|---|
| loaded confidence | words that imply proof without evidence | advisory |
| self-congratulation | marketing-style praise of the project itself | advisory |
| aspirational maturity | claims of production, autonomy, swarm or sandbox maturity without gate | advisory or block-canonical |
| stale state | statements that contradict current readiness/CI/release evidence | advisory |
| legacy terminology | terms kept for historical context but not canonical surfaces | advisory |
| conversation residue | phrases that make sense only inside the chat that produced the doc | advisory |

## Surface Policy

| Surface | Policy |
|---|---|
| Live conversation | no check required |
| Draft research | advisory only unless it creates a false operational claim |
| Guides/primitives/architecture | advisory by default; block canonical when claim exceeds evidence |
| README/release notes | stricter; loaded maturity or release claims require evidence link |
| Generated package copies | check source document, not generated copy |
| Historical archive | ignore unless promoted back into canonical docs |

## Existing Local Implementation

agents-lab already has a first slice:

- script: `pnpm run repo:discourse:audit`;
- JSON: `pnpm run repo:discourse:audit:json`;
- tests: `pnpm run test:repo:discourse:audit`;
- stack surface: `/stack-quality` and `stack_quality_audit` include discourse findings.

That implementation is a repository discourse audit. This primitive generalizes
the idea so it can become a textual evaluation packet for other Markdown-backed
systems, including vault-seed-like projections.

## Vault-Seed Fit

For a vault or Markdown knowledge base, this check should operate as a projection
quality gate:

1. Classify the note surface: fleeting note, research, canonical guide, release
   note, public index or generated projection.
2. Apply rules appropriate to that surface.
3. Preserve operator voice in private notes.
4. Normalize claims before publishing or promoting to canonical docs.
5. Emit a small packet that another agent can consume without re-reading the full
   vault.

The goal is not to make text bland. The goal is to keep the difference between
thinking language and canonical language explicit.

## Promotion Criteria

Promote beyond advisory when:

1. The same class of wording causes repeated correction in canonical docs.
2. The rule can be expressed with low false-positive risk.
3. The output includes suggested replacement direction, not only a complaint.
4. Historical/research surfaces are protected from noisy rewrites.
5. At least one non-agents-lab corpus can consume the packet shape.

## Non-Goals

- Rewriting docs automatically.
- Blocking private notes or brainstorms.
- Enforcing one writing style everywhere.
- Treating Portuguese or English as inherently more canonical.
- Replacing human editorial judgment for release notes.
