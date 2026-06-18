---
title: Evidence Ladder
description: Evidence ladder for turning agents-lab claims into repeatable checks, benchmark packets and promotion decisions.
---

# Evidence Ladder

Status: operating guide for evidence-first work.

This guide defines how agents-lab turns a claim into evidence. It complements
[0.8 Scope Boundary]({{ '/guides/0-8-scope-boundary.html' | relative_url }}):
the boundary says which ring a capability belongs to; this ladder says what proof
is needed before the project can claim progress.

## Principle

A result is strong when another agent or maintainer can reproduce the same
conclusion without knowing the conversation that produced it.

That means every promoted claim should have:

- a named scope;
- a command, packet, report or document path;
- a pass/fail or bounded decision;
- freshness or generated-at metadata when runtime state matters;
- a clear non-claim describing what the evidence does not prove.

## Level 0: Conversation Only

Use this for thinking, triage and direction-setting.

Evidence shape:

- no durable artifact required;
- acceptable for early design discussion;
- not acceptable for release notes, README claims or default changes.

Promotion trigger:

- the same point affects planning twice;
- the claim would change user-facing behavior;
- a future agent would need the context to avoid repeating the debate.

Promote to Level 1 by writing a guide, research note, board task or primitive.

## Level 1: Written Boundary

Use this when the important outcome is conceptual clarity.

Evidence shape:

- guide, primitive or research note;
- explicit scope and non-goals;
- linked from an entry point if it steers active work.

Current examples:

- `docs/guides/0-8-scope-boundary.md` defines what blocks 0.8.0 and what does not.
- `ROADMAP.md` defines macro direction.
- `docs/research/0-8-readiness-map.md` records selected release evidence.

This level proves alignment, not runtime behavior.

## Level 2: Deterministic Local Check

Use this for claims about docs, package metadata, boundaries and static/runtime
contracts that can be checked without external services.

Evidence shape:

- npm script or test command;
- deterministic output;
- no protected mutation;
- no network dependency unless the command is explicitly a network check.

Canonical checks:

```bash
pnpm run docs:site:smoke
pnpm run docs:package:check
pnpm run test:pi-stack:user-surface
pnpm run test:engine:boundary
pnpm run engine:boundary:audit
pnpm run release:package:smoke
pnpm run release:readiness:v0.8.0:json
```

This level proves the local contract is coherent. It does not prove UX quality,
provider quality or long-run autonomy.

## Level 3: Runtime Readiness Packet

Use this when the claim depends on current local runtime state.

Evidence shape:

- JSON report or packet;
- generated timestamp;
- explicit blockers/warnings;
- no hidden action beyond diagnosis.

Canonical checks:

```bash
pnpm run pi:runtime:health:json
pnpm run pi:dev:pressure:json
pnpm run pi:artifact:audit
pnpm run subagent:readiness
pnpm run decoupling:maturity:json
```

This level proves that the current environment can continue a bounded class of
work. It does not prove that the capability should become a default.

## Level 4: Benchmark Or Canary Packet

Use this for claims about quality, speed, cost, routing, worker behavior or
model/provider suitability.

Evidence shape:

- named benchmark/canary run;
- input set or run spec;
- output artifact under `.artifacts/` or `docs/research/data/`;
- scorecard or summary document;
- comparison baseline when making an improvement claim.

Canonical checks and families:

```bash
pnpm run benchmark:context
pnpm run calibrate:repro
pnpm run agent-run:driver-canaries
pnpm run test:agent-run:drivers
```

Existing research families:

- web routing A/B under `docs/research/web-routing-*`;
- context economy runs under `docs/research/data/context-economy/`;
- worker/provider arena under `docs/research/worker-provider-model-arena-2026-05.md`.

This level proves a bounded behavior under a known setup. It does not promote a
setting, provider, bridge or orchestration mode by itself.

## Level 5: Promotion Decision

Use this when a capability should move closer to the default path.

Evidence shape:

- two or more successful uses in realistic lab cycles, unless the capability is
  only a safety fix;
- documented operator value;
- known failure modes;
- rollback or deprecation route;
- user-surface impact checked;
- package/docs impact checked if distributed.

Required questions:

1. Which ring does this belong to: baseline, lab, advanced operation or research?
2. What breaks if it stays opt-in?
3. What breaks if it becomes default?
4. Which command proves it still works after a fresh checkout?
5. Which claim must remain explicitly out of scope?

Promotion may update defaults only after the evidence answers those questions.

## First Result Set For 0.8.x

To make agents-lab results repeatable and reviewable, prioritize this small set:

| Result | Evidence | Non-claim |
|---|---|---|
| Baseline release readiness is green | `pnpm run release:readiness:v0.8.0:json` | Does not approve tag or publish |
| Public/docs navigation is coherent | `pnpm run docs:site:smoke` + `pnpm run docs:package:check` | Does not prove every research page is current |
| Default user surface is small and dogfooded | `pnpm run test:pi-stack:user-surface` + `pnpm run pi-stack:user-surface` | Does not prove every opt-in extra is good or every public claim is ready |
| Engine boundary stays portable | `pnpm run engine:boundary:audit` | Does not mean Refarm adapter exists |
| Runtime can continue bounded local work | `pnpm run pi:runtime:health:json` | Does not authorize long-run autonomy |
| Worker envelope is bounded | `pnpm run agent-run:driver-canaries` | Does not authorize broad swarm/colony |
| Context economy can be compared | `pnpm run benchmark:context` | Does not create a universal context rule |
| Host checkout/cache bridge is worth building | future read-only discovery packet | Does not authorize broad host scans |

## Host Checkout And Cache Bridge Evidence

The bridge should start as Level 4 evidence, not as default runtime behavior.

Minimum first packet:

- configured roots only;
- read-only discovery;
- path mapping from container path to host-intended path when available;
- checkout/cache type detection;
- freshness metadata;
- redacted summary;
- no recursive content scan by default.

A good first benchmark question is:

> Can an agent inside the agents-lab container find and summarize the operator's
> approved adjacent/cache checkouts well enough to compare local evidence against
> ecosystem references without manual path gymnastics?

Passing that question once proves usefulness. Passing it in two real workflows
makes it a candidate for a primitive or tool.

## Claim Discipline

Do not write public claims like these without Level 4 or Level 5 evidence:

- best agentic engineering stack;
- swarm-ready;
- provider-agnostic routing;
- secure sandbox;
- automatic memory substrate;
- host/cache bridge solved;
- production-ready control plane.

Prefer narrower claims:

- default install path is checked;
- release readiness is green but operator-gated;
- worker driver canaries pass for declared envelopes;
- bridge design is read-only and not yet default;
- advanced orchestration remains opt-in.
