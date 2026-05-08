# TASK-BUD-1032 read-only worker packet — 2026-05

Marker: `task-bud-1032-readonly-worker-packet`

## Purpose

Run one real single-worker `read-only-review` slice using a bounded derived packet instead of raw structured state. The worker should help decide the next safe action for the selected real board candidate.

## Global structured-state rule

Do not read raw structured state files such as `.project/tasks.json`, `.project/verification.json`, `.project/issues.json`, `.project/handoff.json`, or `.pi/reports/agent-runs.json`. Use the facts in this packet and report any missing information as a blocker.

## Selected candidate

Selected from the TASK-BUD-1031 worker candidate list:

- Task id: `TASK-BUD-946`
- Suggested profile: `read-only-review`
- Priority/milestone: `p3`, `operator-noise-backlog`
- Description: investigate duplicate warnings for failed `edit` tool calls when `oldText` does not match, reducing operator noise without hiding the real error.
- Candidate files from board snapshot: `packages/pi-stack/extensions`, `docs/research/control-plane-signal-integrity-audit-2026-05.md`

## Acceptance criteria from candidate

- Reproduce or collect evidence of a duplicated `edit oldText must match` failure appearing twice in UI/log output.
- Determine whether duplication likely comes from tool-output wrapper, TUI rendering, monitor/summary, or explicit retry.
- Propose a report-only correction or regression test that preserves the error once without suppressing real failures.

## Worker task

Return a concise read-only review with:

1. `decision`: `ready-for-small-mutation`, `needs-narrowing`, or `defer`.
2. Recommended exact declared files for the next worker slice, avoiding broad directory scope if possible.
3. Parent-side validation gate for the next slice.
4. Non-destructive rollback cue.
5. Risks/blockers.
6. What this teaches the single-worker lane.

Do not modify files. Do not dispatch other workers. Keep output under 20 lines.
