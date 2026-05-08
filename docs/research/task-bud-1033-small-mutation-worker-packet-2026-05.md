# TASK-BUD-1033 small-mutation worker packet — 2026-05

Marker: `task-bud-1033-small-mutation-worker-packet`

## Purpose

Run one real single-worker `small-mutation` slice from the TASK-BUD-1032 read-only review, using a bounded derived packet and a single declared documentation target.

## Maturity posture

Single-worker delegation is normal controlled operation when the gates pass: derived packet, exact runId confirmation, terminal follow, outcome packet, parent validation, and evidence-gated board completion. This run should be treated as normal use of the lane, while still recording any new failure mode.

## Input evidence

Read-only worker run `task-bud-1032-readonly-task-bud-946-review` completed with `contract=pass`, `process=completed`, and no touched files. It recommended narrowing TASK-BUD-946 follow-up to:

- `packages/pi-stack/extensions/monitor-summary.ts`
- `packages/pi-stack/extensions/web-session-gateway.ts`

It inferred the likely duplicate-warning source as event fan-out/TUI rendering rather than explicit edit retry, but noted that exact attribution is not yet proven without a reproducible transcript or synthetic fixture.

## Declared mutation target

Modify only:

- `docs/research/control-plane-signal-integrity-audit-2026-05.md`

## Worker task

Add a concise section titled `## TASK-BUD-946 duplicate edit warning triage` that records:

- the read-only worker's narrowed hypothesis;
- the recommended next code/test scope;
- the remaining uncertainty/blocker;
- a validation idea for a future smoke fixture;
- marker `task-bud-946-duplicate-edit-warning-triage`.

Do not modify code. Do not read raw structured state files. Do not dispatch other workers. Keep output under 20 lines and report PASS/FAIL, files touched, validation evidence, and blockers.

## Parent validation

- `safe_marker_check` for `## TASK-BUD-946 duplicate edit warning triage` and `task-bud-946-duplicate-edit-warning-triage`.
- `git diff --check`.
- `agent_run_outcome_packet` with `file_contract=mutation` and touched file exactly `docs/research/control-plane-signal-integrity-audit-2026-05.md`.

## Rollback

`git restore docs/research/control-plane-signal-integrity-audit-2026-05.md`
