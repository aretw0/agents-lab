# 0.8 agent quality calibration lane — 2026-05

## Lane choice

Chosen lane: **agents-lab quality calibration lane**.

Purpose: use simple agents first on low-risk quality improvements for agents-lab itself, so the control plane can measure patch quality, instruction following, validation behavior, and review burden before broader delegation.

Status: local-safe runway. This document does not authorize agent dispatch. It defines candidate material for future one-slice canaries.

## Why this lane first

- Quality work is naturally decomposable into small docs/tests/fixtures/rubrics.
- Most slices can be validated locally with marker checks or focused smoke tests.
- Bad patches are easy to review and roll back.
- It improves the control plane while generating delegation telemetry.
- It avoids starting with protected/provider/CI/remote work.

## Allowed work by default

Allowed for candidate canaries:

- docs and research notes under `docs/research` or `docs/primitives`;
- smoke-test fixtures that do not change runtime behavior;
- report-only rubrics and scorecards;
- monitor calibration evidence and stale-feedback fixtures;
- small local helpers when validation is already known.

Not allowed without explicit human opt-in:

- `.pi/settings.json`, provider routing, model catalogs, credentials, or quota policy changes;
- GitHub Actions, CI workflow mutation, publish/release automation;
- remote/offload, scheduler, background long-runs, or destructive maintenance;
- protected parked external influence tasks;
- broad refactors or multi-file runtime behavior changes.

## Initial microtask catalog

### Candidate A — review rubric fixture

Goal: create a small review rubric for evaluating simple-agent patches.

- Suggested file: `docs/research/0-8-agent-quality-review-rubric-2026-05.md`
- Validation: marker check for `scope`, `validation`, `rollback`, `reject conditions`, `acceptance threshold`.
- Rollback: delete the new doc or `git restore -- docs/research/0-8-agent-quality-review-rubric-2026-05.md`.
- Canary suitability: high.

### Candidate B — stale monitor feedback fixture

Goal: document examples where monitor feedback is stale and should be resolved by later board evidence.

- Suggested file: `docs/research/monitor-stale-feedback-intake-template-2026-05.md` or a new fixture doc.
- Validation: marker check for `later commit`, `later verification`, `resolved_by`, `do not change scope`.
- Rollback: restore the doc.
- Canary suitability: medium; must avoid changing monitor runtime.

### Candidate C — no-op edit noise fixture

Goal: define examples for exact no-op, trailing-whitespace-only, and semantic edit diffs.

- Suggested file: `docs/research/no-op-edit-noise-fixtures-2026-05.md`
- Validation: marker check for `exact no-op`, `trailing whitespace`, `semantic edit`, `report-only metric`.
- Rollback: delete the new doc or restore it.
- Canary suitability: high.

### Candidate D — local-safe canary checklist

Goal: create a checklist used before asking a worker agent to edit.

- Suggested file: `docs/research/simple-delegate-local-safe-checklist-2026-05.md`
- Validation: marker check for `one agent`, `one task`, `declared files`, `timeout`, `rollback`, `stop after one slice`.
- Rollback: delete the new doc or restore it.
- Canary suitability: high.

## Promotion criteria for first simple-delegate canary

A candidate can be proposed for human approval only when all are true:

1. exactly one task is selected;
2. all touched files are declared;
3. validation command or marker check is known;
4. rollback is non-destructive;
5. no protected scope is involved;
6. timeout and budget are bounded;
7. the worker goal is one-slice and explicitly stops after the slice;
8. control plane retains review/integration authority.

## Default execution ladder

1. Control plane seeds or selects one microtask.
2. Control plane validates the task locally once if trivial.
3. Control plane asks for explicit human approval before any worker dispatch.
4. One simple worker attempts exactly one slice in isolated cwd/worktree.
5. Control plane reviews diff, runs validation, and decides accept/reject.
6. Board/handoff records evidence and reviewer burden.

## Calibration metrics

Track after each canary:

- patch accepted/rejected;
- number of files touched versus declared;
- validation pass/fail;
- rollback needed yes/no;
- instruction-following deviations;
- review time and number of control-plane corrections;
- whether the agent attempted protected scope or broadening.

## Current recommendation

Use **Candidate A** or **Candidate D** as the first real simple-delegate canary after human approval. Both are doc-only, local-safe, easy to validate, and directly improve the quality gate for later agents.
