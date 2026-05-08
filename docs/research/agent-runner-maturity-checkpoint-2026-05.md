# Agent runner maturity checkpoint — 2026-05

## Status

The first-party single-runner lane is now past the first read-only canary:

- exact-confirmed dispatch gate works for one explicit `runId`;
- the Windows `spawn pi ENOENT` crash path was reproduced and hardened;
- `agent_run_follow` provides a bounded native follow/finalizer path, replacing manual sleep/polling;
- `agent_run_outcome_packet` separates process state from contract result;
- read-only outcomes fail closed when any touched file is reported;
- registry/status/outcome can carry final evidence: `exitCode`, `outputBytes`, `errorCode`, and `errorMessage`.

## Evidence

Key completed slices:

- `TASK-BUD-1018`: first exact-confirmed read-only runner canary completed after retry.
- `TASK-BUD-1019`: spawn error handling prevents parent-session crash on subprocess start failure.
- `TASK-BUD-1020`: bounded read-only `agent_run_follow` surface added.
- `TASK-BUD-1022`: read-only contract fails on any touched file.
- `TASK-BUD-1024`: runner final evidence is recorded in registry/status/outcome paths.
- `TASK-BUD-1025`: post-reload live canary validated final evidence fields without dispatch.

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

## Recommended next step

Run one more single-worker canary, but only after preparing a small mutation target with:

- one or two declared files;
- explicit non-destructive rollback;
- focal validation command or marker check;
- `agent_run_follow` as the finalizer;
- `agent_run_outcome_packet` using registry `outputBytes` fallback;
- parent-side board completion only after process and contract both pass.

This is the next safe rung before considering broader worker autonomy.
