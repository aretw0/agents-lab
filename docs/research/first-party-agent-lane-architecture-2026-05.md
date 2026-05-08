# First-party agent lane architecture — 2026-05

## Decision

We can trust bounded single-worker agents enough to keep using them, but the next maturity step is to stop invoking them manually. The first-party lane should make agents a governed execution substrate of the control plane:

`board task → typed invocation spec → budget/model route → run registry → bounded dispatch → log/status/abort → parent-side outcome → verification/board/handoff → control-plane commit`.

This is not a promotion to background colonies, unattended parallelism, or scheduler-owned dispatch. Those remain separate lanes.

## Evidence from local canaries

| Run | Provider/model | Contract | Result |
| --- | --- | --- | --- |
| `task-bud-1001-small-mutation-doc-canary` | `dashscope/qwen3-coder-plus` | docs mutation, one declared file, critical economy | pass |
| `task-bud-1007-second-tiny-agent-canary` | `dashscope/qwen3-coder-plus` | docs mutation, one declared file, critical economy | pass |
| `task-bud-1008-codex-spark-model-budget-route` | `openai-codex/gpt-5.3-codex-spark` | small code mutation, three declared files, critical economy | pass |

Interpretation: single-worker, declared-file, parent-validated agents are ready for repeated use. Multi-worker/background remains unproven.

## Influence classification

### Subagent / agent-execution influences

These directly inform the first-party agent substrate.

| Source | Relevant pattern | Assimilate as | Do not copy blindly |
| --- | --- | --- | --- |
| `@davidorex/pi-jit-agents` | named agents with typed input/output contracts, template compilation, project context injection, phantom-tool structured output, `agentContract` introspection | typed `AgentInvocationSpec`, schema/output contract, introspection before dispatch | in-process dispatch as the only runtime; our provider-native CLI runner still needs log/status/abort first |
| `@davidorex/pi-workflows` | schema-governed DAG, agent steps as subordinate subprocesses, typed JSON between steps, checkpoint/resume | typed step outputs, project-state input, workflow later as orchestration layer | hiding low-level runner status/log/outcome before one-worker contract is first-party |
| `task-worker.agent.yaml` | declared task, acceptance criteria, scoped files, JSON `execution-results` | task-to-agent packetizer from board fields | broad tool set by default; use declared-file/economy gates first |
| OpenAI Symphony | orchestrator is authority, preflight before dispatch, item/workspace isolation, workpad criteria | owner-of-dispatch, fresh gates, deterministic workspace/worktree option | remote scheduler/Linear/Codex unattended posture |
| Internal canaries | non-empty output, declared-file-only diff, outcome packet, commit by control plane | required pass gates for every mutation worker | auto-retry or chained workers |

### Generic process / background influences

These are useful, but they are not sufficient to define the subagent lane.

| Source | Useful pattern | Applies to | Boundary |
| --- | --- | --- | --- |
| `@ifi/oh-pi-ant-colony` | background non-blocking run, stable IDs, status bar, progress signals, bounded logs, abort controller, worktree workspace | future multi-agent/background lane | not the first-party one-worker runner; colonies require separate promotion gate |
| Background-process readiness primitives | process registry, port lease, healthcheck, graceful stop, bounded log tail | servers/workers/long-lived processes | not equivalent to LLM agent output contracts |
| Context-watch/reload surfaces | checkpoint freshness, reload fail-closed, stop condition detection | agent resume/recovery safety | not authorization to auto-dispatch after compact |
| Worktree primitive | isolated workspace, cleanup, rollback | optional later agent isolation | first single-worker can still use current tree with declared files and clean state |

## What is still missing

### P0 — First-party runner contract

A first-party runner should replace handcrafted `pi --print ... @files ...` calls.

Required fields:

- `runId`, `taskId`, `providerModelRef`, `cwd`, `sessionIsolation`, `extensionIsolation`;
- exact `declaredFiles` and file contract (`read-only` or `mutation`);
- `economyMode`, `maxOutputLines`, token/budget evidence;
- exact tool allowlist;
- timeout, log path, abort handle;
- validation gates and rollback cues;
- expected output schema or non-empty text contract.

### P1 — Board-to-agent packetizer

The control plane should derive packets from `.project/tasks.json` instead of hand-composing prompts:

1. read one eligible task;
2. reject protected scope unless explicitly authorized;
3. require files/acceptance criteria;
4. choose provider/model with scoped budget evidence (`openai-codex/gpt-5.3-codex-spark` can differ from aggregate `openai-codex`);
5. generate the human confirmation phrase;
6. write planned registry entry.

### P1 — Outcome and verification bridge

After dispatch, parent-side validation remains authoritative:

- process state: completed/failed/timed-out/aborted;
- contract decision: pass/fail independent of exit code;
- output bytes > 0;
- touched files subset of declared files;
- marker/test results;
- board verification entry;
- handoff checkpoint;
- commit by control plane only.

### P1 — Status/log/abort as operator surfaces

Before larger scope, expose first-party status that is not just registry JSON:

- `agent_run_status` summary with provider/model, elapsed, state, declared files;
- bounded log tail;
- human-confirmed abort for registered PID only;
- compact progress message suitable for TUI/web.

### P2 — Typed specs and reusable agent roles

Once runner mechanics are stable, add reusable specs:

- `task-mutator` — small declared-file mutation;
- `task-reviewer` — read-only review with structured findings;
- `task-verifier` — parent-side validation suggestion only;
- `quota-route-advisor` — budget/model recommendation packet.

Specs should have JSON schemas and an introspection surface before dispatch.

### P2 — Workflow integration after runner maturity

`pi-workflows` patterns are valuable after the runner is first-party:

- typed DAG for multi-step task execution;
- checkpoint/resume;
- schema output between steps.

But workflow execution should call the same first-party runner contract, not bypass it.

### P3 — Multi-agent / colony / background

Only after several one-worker code mutations pass:

- one worker at a time → small code worker → reviewer worker → two sequential workers → parallel workers;
- background/colony only with process lifecycle gates, isolated worktree, budget caps, abort, and promotion decision.

## Promotion gates

| Level | Allowed | Required evidence | Blockers |
| --- | --- | --- | --- |
| L0 | manual packet, one worker | already achieved with three canaries | none for bounded use |
| L1 | first-party single-runner surface | typed packet, registry, status/log/abort, outcome tests | missing runner implementation |
| L2 | board-to-agent packetizer | derives from task fields, scoped budget, human confirmation phrase | protected scope, missing files/criteria |
| L3 | reusable agent specs | JSON output schemas, introspection, focal tests | unstructured output, broad tools |
| L4 | workflow/sequential agents | checkpointed DAG using first-party runner | hidden subprocess state |
| L5 | parallel/background/colony | worktree isolation, lifecycle/readiness, cost caps, abort, stop-source coverage | current background gates not green |

## Next implementation slice

Create a first-party `agent_run_task_packet` / `agent_task_invocation_packet` surface:

- input: `task_id`, optional `purpose`, optional `provider_model_ref`;
- reads the task from board;
- validates files, criteria, scope, budget evidence, economy;
- returns a typed invocation spec, exact confirmation phrase, validation/rollback checklist;
- writes nothing and dispatches nothing unless a separate registry upsert is explicitly requested.

Validation should be a smoke test with fixture tasks: ready mutation task, missing files, protected scope, aggregate Codex blocked but Spark scoped budget usable.
