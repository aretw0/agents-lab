# First simple-delegate canary decision packet — 2026-05

Status: decision packet only. This document does not authorize dispatch.

## Proposed canary

- Candidate task: `TASK-BUD-958`
- Candidate lane: `agents-lab quality calibration lane`
- Worker output: `docs/research/0-8-agent-quality-review-rubric-2026-05.md`
- Worker kind: one simple worker agent
- Timeout: `120000` ms
- Budget: bounded canary budget; no unbounded provider spend
- Cwd/worktree: isolated cwd/worktree required before start
- Stop contract: stop after one slice and return diff/evidence only

## Worker goal draft

Create `docs/research/0-8-agent-quality-review-rubric-2026-05.md` as a concise review rubric for patches produced by simple worker agents in agents-lab.

The rubric must include sections or markers for:

- `scope`
- `validation`
- `rollback`
- `reject conditions`
- `acceptance threshold`
- `review burden`

Do not edit any other file. Do not touch runtime code, settings, providers, CI/GitHub Actions, remote/offload, scheduler, publish, credentials, or protected parked tasks. Stop after this one document slice.

## Allowed files

- `docs/research/0-8-agent-quality-review-rubric-2026-05.md`

## Validation

Run a marker check on the created document for:

- `scope`
- `validation`
- `rollback`
- `reject conditions`
- `acceptance threshold`
- `review burden`

Control plane validation after worker returns:

- `safe_marker_check` on the document
- `project-validate`
- `git diff --check`
- control-plane review of touched files versus allowed files

## Rollback

Non-destructive rollback:

```text
git restore -- docs/research/0-8-agent-quality-review-rubric-2026-05.md
```

If the file is newly created and untracked, delete only that file.

## Deterministic gate snapshot before dispatch

Current report-only evidence:

- `agent_spawn_readiness_gate`: ready for one simple spawn when timeout/cwd/budget/rollback/scope are declared.
- `simple_delegate_rehearsal_start_packet`: blocked/needs-evidence; current blocker is `rehearsal-not-ready`.
- `delegation_readiness_status_packet`: local-execute-first; collect bounded evidence before dispatch.
- `turn_boundary_decision_packet`: ask-human; authorization none.

Interpretation: this packet is not enough to dispatch. It prepares the human decision and the exact canary contract.

## Reject conditions

Do not start the canary if any condition is true:

- operator has not explicitly approved dispatch;
- more than one agent or more than one task is requested;
- allowed files are broadened;
- protected scope appears;
- validation or rollback becomes unknown;
- timeout/budget/cwd isolation are not explicitly bounded;
- any deterministic gate reports protected scope, risk, or authorization other than none/ask-human.

## Human decision needed

Question: authorize exactly one simple-delegate canary for `TASK-BUD-958` using the worker goal and allowed file above?

Options:

1. `approve one canary` — run exactly one simple worker slice under this packet.
2. `defer` — keep `TASK-BUD-958` planned and continue local execution only.
3. `revise packet` — adjust goal/files/validation before any dispatch.
