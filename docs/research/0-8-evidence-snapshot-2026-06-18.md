---
title: 0.8 Evidence Snapshot - 2026-06-18
description: Evidence snapshot for the first agents-lab 0.8.x result set using the evidence ladder.
---

# 0.8 Evidence Snapshot - 2026-06-18

Status: evidence snapshot
Generated: 2026-06-18
Scope: agents-lab local checkout in devcontainer

This snapshot applies the [Evidence Ladder]({{ '/guides/evidence-ladder.html' | relative_url }}) to the first 0.8.x result set. It records what is currently proven by local checks and what remains outside the claim.

## Summary

| Result | Evidence level | Decision | Non-claim |
|---|---:|---|---|
| 0.8.0 release readiness is green | Level 2 | pass | Does not approve tag, draft, workflow dispatch or publish |
| Default user surface remains bounded | Level 2 | pass | Does not prove every opt-in extra is high quality |
| Engine boundary remains portable | Level 2 | pass | Does not mean a Refarm adapter exists |
| Runtime can continue bounded local work | Level 3 | continue | Does not authorize long-run autonomy, colony or remote/offload |
| Docs/site navigation remains coherent after boundary docs | Level 2 | pass | Does not prove all research pages are current |
| Package docs remain in sync | Level 2 | pass | Does not promote new guides into distributed package docs |

## Commands Run

```bash
pnpm run release:readiness:v0.8.0:json
pnpm run test:pi-stack:user-surface
pnpm run engine:boundary:audit
pnpm run pi:runtime:health:json
pnpm run docs:site:smoke
pnpm run docs:package:check
```

## Evidence

### Release Readiness

Command:

```bash
pnpm run release:readiness:v0.8.0:json
```

Observed result:

- wrote `.artifacts/release-readiness/v0.8.0-2026-06-18T01-19-47-352Z.json`;
- readiness command exited successfully;
- previous readiness output for the same checkout reported `decision: ready`, `releaseBlockers: []`, `operatorDecisions: []`, `tagAllowed: false`, `publishAllowed: false`, `workflowDispatchAllowed: false`.

Claim allowed:

- the local release readiness gate is green for 0.8.0.

Claim not allowed:

- release is approved;
- tag/publish/workflow dispatch is authorized;
- 0.8.0 should be cut without operator review.

### User Surface

Command:

```bash
pnpm run test:pi-stack:user-surface
```

Observed result:

- Node test passed;
- 17 tests passed;
- 0 failed.

Claim allowed:

- the root script classification/user-surface audit contract remains covered.

Claim not allowed:

- every opt-in runtime extra is ergonomic;
- every lab-only idea is ready for distribution.

### Engine Boundary

Command:

```bash
pnpm run engine:boundary:audit
```

Observed result:

```text
engine-boundary-audit: core=89 portable=89 blockers=0
```

Claim allowed:

- current audited core files satisfy the engine portability boundary.

Claim not allowed:

- Refarm adapter exists;
- all future runtime compatibility work is complete.

### Runtime Health

Command:

```bash
pnpm run pi:runtime:health:json
```

Observed result:

- `decision: continue`;
- `devPressure.recommendation: continue`;
- `pressureSignalCount: 0`;
- `advisoryCount: 2`;
- performance watchdog available from config/session tail;
- `watchdogClass: none`;
- `artifactAudit.violations: []`.

Claim allowed:

- this devcontainer checkout can continue bounded local work.

Claim not allowed:

- unattended long-runs are safe;
- colony/swarm execution is ready;
- live watchdog metrics are externally visible (`liveWatchdogMetricsAvailable: false`).

### Docs And Package Docs

Commands:

```bash
pnpm run docs:site:smoke
pnpm run docs:package:check
```

Observed result:

```text
docs-site-smoke: OK (308 html files, baseurl=/agents-lab)
package-docs: ok check packages=@aretw0/lab-skills, @aretw0/pi-skills, @aretw0/pi-stack
```

Claim allowed:

- the new boundary/ladder docs did not break site smoke or package-doc sync.

Claim not allowed:

- every research page is current;
- these new guides are distributed package docs.

## What This Proves

The first 0.8.x evidence set supports a narrow, defensible claim:

> agents-lab has a local baseline candidate for 0.8.0 readiness, bounded default user surface with shipped-extension dogfood coverage, portable engine boundary, continuing runtime health, and coherent docs navigation.

This is enough to continue operator release review. It is not enough to cut 0.8.0
without explicit review of the public content, release narrative and package
promise. It is also not enough to claim broad automation maturity.

## Next Evidence Gaps

| Gap | Ring | Next evidence |
|---|---|---|
| Host checkout/cache bridge | Ring 2 -> Ring 4 | read-only discovery packet over approved external roots |
| Context economy as recurring benchmark | Ring 2 | fresh `pnpm run benchmark:context` run with scorecard summary |
| Worker envelope confidence | Ring 3 | fresh `pnpm run agent-run:driver-canaries` evidence at current HEAD |
| Release narrative and package promise | Ring 1 | reviewed changelog/release draft plus package surface/dogfood matrix, still with tag/publish blocked |
| Refarm compatibility | Ring 4 | adapter boundary design, not migration |

## Decision

Keep 0.8.0 scoped to baseline release review, but do not cut the release until
the operator accepts the public content, release narrative and package promise.
Continue using this ladder for 0.8.x proof work. Do not promote bridge, colony,
channels, Refarm or vault-seed integration into release blockers without a new
explicit operator decision.
