# Development velocity pressure

P0 operational primitive for detecting when the control plane itself is slowing development enough to threaten safety, quality, or operator trust.

## Problem

A long-running session can keep all guardrails technically green while practical development velocity collapses. The failure mode is not only context-window exhaustion. It can come from accumulated runtime state, broad tool surfaces, huge board reads, excessive ceremony per slice, disk/memory pressure, or stale handoff loops.

When this happens, continuing to push through is unsafe: the operator becomes blind to whether the system is helping or consuming attention.

## Signals

Track these signals before and during development slices:

- `contextPercent`: context-window usage.
- `handoffAgeSec`: age of the last useful handoff/checkpoint.
- `dirtyFileCount`: current git dirty file count.
- `minutesSinceUsefulCommit`: time since the last small validated commit.
- `toolCallsPerUsefulCommit`: approximate number of tool calls since the last useful commit.
- `slowToolCount`: tool calls taking longer than the local threshold.
- `boardReadCount`: board/query reads in the current slice.
- `memoryUsedPct`: host memory pressure.
- `diskUsedPct`: host disk pressure.
- `activePiProcessAge`: age of the current pi runtime process.
- `danglingProcessCount`: known worker/colony/background processes not owned by the current slice.

## Recommendation levels

- `continue`: focused slice is moving, low dirty count, recent commit/checkpoint, machine ok.
- `checkpoint-and-commit`: useful change exists; finish validation, commit or revert before more planning.
- `reduce-governance-surface`: too many board/tool calls per useful change; switch to focal files/tests and defer nonessential evidence.
- `compact`: context or handoff pressure is high, but runtime is otherwise healthy.
- `new-session`: runtime/session is long or slow even with moderate context; write minimal handoff and restart pi/session.
- `block-and-clean`: disk/memory/process pressure risks false failures or data loss; stop development and clean/kill only with explicit safe plan.

## Policy when pressure is high

When velocity pressure is `checkpoint-and-commit` or worse:

1. Stop starting new feature work.
2. Inspect only the current dirty scope.
3. Run the smallest relevant validation gate.
4. Commit, revert, or stash the current slice.
5. Write a short handoff containing only:
   - focus task;
   - current dirty/commit state;
   - validation already run;
   - exact next command/action;
   - blockers.
6. Prefer a new clean session over forcing the old one.

## Anti-patterns

- Treating context percentage as the only performance signal.
- Reading the full board repeatedly to compensate for uncertainty.
- Continuing to add guardrails while the guardrails are the bottleneck.
- Leaving partial dirty state open while investigating unrelated performance concerns.
- Assuming worker/colony dangling without checking process ownership.

## First implementation target

A report-only `development_velocity_pressure`/`velocity_pressure_status` primitive should compose existing signals first:

- `context_watch_status`;
- `git_dirty_snapshot`;
- `machine_maintenance_status`;
- scheduler/colony status;
- bounded Node/pi process age/count;
- optional counters from session analytics.

It must never kill processes, compact, reload, dispatch workers, or mutate settings. It only recommends the next operator-safe mode.
