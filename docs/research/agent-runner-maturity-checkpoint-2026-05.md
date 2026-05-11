# Agent runner maturity checkpoint — 2026-05

## Status

The first-party single-runner lane now has two different maturity levels:

- **SDK/in-process, narrow read-only diagnostics**: live-validated and usable after exact per-run confirmation when scope is small, declared, read-only, and output-contracted.
- **Subprocess `pi --print` runner**: still blocked for blind retry by `runner-timeout`; continue only through report-only structured startup/provider probe design until root-cause evidence improves.

The lane is past the first read-only canary:

- exact-confirmed dispatch gate works for one explicit `runId`;
- the Windows `spawn pi ENOENT` crash path was reproduced and hardened;
- `agent_run_follow` provides a bounded native follow/finalizer path, replacing manual sleep/polling;
- `agent_run_outcome_packet` separates process state from contract result;
- read-only outcomes fail closed when any touched file is reported;
- registry/status/outcome can carry final evidence: `exitCode`, `outputBytes`, `errorCode`, and `errorMessage`;
- SDK read-only smoke `task-bud-1066-sdk-readonly-final-output-smoke` completed with one declared file, one `read` call, no touched files, and a final `PASS` output.

## Evidence

Key completed slices:

- `TASK-BUD-1018`: first exact-confirmed read-only runner canary completed after retry.
- `TASK-BUD-1019`: spawn error handling prevents parent-session crash on subprocess start failure.
- `TASK-BUD-1020`: bounded read-only `agent_run_follow` surface added.
- `TASK-BUD-1022`: read-only contract fails on any touched file.
- `TASK-BUD-1024`: runner final evidence is recorded in registry/status/outcome paths.
- `TASK-BUD-1025`: post-reload live canary validated final evidence fields without dispatch.
- `TASK-BUD-1066`: subprocess preflight canary produced a startup timeout (`runner-timeout`, `exitCode=124`, `timedOut=yes`, zero stdout/stderr). The classifier now preserves this separately from generic `silent-runner-failure` and the startup diagnostic packet asks for timeout/signal/timedOut evidence before any retry.
- `TASK-BUD-1066`: SDK attempts learned the safe envelope: unsupported `find/ls` tools now block before dispatch; broad read-only scope can still loop/bloat; narrow read-only scope with one file and one `read` call completed successfully.

## Current contract

The lane now has distinct checkpoints:

1. **Dispatch authorization** — exact human phrase for one `runId` only.
2. **Process state** — registry/status/follow report running vs terminal states.
3. **Contract state** — outcome packet checks output, touched files, markers, and file contract.
4. **Board decision** — task completion remains parent-side and evidence-gated.
5. **Commit** — control plane commits bounded board/code/doc changes after validation.

## Still blocked

- No worker/provider dispatch without the exact `humanConfirmationPhrase` for the chosen `runId`.
- No multi-worker, background swarm, or colony promotion from this evidence alone.
- No protected scope in runner tasks without explicit separate authorization.
- Mutation runners require declared files, rollback, validation, follow, and outcome evidence.
- Broad SDK diagnostic tasks are not mature yet; prefer one or two declared files and an explicit final-output shape.

## Operational maturity posture

Single-worker delegation is no longer a novelty path here. It is a normal controlled operating mode when all of these are true:

- the worker receives a bounded derived packet instead of raw structured state;
- the run is single-worker and tied to one explicit `runId`;
- the operator gives the exact confirmation phrase for that `runId`;
- `agent_run_follow` reaches a terminal state;
- `agent_run_outcome_packet` passes the declared file contract;
- parent-side validation and board completion stay evidence-gated.

Use this mode more often for local-safe board work. Keep experimenting only where evidence is still missing: new profiles, new tool surfaces, protected scopes, multi-worker/background/colony behavior, or failure modes without regression coverage. Once a path has tests plus live pass evidence, future sessions should respect that maturity and avoid re-running calibration exercises just because the context was compacted.

Humility still applies: maturity is scoped, not universal. Current evidence supports frequent bounded single-worker use; it does not by itself promote multi-worker, background, colony, protected-scope, or unattended dispatch.

## SDK in-process maturity ladder

Do not forget the sequence already tried:

1. `find/ls` in the SDK declared-file policy failed safely and now blocks before dispatch.
2. Broad read-only diagnostics with many declared files reached useful evidence but looped/bloated output.
3. Narrow read-only diagnostics with one declared file and one `read` call completed and passed.

Use this ladder to unlock more work gradually:

- **Ready now**: one declared file, `read` only, explicit one-answer output shape, exact confirmation, follow/outcome validation.
- **Next rung**: one or two declared files, `read/grep`, strict output shape, small timeout, exact confirmation.
- **Not ready yet**: broad read-only analysis, mutation, multi-worker, protected scope, or unattended provider dispatch.

When preparing a worker, prefer the next smallest rung that can answer the question. If the worker loops, bloats output, or reads old logs as fresh evidence, harden the packet/runner before expanding scope.

## Continuous improvement lane contract

Use existing milestone semantics instead of inventing another public surface:

- Milestone: `agent-first-worker-lane` for SDK/subprocess runner maturation.
- Active board anchors: `TASK-BUD-1068` for dual-executor maturity and `TASK-BUD-1066` for subprocess timeout root cause.
- Local-safe continuation is allowed without another human nudge when the next slice is one of: documentation, board evidence, regression test, classifier/packet hardening, handoff checkpoint, or report-only preview.
- Stop and ask only for: worker/provider dispatch, protected scope, destructive state change, publish/CI/settings/credential changes, or task closure when decision packets ask a human to close/keep/defer.
- At turn boundaries, use OODA only as an internal quality filter: observe current evidence, orient against the lane contract, decide the next smallest validated slice, act with tests/checkpoint. Do not create a new `ooda_*` packet or term unless a real reuse gap appears.

### What made the assistant stop

The stop was not lack of work; it was an authorization boundary. The prior slices changed runtime code, so live trust required `/reload`, and each worker approval was single-run only. After each exact-approved run finished, the control plane could keep doing local-safe hardening, but it could not legally dispatch the next worker or retry subprocess without a fresh exact phrase. The missing declaration was not a new concept; it was a compact lane rule saying: continue local-safe improvement under `agent-first-worker-lane`, auto-prepare the next packet/preview, but never auto-dispatch providers.

### How to need the operator less

This lane can reduce operator interrupts by keeping a stocked queue of narrow, validated previews and by making the final-turn brief carry the exact phrase when a worker is the next useful step. It still needs the operator for provider dispatch under current governance. Removing that need would require a separate, explicit policy/tooling change: a bounded auto-dispatch contract with budget caps, cooldown, run count, declared-file scope, abort/follow/outcome gates, and rollback evidence. Until that exists and is validated, exact per-run confirmation remains the safety boundary.

## Recommended next step

For the current `TASK-BUD-1066` subprocess blocker, do **not** retry the worker blindly. The next local-safe step is the existing startup diagnostic packet's `startupProbePlan`: a report-only structured startup/provider probe plan that captures startup phases, stderr preservation, timeout budget, termination signal, elapsed time, and provider bootstrap evidence without a model call where possible. Each startup probe step is advisory only and keeps `modelCallAllowed=false` and `dispatchAllowed=false`.

Run one more single-worker canary only after preparing a small mutation target with:

- one or two declared files;
- explicit non-destructive rollback;
- focal validation command or marker check;
- `agent_run_follow` as the finalizer;
- `agent_run_outcome_packet` using registry `outputBytes` fallback;
- parent-side board completion only after process and contract both pass.

This is the next safe rung before considering broader worker autonomy.

## Small-mutation canary target

small-mutation-runner-canary-target
