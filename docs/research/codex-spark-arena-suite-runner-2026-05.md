# Codex Spark arena suite runner — 2026-05

Status: design/runway for moving from manual canaries to bounded arena experiments.

## Position

The arena should become a controlled experiment harness: load a provider/model, run a declared suite of capability envelopes, collect evidence, and produce a promotion scorecard. Manual one-off canaries are useful for bootstrapping, but they are too slow to be the long-term operating mode.

The target is not an uncontrolled swarm. The target is a reproducible suite that can later qualify worker batches/swarms because every capability has already passed under the same contracts: declared scope, budget, tools, output schema, parent validation, and stop conditions.

## Why not rely on model memory

Research-like capabilities must not depend on model weights. There are three distinct rungs:

1. `readonly-declared-evidence-synthesis`: worker reads local evidence/artifacts only.
2. `readonly-source-backed-evidence-synthesis`: worker reads a parent-curated evidence packet with URLs/citations plus local artifacts.
3. `readonly-web-research-with-citations`: future worker can gather evidence through a curated research tool with allowlists, citations/permalinks, and fail-closed missing-source behavior.

Only rungs 1 and 2 have evidence today for `openai-codex/gpt-5.3-codex-spark`. Rung 3 remains unliberated.

## Desired suite modes

| Mode | Purpose | Dispatch | Parallelism | Promotion |
| --- | --- | --- | --- | --- |
| `report-only-suite` | Build suite manifest, budget, and expected validations. | none | none | none |
| `serial-suite` | Execute N envelopes under one exact suite confirmation and one max budget. | exact-confirmed | 1 at a time | per-envelope after parent validation |
| `bounded-batch-suite` | Execute independent read-only envelopes concurrently. | exact-confirmed | capped, e.g. 2-4 | per-envelope after fan-in validation |
| `swarm-rehearsal-suite` | Rehearse coordinated workers on a larger goal after enough envelope evidence. | exact-confirmed | capped + abortable | no automatic broad promotion |

## Suite manifest contract

A suite manifest should be a first-class artifact, not hand-assembled prompts:

```json
{
  "suiteId": "codex-spark-p0-readiness-2026-05",
  "providerModelRef": "openai-codex/gpt-5.3-codex-spark",
  "maxCalls": 6,
  "maxEstimatedCostUsd": 1.5,
  "timeoutMsPerRun": 45000,
  "parallelism": 1,
  "envelopes": [
    "readonly-three-file-risk-table",
    "readonly-two-file-bounded-patch-recommendation",
    "readonly-web-research-tool-contract-review"
  ],
  "stopOn": [
    "auth",
    "quota",
    "rate-limit",
    "timeout",
    "empty-output",
    "unexpected-touched-file",
    "contract-failure"
  ]
}
```

## Runner gates

- One explicit suite confirmation phrase names the suite id, provider/model, max calls, max cost, timeout, and parallelism.
- Each envelope still has a declared file/tool/output contract.
- Mutation envelopes are excluded from batch mode until separate evidence supports them.
- Protected scopes remain blocked unless explicitly authorized for that suite.
- Parent validation runs after every worker and again at fan-in.
- Promotion is per `(provider, model, envelope)`, never whole-suite blanket trust.

## Current implementation gap

The live `agent_run_sdk_provider_model_arena_packet` is still a report-only packet for the original small envelope registry. It blocked a preview containing newer envelopes with `unknown-envelope`, which is useful evidence: the arena code needs an envelope registry/suite manifest layer before it can support the broader capability ladder.

## Next local-safe implementation slices

1. Extend the arena envelope registry to include the generic envelopes already evidenced in docs.
2. Add a report-only suite manifest packet that can select multiple envelopes and emit exact per-run specs plus fan-in validation checks.
3. Add a dry-run scorecard/fan-in artifact format.
4. Only after those pass local smokes, add an exact-confirmed serial-suite dispatcher.
5. Only after serial-suite evidence, consider bounded read-only batch-suite execution.

## Non-goals before P0

- No autonomous web research tool in workers until its contract canary passes.
- No protected CI/publish/package-manager mutation.
- No multi-file mutation.
- No unbounded retry loops.
- No default-provider/routing/settings change.
