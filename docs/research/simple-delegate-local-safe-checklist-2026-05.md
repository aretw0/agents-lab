# Simple-delegate local-safe checklist — 2026-05

Status: Candidate D materialized as a report-only checklist. This document does not authorize agent dispatch.

## Intent taxonomy

- Text, docs, guides, skills, prompts, handoffs, and final-turn messages are **soft intent** or operational evidence. They can steer behavior, but they do not enforce behavior deterministically.
- **Hard intent** requires deterministic code, tool/runtime gates, schemas, tests, or blockers that make unsafe behavior impossible or fail-closed.
- This checklist is therefore not hard intent by itself. It is a pre-dispatch evidence packet that a deterministic gate or human reviewer can consume.

## Required pre-dispatch checklist

Before any simple-delegate canary starts, all items must be true:

- [ ] **one agent**: exactly one worker agent is requested.
- [ ] **one task**: exactly one board task is named and active.
- [ ] **one slice**: the worker goal says to stop after one bounded slice.
- [ ] **declared files**: every allowed touched file is listed before dispatch.
- [ ] **local-safe scope**: no provider/settings, CI/GitHub Actions, publish, remote/offload, scheduler, destructive maintenance, credentials, or protected parked work.
- [ ] **timeout**: timeout is explicit and bounded.
- [ ] **budget**: provider/cost budget is explicit and bounded.
- [ ] **cwd isolation**: cwd/worktree isolation is known.
- [ ] **rollback**: rollback is non-destructive and names the exact restore/discard path.
- [ ] **validation**: focal validation command or marker check is known before dispatch.
- [ ] **review owner**: control plane remains responsible for review, validation, and integration.
- [ ] **authorization**: operator explicitly approves this one canary after seeing the packet.

## Minimal canary packet shape

```text
candidateTask: <TASK-ID>
workerGoal: <one-slice instruction>
allowedFiles:
  - <path>
validation:
  - <command or marker check>
rollback:
  - <non-destructive rollback>
timeoutMs: <bounded timeout>
budget: <bounded provider/cost budget>
stopContract: stop after one slice and return diff/evidence only
authorization: requires explicit human approval; no auto-dispatch
```

## Reject conditions

Reject or defer the canary when any item is true:

- more than one task is bundled;
- files are undeclared or include protected scope;
- validation is unknown;
- rollback is destructive or vague;
- timeout/budget are missing;
- worker goal asks for exploration, repetition, scheduler, remote/offload, or broad refactor;
- any deterministic readiness packet returns blocked;
- the operator has not explicitly approved dispatch.

## First recommended use

Use this checklist to prepare a doc-only simple-delegate canary. A good first canary should ask a worker to create a small quality rubric or fixture under `docs/research`, then stop. The control plane should review the patch and record calibration metrics before considering a second canary.

## Calibration metrics after the canary

Record after the worker stops:

- accepted or rejected;
- declared files vs touched files;
- validation pass/fail;
- rollback needed yes/no;
- instruction-following deviations;
- review burden in minutes or qualitative low/medium/high;
- any attempted protected-scope broadening.
