# Single-worker board-driven lane maturity decision — 2026-05

Marker: `single-worker-board-driven-lane-maturity-decision`

## Decision

Continue the single-worker board-driven lane as a normal controlled operating mode for local-safe work. Do not promote multi-worker, background, colony, protected-scope, or unattended dispatch yet.

## Evidence now available

- Exact-confirmed read-only worker review passed on `TASK-BUD-1032`.
- Exact-confirmed small-mutation worker passed on `TASK-BUD-1033` after parent-side contract hardening.
- `agent_run_follow` provides bounded finalization.
- `agent_run_outcome_packet` separates process success from contract success.
- Read-only contract remains strict: any touched file fails.
- Mutation contract now distinguishes read-only packet/input attachments from mutable target files via `mutation_target_files` / `mutationTargetFiles`.
- Regression coverage exists for the TASK-BUD-1033 packet-input plus mutation-target shape.

## What should happen more often

Use single workers for bounded board slices when the control plane can provide:

1. a derived packet instead of raw `.project/*` state;
2. exact declared attachment files and exact mutation target files when applicable;
3. a single `runId` and exact human confirmation phrase;
4. parent-side validation before completion;
5. `agent_run_follow` plus `agent_run_outcome_packet`;
6. a small commit after evidence passes.

This is not experimental anymore for the covered lane. Treat future runs as normal use unless they introduce a new profile, tool surface, scope class, provider behavior, or failure mode.

## What remains gated

- No generic dispatch from “prossiga”.
- No automatic repeat/scheduler behavior.
- No multi-worker/background/colony promotion without separate rehearsal gates.
- No protected scope without explicit authorization.
- Runtime extension changes still require reload before relying on newly changed live surfaces outside the current validation slice.

## Next rung

Prefer one more real board-driven single-worker task, but make it useful work rather than a synthetic demo:

- `read-only-review` for a narrow unknown if attribution is still weak;
- `small-mutation` only when target files, mutation targets, rollback, and validation are already explicit;
- `test-fix` only when the failing fixture is local and bounded.

Do not design broader orchestration until the lane has several clean normal-use runs with commits and no new contract gaps.
