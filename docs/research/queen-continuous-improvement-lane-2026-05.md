# Queen continuous-improvement lane — 2026-05

Marker: `queen-continuous-improvement-lane`

## Purpose

Converge the recent operator/control-plane discussion into one focused backlog lane. The goal is to make the `agents-lab` queen profile operational: continuous improvement with proactive local-safe resource use, short operator interviews only when context or authorization is missing, and graceful stop conditions.

This is not a new executor. It composes existing contracts:

- `project_intake_plan` / first hatch;
- `structured_interview_plan` for missing operator context;
- `nudge_free_loop_canary` and `unattended_continuation_plan`;
- `context_watch_checkpoint` and context stop conditions;
- board surfaces for tasks, evidence and completion;
- provider/quota/machine readiness gates;
- `agent_run_task_*`, `agent_run_follow`, and `agent_run_outcome_packet` when workers are useful.

## Queen profile for agents-lab

The current `agents-lab` profile is **assisted continuous improvement**:

- prefer useful local-safe progress over passive waiting;
- reveal available capabilities and recommend the highest-ROI path;
- use mature resources, workers and provider quota economically but proactively;
- keep a scientist-style self-critique loop: observe failures, record evidence, harden contracts, then continue;
- commit/checkpoint/validate as sane development defaults;
- ask the operator only for missing context, protected scope, real ambiguity, broader authorization, reload or other operational intervention;
- stop gracefully on reload/compact/host pressure/budget block/outcome failure/dirty drift.

This does **not** mean unassisted or blind automation. It means reducing micro-authorization while keeping the operator available for real interventions. If reload can be delayed safely, continue; if compact/reload becomes inevitable, checkpoint and ask for reload before auto-resume gets stuck behind a stale runtime.

## Hard intent backlog

Code/runtime/tooling work that should eventually be implemented with tests:

1. `TASK-BUD-1047` — first-hatch intake packet/tool for new workspaces, sandbox discovery and empty-folder interview.
2. `TASK-BUD-1048` — queen profile discovery packet, report-only and interview-backed.
3. `TASK-BUD-1049` — minimal operator manifestation packet for local-safe batches.
4. `TASK-BUD-1050` — capability ROI/discoverability packet for tools, workers and other available resources.
5. `TASK-BUD-1051` — dry-run bridge from batch authorization to worker dispatch gates without bypassing lower contracts.
6. `TASK-BUD-1052` — bounded local-safe loop canary: select, execute/packetize, validate, commit, checkpoint and re-check stop conditions.
7. `TASK-BUD-1056` — reload-before-compact packet/gate for graceful checkpoint and operator reload request when runtime freshness would otherwise block continuation.

## Soft intent backlog

Skills, prompts, docs and research that make the behavior discoverable and reusable:

1. `TASK-BUD-1053` — lightweight queen/continuity skill.
2. `TASK-BUD-1054` — hatch/queen prompt template for short operator manifestation.
3. `TASK-BUD-1055` — prior-art research across pi ecosystem, Claude Code and similar tools.
4. `TASK-BUD-1057` — document assisted/self-critical queen loop semantics in docs/skill form.

## Maturity order

Do not jump straight to open-ended automation. Mature in this order:

1. document/profile and backlog the lane;
2. report-only packets;
3. dry-run previews;
4. one local-safe canary slice;
5. several clean slices with commits and checkpoints;
6. only then consider broader batch dispatch, still without protected scope unless explicitly authorized.

## Non-goals for this lane

- no protected scope by default;
- no CI/publish/settings/credentials by default;
- no remote/offload by default;
- no scheduler or persistent unattended service by default;
- no multi-worker/swarm/colony promotion without separate evidence gates;
- no bypass of `agent_run_task_dispatch` or outcome contracts.

## Next best slice

Start with `TASK-BUD-1047` or `TASK-BUD-1048` because they make future installations and future sessions better at discovering context before asking the operator to repeat themselves.
