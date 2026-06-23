# eval-contract-baseline (experiment)

Minimal, runtime-agnostic evaluation contract: define a Task, run any agent
against it, score with variance, and write a dated report.

## Modules
- `contract/task.mjs` — `defineTask({ id, tier, instruction, verify })`, `TIERS`.
- `contract/runner.mjs` — `runTask(task, agent, { repetitions })` -> scored result.
- `contract/report.mjs` — `buildReport(results)`, `writeReport(report, path)`.

The `agent` is any `(task) => { output, files? }` function, so the runner is
agnostic to Pi/Refarm. The core imports no runtime (see `test:eval-contract`).

## Adapters
- `adapters/agent-pi.mjs` — `createPiAgent({ model, mode, tools, files, fileContract, cwd, driver })`
  returns a `(task) => AgentResult` backed by Pi via `scripts/agent-run-pi-driver.mjs`.
  Defaults to the driver's **preview** path (`execute:false`): a task verifies that
  Pi *would dispatch* (`r.dispatchAllowed === true`), deterministically and offline.
  The `driver` param is injectable so tests run without Pi.

  A task carries adapter knobs in its opaque `env` bag; `defaults ⊕ task.env` (task wins),
  and `task.instruction` becomes the prompt.

  Live runs (`--execute --approve`, real model output) are an opt-in cold path gated by
  `EVAL_PI_LIVE=1` — never exercised in CI.

## Run
    pnpm run test:eval-contract

## Promotion criteria (experiment -> primitive)
Promote to `primitives/eval-contract/` when the `agent-pi` adapter and at least one
`@davidorex/pi-project-workflows` capability task run reproducibly, per
`docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`.
