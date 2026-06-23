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

## Tasks
- `tasks/ppw.mjs` — three T1 capability tasks for `@davidorex/pi-project-workflows`
  (`ppw-monitors`, `ppw-project`, `ppw-workflows`). Each declares its required Pi
  surface in `env.artifacts` (extension file + skill) and verifies `r.resolved === true`
  via `adapters/capability-probe.mjs` (a sibling instrument to `agent-pi` that resolves
  the surface on disk — no Pi import).

  Why a probe, not `agent-pi`: the headless driver runs `--no-extensions --no-skills`,
  so dispatch is blind to this dep's extension/skill surface. Resolution is the
  dep-sensitive signal.

  **Baseline & gate:** with the dep installed, `tests/ppw.test.mjs` is green — the
  versioned "before" evidence. It flips red if the dep is dropped from
  `packages/pi-stack/package-list.mjs` unless a first-party substitute resolves the same
  `env.artifacts`. The dep only leaves the list when these tasks pass without it.

## Run
    pnpm run test:eval-contract

## Promotion criteria (experiment -> primitive)
Promote to `primitives/eval-contract/` when the `agent-pi` adapter and at least one
`@davidorex/pi-project-workflows` capability task run reproducibly, per
`docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`.
