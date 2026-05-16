# Control-plane-first worker primitives — 2026-05

## Steering

Worker evolution must be **control-plane-first**. New worker/batch/colony capabilities should compose the same primitives used by the control plane instead of creating a second parallel orchestration stack.

The goal is sustainable experimentation: increase throughput and trust while keeping state, budget, lifecycle, logs, aborts, outcomes, and verification observable from one shared foundation.

## Existing primitives to reuse

| Capability | Existing primitive/files | Reuse rule for worker evolution |
| --- | --- | --- |
| Board focus and verification | `.project/tasks.json`, `.project/verification.json`, `project-board-*` | Workers should start from board-scoped tasks/slices and write aggregate evidence back through board/verification surfaces. |
| Provider/model budget evidence | `guardrails-core-provider-budget-evidence.ts` | Batch runners must reuse provider/model budget decisions; no separate budget gate. |
| Declared-file tool scope | `guardrails-core-tool-policy.ts` | All read-only/mutation workers must use declared-file scoped tools; batch workers cannot bypass this. |
| Single SDK worker runtime | `startSdkInProcessWorker` in `guardrails-core-agent-run-surface-runtime.ts` | First batch runner should orchestrate this existing runtime per worker, not implement another SDK loop. |
| Registry | `AgentRunRegistryEntry`, `readRegistryEntry`, `writeRegistryEntry`, `.pi/reports/agent-runs.json` | Batch runs should register each worker as normal runs plus a small batch aggregate record/manifest if needed. |
| Logs and tails | `.pi/reports/<runId>.sdk.log`, `readLogTail`, `readLogByteCount` | Batch status should use existing per-worker logs; fan-in may summarize but not replace logs. |
| Abort/stop | `buildAgentRunAbortPlan`, SDK abort logic, `stopSource` fields | Batch abort should target registered worker run ids and preserve stopSource. |
| Outcome | `buildAgentRunOutcomePacket` | Fan-in must derive worker contract decisions through the same outcome packet semantics. |
| Batch outcome | `buildAgentRunBatchOutcomePacket` | Aggregate fan-in should reuse this packet and only add missing runtime glue. |
| Read-only batch contract | `buildAgentRunSdkReadOnlyBatchPacket` | This remains the planning gate for first fan-out; execution should require this packet to be ready. |
| Background/process maturity | `background_process_*` primitives | Long-lived services or shared ports for workers must go through background-process readiness, not hidden worker logic. |
| Lane queue/runtime health | `guardrails-core-lane-queue*` | Future colony/autonomous scheduling should compose lane queue/runtime health, not ad-hoc worker loops. |
| Arena evidence | `guardrails-core-agent-run-sdk-arena*` | Arena promotes `(provider, model, envelope)` capabilities; promoted lanes should consume evidence instead of rerunning serial canaries. |

## Batch runner design rule

The first exact-confirmed Codex Spark read-only batch runner should be a thin control-plane composition:

1. Accept or derive a `buildAgentRunSdkReadOnlyBatchPacket` result.
2. Fail closed unless the packet is `ready-for-human-decision`.
3. Require exact batch confirmation.
4. Start each worker through `startSdkInProcessWorker`.
5. Reuse the normal registry/log/status/follow/abort surfaces per worker.
6. Fan-in using `buildAgentRunOutcomePacket` per worker and `buildAgentRunBatchOutcomePacket` for aggregate decision.
7. Append board verification only after aggregate pass/partial/fail is explicit.

## Do not duplicate

Do not create worker-specific alternatives for:

- provider budget policy;
- declared file scope policy;
- registry storage;
- log tail/follow;
- abort/stop semantics;
- outcome packet semantics;
- board verification linkage;
- lane queue/autonomous scheduling.

If a worker feature needs a new concept, first ask whether it belongs as a generic control-plane primitive that workers, local loops, and future colony flows can all reuse.

## Near-term runway

1. **Read-only batch runner**: exact-confirmed, Codex Spark promoted envelopes, max 2–5, no mutation.
2. **Fan-in evidence**: aggregate outcome/verification with per-worker run ids and cache-hit/cache-miss.
3. **Controlled mutation batch design**: one-file independent targets only, parent validation, rollback per target.
4. **Lane queue integration**: batch work becomes a queue item with runtime health and stop conditions.
5. **Colony-style effect**: only after shared primitives can observe and stop the whole group without losing per-worker evidence.
