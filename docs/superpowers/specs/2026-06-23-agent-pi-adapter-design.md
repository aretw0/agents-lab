# agent-pi adapter — design

Data: 2026-06-23
Status: design aprovado, pendente de plano de implementação

## Context

The eval-contract baseline core (`task` / `runner` / `report` + a deterministic
fake agent) is built and committed under
`experiments/202606-eval-contract-baseline/`. The runner is runtime-agnostic: it
only knows an agent as a function `(task) => { output, files? }`.

This slice adds the **first real agent under test** — an `agent-pi` adapter that
satisfies that same function interface while driving real Pi headlessly through
`scripts/agent-run-pi-driver.mjs` (which composes
`agent-run-pi-driver-payload` + `agent-run-driver-step`). It is the step that
turns the fake agent into a real measurement and unblocks the baseline of the
`@davidorex/pi-project-workflows` capability for the mariozechner-sovereignty
cut, per
`docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`.

## Goals

- Provide `createPiAgent(defaults) => (task) => AgentResult`, an agent the
  existing `runTask` can drive with no changes to `contract/`.
- Keep the contract core **pi-free**: the adapter lives in `adapters/`, outside
  the fence guarded by `scripts/engine-boundary-audit.mjs`.
- Default to the driver's **preview path** (`execute:false`) so the measurement
  is deterministic and CI-safe (no live model/network); leave a wired but
  unexercised **live** seam behind an opt-in flag.
- Give every future sovereignty task an ergonomic verify surface.

## Non-goals (now)

- Running live Pi in CI (live stays opt-in/cold, `EVAL_PI_LIVE=1`).
- Authoring the `@davidorex/pi-project-workflows` capability tasks/baseline
  (the next slice).
- The `format-terminal-bench` reader or the sovereignty release gate.
- A subprocess invocation path (in-process import is enough — YAGNI).

## Decisions (from brainstorming)

1. **Execution depth:** adapter + driver *preview* path. A capability task at
   this level verifies that Pi *would dispatch correctly* for the capability
   (`decision` / `dispatchAllowed`). Live `--execute --approve` runs are opt-in.
2. **Result shape:** the adapter returns an **enriched** `AgentResult` —
   `{ output, files, decision, dispatchAllowed, processStartAllowed, driver }` —
   so tasks verify structured fields directly (e.g. `r.dispatchAllowed === true`)
   instead of parsing a string. `output` stays a human-readable summary.
3. **Task environment:** `defineTask` gains an optional, **opaque** `env` bag
   (the spec's "ambiente" leg). The adapter is a factory that merges
   `defaults ⊕ task.env` and maps `instruction → prompt`. `env` is opaque to the
   contract, so Refarm can later interpret the same field differently and the
   core stays runtime-agnostic.
4. **Invocation:** **in-process import** of `runPiDriver` with an **injectable
   driver** param (`driver = runPiDriver`), mirroring how `runTask(task, agent)`
   is tested with `fakeAgent`. The unit test injects a fake driver for
   determinism; an opt-in path exercises the real preview.

## Architecture

```
experiments/202606-eval-contract-baseline/
  contract/                 (unchanged, pi-free — guarded by engine-boundary-audit)
    task.mjs                ← additive: optional `env` bag
    runner.mjs
    report.mjs
  adapters/                 ← NEW (may import Pi; outside the pi-free fence)
    agent-pi.mjs            ← createPiAgent(defaults) => (task) => enriched AgentResult
  tests/
    fixtures/
      fake-agent.mjs
      fake-pi-driver.mjs    ← NEW: deterministic stand-in for runPiDriver
    agent-pi.test.mjs       ← NEW: offline unit + integration test
```

The adapter imports `scripts/agent-run-pi-driver.mjs`. Because it is in
`adapters/` and not `contract/`, the pi-free invariant the boundary audit
enforces on `contract/` is untouched.

## `agent-pi.mjs` behavior

```js
// createPiAgent(defaults) -> (task) => AgentResult
//   defaults: { model, mode="print-readonly", fileContract="read-only",
//               tools=[], files=[], cwd, driver=runPiDriver }
export function createPiAgent(defaults = {}) {
  const { driver = runPiDriver, ...baseEnv } = defaults;
  return async (task) => {
    const env = { ...baseEnv, ...(task.env ?? {}) };   // per-task overrides win
    const result = await driver({
      cwd: env.cwd ?? process.cwd(),
      mode: env.mode ?? "print-readonly",
      prompt: task.instruction,                          // instruction -> prompt
      model: env.model ?? "",
      tools: env.tools ?? [],
      files: env.files ?? [],
      fileContract: env.fileContract ?? "read-only",
      execute: false, approve: false,                    // preview path, always
    });
    return {
      output: result.summary ?? `pi-driver: decision=${result.decision}`,
      files: {},                                         // populated only on live runs
      decision: result.decision,
      dispatchAllowed: result.dispatchAllowed === true,
      processStartAllowed: result.processStartAllowed === true,
      driver: result,                                    // full packet for deep verify
    };
  };
}
```

### Data flow

`runTask(task, createPiAgent({model}))` → adapter merges `defaults ⊕ task.env`,
maps `instruction → prompt`, calls `runPiDriver` in preview (`execute:false`) →
driver returns its decision packet → adapter flattens
`decision / dispatchAllowed / processStartAllowed` and stashes the full `driver`
packet → `task.verify(result)` checks e.g. `r.dispatchAllowed === true`.

### Live path (seam only, this slice)

When `env.live` / `EVAL_PI_LIVE=1`, the adapter would pass
`execute:true, approve:true` and harvest real `output`/`files`. For this slice it
stays a documented branch; the default is always preview.

### Error handling

- The adapter does **not** swallow driver throws. `runTask` already wraps each
  attempt in try/catch and records `outcomes[].error`, so a thrown driver is a
  recorded non-pass (same contract as `fakeAgent({ throwOn })`).
- A `decision === "blocked"` is **not** a throw — it returns normally with
  `dispatchAllowed:false`, so a task can verify the blocked case explicitly.

## Task contract change (additive, backward-compatible)

```js
export function defineTask({ id, tier, instruction, verify, env } = {}) {
  // …existing validation…
  if (env !== undefined && (typeof env !== "object" || env === null || Array.isArray(env)))
    throw new Error("task.env must be a plain object when provided");
  return env === undefined ? { id, tier, instruction, verify }
                           : { id, tier, instruction, verify, env };
}
```

Existing tasks and the 4 committed `task.test.mjs` cases stay green untouched.

## Testing (TDD, all offline → safe for `test:eval-contract`)

- `tests/task.test.mjs` — +2: accepts a valid `env`; rejects a non-object `env`.
- `tests/fixtures/fake-pi-driver.mjs` — returns a canned packet
  `{ decision, dispatchAllowed, processStartAllowed, summary }`; can be told to
  throw or to return `blocked`.
- `tests/agent-pi.test.mjs` — with the **injected fake driver**:
  1. maps `instruction → prompt` and `defaults ⊕ task.env` (assert driver args);
  2. flattens `decision/dispatchAllowed/processStartAllowed`, keeps full `driver`;
  3. always sends `execute:false`;
  4. `blocked` packet → `dispatchAllowed:false`, returns normally (no throw);
  5. driver throw → propagates so `runTask` records a non-pass.
- One **integration test** through the real contract:
  `runTask(task, createPiAgent({ driver: fakeDriver }))` and assert the scored
  `{ passes, passRate }` — proving the seam closes against the actual runner.

## Wiring

- `test:eval-contract` already globs `tests/*.test.mjs` — the new test is picked
  up with no script change.
- Boundary guard stays scoped to `contract/`: re-run
  `! grep -rE "earendil|mariozechner|pi-coding-agent" .../contract/` (adapter is
  intentionally outside this fence).
- README: add an `adapters/agent-pi.mjs` section + the `EVAL_PI_LIVE` opt-in
  note, and update the promotion-criteria line to reference the built adapter.

## Verification (how we'll know)

- `pnpm run test:eval-contract` green, including the new adapter unit +
  integration tests, with no network/model.
- The contract boundary grep stays empty for `contract/`.
- `createPiAgent({ driver: fakeDriver })` plugs into the unchanged `runTask` and
  produces a scored result — the fake-agent measurement is now a real-adapter
  measurement at the preview tier.
