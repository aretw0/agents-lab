# eval-contract-baseline (experiment)

Minimal, runtime-agnostic evaluation contract: define a Task, run any agent
against it, score with variance, and write a dated report.

## Modules
- `contract/task.mjs` — `defineTask({ id, tier, instruction, verify })`, `TIERS`.
- `contract/runner.mjs` — `runTask(task, agent, { repetitions })` -> scored result.
- `contract/report.mjs` — `buildReport(results)`, `writeReport(report, path)`.

The `agent` is any `(task) => { output, files? }` function, so the runner is
agnostic to Pi/Refarm. The core imports no runtime (see `test:eval-contract`).

## Run
    pnpm run test:eval-contract

## Promotion criteria (experiment -> primitive)
Promote to `primitives/eval-contract/` when a real `agent-pi` adapter and at
least one capability task run reproducibly, per
`docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`.
