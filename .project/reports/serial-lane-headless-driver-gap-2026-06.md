# Serial lane headless driver gap (2026-06)

## Question

Why does the operator still need to copy prompts between Codex and Pi?

## Current state

The repo already has the primitives for a local-safe serial lane:

- `colony_plan_packet` emits bounded workers and `executionManifest`.
- `colony_worker_start_packet` turns one worker into an `agentInvocationSpecPacket`.
- `agent_run_task_dispatch` and SDK dispatch surfaces can start controlled workers only with structured approval.
- `agent_run_status`, `agent_run_follow`, `agent_run_outcome_packet`, and batch/fan-in packets validate results.
- `colony_serial_fanin_packet` can promote evidence only after fail-closed fan-in.

Codex can also invoke commands in the devcontainer, including `docker exec goofy_nightingale ...`, so a Pi subprocess is technically reachable from the parent environment.

## Missing layer

What is missing is not model capability. It is an operational driver that connects the primitives without relying on chat copy/paste.

Minimum driver contract:

1. Accept a saved `colony_plan_packet` or `executionManifest`.
2. Select the next pending worker in sequence.
3. Build or load the matching `colony_worker_start_packet`.
4. Require one structured operator approval for execution policy, not one free-form prompt per step.
5. Invoke the worker through the existing typed `agent_run` path or a Pi subprocess adapter.
6. Capture stdout/stderr/log path and update `.pi/reports/agent-runs.json`.
7. Run parent-side `agent_run_outcome_packet`.
8. Stop after one worker by default, or continue serially only under an explicit bounded suite approval.
9. Run `colony_serial_fanin_packet` when all required outcomes are present.
10. Never launch `ant_colony` from this lane.

## Why Codex should not just shell out ad hoc

Codex can run `docker exec` and invoke Pi, but doing so directly skips several contracts:

- structured approval provenance;
- registry planned/running/completed state;
- exact declared-file validation;
- expected artifact checks;
- fail-closed fan-in;
- stale/empty output classification;
- controlled abort/follow semantics.

The right fix is to expose a parent-owned driver that uses the same contracts every caller can reuse: Codex, Pi, external agents, or future UI.

## Recommended next slice

Build a report-only driver packet first:

- name: `colony_serial_driver_packet`;
- mode: `colony-serial-driver-packet`;
- input: `planId`, `executionManifest`, optional completed outcomes;
- output:
  - `nextWorkerPacketId`;
  - `nextRequiredOutcomeId`;
  - `nextExpectedArtifact`;
  - `requiredApprovalPrompt`;
  - `driverSteps`;
  - `blocked` when manifest is missing, unordered, incomplete, or references `ant_colony`;
  - `dispatchAllowed: false`;
  - `processStartAllowed: false`.

After that packet is tested, add the execution slice:

- `colony_serial_driver_dispatch`;
- default preview-only;
- `execute=true` requires structured operator approval;
- runs exactly one worker by default;
- writes registry/log evidence;
- asks the caller to run outcome/fan-in after completion, or performs those parent-side checks in a separate follow-up slice.

## Commit policy

Keep each step atomic:

1. report-only packet + tests;
2. dispatch preview + structured approval tests;
3. one-worker execution path + registry/log tests;
4. parent-side outcome/fan-in integration tests.
