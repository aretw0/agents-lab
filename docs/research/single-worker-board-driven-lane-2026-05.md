# Single-worker board-driven lane — 2026-05

Marker: `single-worker-board-driven-lane`

## Objective

Increase subagent/worker usage by turning real board demand into bounded single-worker packets. The control plane stays minimal: select, packetize, require exact confirmation, follow, validate, checkpoint, and commit. Workers execute one declared task at a time.

## Agent-ready checklist

A board task is agent-ready only when it has:

- **Files:** exact declared files; no broad repository scope.
- **Acceptance criteria:** observable pass/fail criteria, preferably with markers or focal tests.
- **Validation:** parent-side gate known before dispatch, such as `safe_marker_check`, a focal test, or `git diff --check`.
- **Rollback:** non-destructive rollback for every declared file.
- **Protected-scope gate:** no CI, publish, settings, credentials, remote/offload, destructive maintenance, or `.obsidian` unless explicitly authorized as a separate protected task.
- **Suggested profile:** `read-only-review`, `small-mutation`, or `test-fix`.
- **Stop condition:** exactly one worker run, then parent-side outcome packet before board completion.

## Current operating mode

We are ready to use workers more often, but only in the single-worker lane:

- allowed: frequent single-worker packets for local-safe board tasks;
- allowed: read-only reviews and small mutations with exact runId confirmation;
- required: non-empty output, declared-file discipline, parent validation, and outcome packet;
- blocked: automatic multi-worker, background/colony promotion, or generic dispatch from “prossiga”.

## Learning loop

Each run should classify the result:

- process passed and contract passed;
- process passed but contract failed;
- empty output;
- unexpected dirty state;
- touched files outside declared scope;
- missing validation marker;
- timeout or abort.

The lane should prefer learning from small real tasks over synthetic demos. After several successful single-worker runs, record a maturity decision before considering any broader delegation design.

## Board candidate snapshot for TASK-BUD-1031 retry

Source: deterministic control-plane extraction from planned board tasks, filtered to local-readable candidates and provided so the worker can do the judgment step without loading the full board file.

Candidate pool:

- `TASK-BUD-946` — P3 backlog; files: `packages/pi-stack/extensions`, `docs/research/control-plane-signal-integrity-audit-2026-05.md`; goal: investigate duplicated `edit oldText must match` warnings; likely profile: `read-only-review` first.
- `TASK-BUD-947` — P3 backlog; files: `packages/pi-stack/extensions`, `packages/pi-stack/test/smoke`, `docs/research/control-plane-signal-integrity-audit-2026-05.md`; goal: monitor no-op/near-no-op edits; likely profile: `read-only-review` first, possible later `small-mutation` if a narrow fixture is chosen.
- `TASK-BUD-1006` — P2 UI/docs ambiguity; files: quota footer docs/runtime surfaces; goal: revisit compact quota footer ambiguity; likely profile: `read-only-review`; note: UI tangent was parked, so only select if the worker judges it better than operator-noise tasks.
- `TASK-BUD-1032` — lane follow-up; files: board and lane doc; goal: run one real read-only worker; likely profile: `read-only-review`; depends on `TASK-BUD-1031`, so classify as successor rather than candidate to execute immediately.
- `TASK-BUD-1033` — lane follow-up; files: lane doc; goal: run one real small-mutation/test-fix worker; likely profile: `small-mutation` after `TASK-BUD-1032`.

Worker retry instruction: select exactly 3 candidates, and for each return task id, suggested profile, declared files, validation, rollback, protected-scope verdict, and why it teaches the lane something.
