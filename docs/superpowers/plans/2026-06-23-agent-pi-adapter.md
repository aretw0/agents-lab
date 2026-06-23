# agent-pi adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first real agent under test — a `createPiAgent` adapter that satisfies the runner's `(task) => { output, files? }` interface while driving Pi headlessly via `scripts/agent-run-pi-driver.mjs`, defaulting to the deterministic preview path.

**Architecture:** A new `adapters/agent-pi.mjs` (outside the pi-free `contract/` fence) imports `runPiDriver` in-process behind an injectable `driver` param. It merges adapter `defaults ⊕ task.env`, maps `instruction → prompt`, always runs the driver in preview (`execute:false`), and returns an enriched `AgentResult` (`{ output, files, decision, dispatchAllowed, processStartAllowed, driver }`). `defineTask` gains an optional opaque `env` bag. All tests use an injected fake driver, so they stay offline and CI-safe.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, pnpm scripts. Reuses `scripts/agent-run-pi-driver.mjs` (exports `runPiDriver`).

Design: `docs/superpowers/specs/2026-06-23-agent-pi-adapter-design.md`.

---

## File Structure

- `experiments/202606-eval-contract-baseline/contract/task.mjs` — MODIFY: add optional opaque `env` field to `defineTask`. Still pi-free.
- `experiments/202606-eval-contract-baseline/tests/task.test.mjs` — MODIFY: +2 cases for `env`.
- `experiments/202606-eval-contract-baseline/tests/fixtures/fake-pi-driver.mjs` — CREATE: deterministic stand-in for `runPiDriver`, capturing its args.
- `experiments/202606-eval-contract-baseline/adapters/agent-pi.mjs` — CREATE: `createPiAgent(defaults) => (task) => AgentResult`.
- `experiments/202606-eval-contract-baseline/tests/agent-pi.test.mjs` — CREATE: adapter unit tests + one integration test through the real `runTask`.
- `experiments/202606-eval-contract-baseline/README.md` — MODIFY: document the adapter + `EVAL_PI_LIVE` opt-in; update promotion criteria.

No `package.json` change: `test:eval-contract` already globs `tests/*.test.mjs`.

---

### Task 1: Add opaque `env` to the Task contract

**Files:**
- Modify: `experiments/202606-eval-contract-baseline/contract/task.mjs`
- Test: `experiments/202606-eval-contract-baseline/tests/task.test.mjs`

- [ ] **Step 1: Add the failing tests**

Append these two tests to `experiments/202606-eval-contract-baseline/tests/task.test.mjs`:

```js
test("defineTask carries an optional env bag", () => {
  const task = defineTask({ id: "x", tier: "T1", instruction: "i", verify: () => true, env: { model: "m", tools: ["bash"] } });
  assert.deepEqual(task.env, { model: "m", tools: ["bash"] });
});

test("defineTask rejects a non-object env", () => {
  assert.throws(() => defineTask({ id: "x", tier: "T0", instruction: "i", verify: () => true, env: [] }), /env must be a plain object/);
  assert.throws(() => defineTask({ id: "x", tier: "T0", instruction: "i", verify: () => true, env: "nope" }), /env must be a plain object/);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test experiments/202606-eval-contract-baseline/tests/task.test.mjs`
Expected: FAIL — "defineTask carries an optional env bag" fails (`task.env` is `undefined`); the non-object-env test fails (no error thrown). The original 4 tests still pass.

- [ ] **Step 3: Implement the `env` field**

In `experiments/202606-eval-contract-baseline/contract/task.mjs`, update the `Task` typedef and `defineTask`. Replace the current typedef block's `Task` entry and the `defineTask` body:

Add to the `@typedef ... Task` block (after the `verify` line):

```js
 * @property {Record<string, unknown>} [env] - opaque per-task environment for adapters
```

Replace the `defineTask` function with:

```js
/** Validate and normalize a Task. Throws on invalid input. @returns {Task} */
export function defineTask({ id, tier, instruction, verify, env } = {}) {
  if (typeof id !== "string" || id.length === 0) throw new Error("task.id is required");
  if (!TIERS.includes(tier)) throw new Error(`task.tier must be one of ${TIERS.join(", ")}`);
  if (typeof instruction !== "string" || instruction.length === 0) throw new Error("task.instruction is required");
  if (typeof verify !== "function") throw new Error("task.verify must be a function");
  if (env !== undefined && (typeof env !== "object" || env === null || Array.isArray(env))) {
    throw new Error("task.env must be a plain object when provided");
  }
  return env === undefined ? { id, tier, instruction, verify } : { id, tier, instruction, verify, env };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test experiments/202606-eval-contract-baseline/tests/task.test.mjs`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Confirm the contract core is still pi-free**

Run: `! grep -rE "earendil|mariozechner|pi-coding-agent" experiments/202606-eval-contract-baseline/contract/`
Expected: exit 0 (no matches).

- [ ] **Step 6: Commit**

```bash
git add experiments/202606-eval-contract-baseline/contract/task.mjs experiments/202606-eval-contract-baseline/tests/task.test.mjs
git commit -m "feat(eval-contract): add optional opaque env to Task contract"
```

---

### Task 2: Deterministic fake pi-driver fixture

**Files:**
- Create: `experiments/202606-eval-contract-baseline/tests/fixtures/fake-pi-driver.mjs`

- [ ] **Step 1: Write the fixture (exercised by Task 3)**

Create `experiments/202606-eval-contract-baseline/tests/fixtures/fake-pi-driver.mjs`:

```js
/**
 * Deterministic stand-in for scripts/agent-run-pi-driver.mjs's runPiDriver.
 * Records the options it was called with (calls[]) and returns a canned packet.
 * @param {object} [opts]
 * @param {string} [opts.decision] - decision to return (default "ready")
 * @param {boolean} [opts.dispatchAllowed] - default true
 * @param {boolean} [opts.processStartAllowed] - default false
 * @param {boolean} [opts.throwError] - if true, the driver throws
 */
export function fakePiDriver({ decision = "ready", dispatchAllowed = true, processStartAllowed = false, throwError = false } = {}) {
  const calls = [];
  const driver = async (options) => {
    calls.push(options);
    if (throwError) throw new Error("fake pi-driver failed");
    return {
      mode: "agent-run-pi-driver",
      schemaVersion: 1,
      decision,
      dispatchAllowed,
      processStartAllowed,
      summary: `agent-run-pi-driver: decision=${decision} dispatch=${dispatchAllowed ? "yes" : "no"}`,
    };
  };
  driver.calls = calls;
  return driver;
}
```

- [ ] **Step 2: Commit**

```bash
git add experiments/202606-eval-contract-baseline/tests/fixtures/fake-pi-driver.mjs
git commit -m "test(eval-contract): add deterministic fake pi-driver fixture"
```

---

### Task 3: The agent-pi adapter

**Files:**
- Create: `experiments/202606-eval-contract-baseline/adapters/agent-pi.mjs`
- Test: `experiments/202606-eval-contract-baseline/tests/agent-pi.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `experiments/202606-eval-contract-baseline/tests/agent-pi.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { defineTask } from "../contract/task.mjs";
import { runTask } from "../contract/runner.mjs";
import { createPiAgent } from "../adapters/agent-pi.mjs";
import { fakePiDriver } from "./fixtures/fake-pi-driver.mjs";

const projectTask = defineTask({
  id: "pi-dispatch-ready",
  tier: "T1",
  instruction: "set up the project monitor",
  verify: (r) => r.dispatchAllowed === true,
  env: { model: "task-model", tools: ["bash"] },
});

test("adapter maps instruction->prompt and merges defaults with task.env", async () => {
  const driver = fakePiDriver();
  const agent = createPiAgent({ model: "default-model", mode: "print-readonly", driver });
  await agent(projectTask);
  assert.equal(driver.calls.length, 1);
  const call = driver.calls[0];
  assert.equal(call.prompt, "set up the project monitor");
  assert.equal(call.model, "task-model"); // task.env overrides defaults
  assert.deepEqual(call.tools, ["bash"]);
  assert.equal(call.mode, "print-readonly");
});

test("adapter always runs the driver in preview (execute false)", async () => {
  const driver = fakePiDriver();
  const agent = createPiAgent({ driver });
  await agent(projectTask);
  assert.equal(driver.calls[0].execute, false);
  assert.equal(driver.calls[0].approve, false);
});

test("adapter flattens decision fields and keeps the full driver packet", async () => {
  const driver = fakePiDriver({ decision: "ready", dispatchAllowed: true });
  const agent = createPiAgent({ driver });
  const result = await agent(projectTask);
  assert.equal(result.decision, "ready");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.processStartAllowed, false);
  assert.equal(typeof result.output, "string");
  assert.deepEqual(result.files, {});
  assert.equal(result.driver.mode, "agent-run-pi-driver");
});

test("adapter returns blocked as data, not a throw", async () => {
  const driver = fakePiDriver({ decision: "blocked", dispatchAllowed: false });
  const agent = createPiAgent({ driver });
  const result = await agent(projectTask);
  assert.equal(result.decision, "blocked");
  assert.equal(result.dispatchAllowed, false);
});

test("adapter propagates a driver throw (runner records it as a non-pass)", async () => {
  const driver = fakePiDriver({ throwError: true });
  const result = await runTask(projectTask, createPiAgent({ driver }));
  assert.equal(result.passes, 0);
  assert.match(result.outcomes[0].error, /fake pi-driver failed/);
});

test("adapter plugs into runTask and produces a scored result", async () => {
  const driver = fakePiDriver({ dispatchAllowed: true });
  const result = await runTask(projectTask, createPiAgent({ driver }), { repetitions: 3 });
  assert.equal(result.taskId, "pi-dispatch-ready");
  assert.equal(result.tier, "T1");
  assert.equal(result.attempts, 3);
  assert.equal(result.passes, 3);
  assert.equal(result.passRate, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test experiments/202606-eval-contract-baseline/tests/agent-pi.test.mjs`
Expected: FAIL — cannot find module `../adapters/agent-pi.mjs`.

- [ ] **Step 3: Write the adapter**

Create `experiments/202606-eval-contract-baseline/adapters/agent-pi.mjs`:

```js
import process from "node:process";
import { runPiDriver } from "../../../scripts/agent-run-pi-driver.mjs";

/**
 * Build an eval-contract agent backed by Pi, driven headlessly through
 * scripts/agent-run-pi-driver.mjs. Returns a `(task) => AgentResult` function
 * that the runtime-agnostic runner can drive — the runner never imports Pi.
 *
 * Defaults to the driver's PREVIEW path (execute:false), so the measurement is
 * deterministic and CI-safe: a capability task verifies that Pi WOULD dispatch
 * (decision/dispatchAllowed), not live model output. Real `--execute --approve`
 * runs are an opt-in cold path (see EVAL_PI_LIVE in the README).
 *
 * @param {object} [defaults]
 * @param {string} [defaults.model]
 * @param {string} [defaults.mode] - default "print-readonly"
 * @param {string} [defaults.fileContract] - default "read-only"
 * @param {string[]} [defaults.tools]
 * @param {string[]} [defaults.files]
 * @param {string} [defaults.cwd]
 * @param {(options: object) => Promise<object>} [defaults.driver] - injectable, defaults to runPiDriver
 * @returns {(task: import("../contract/task.mjs").Task) => Promise<object>}
 */
export function createPiAgent(defaults = {}) {
  const { driver = runPiDriver, ...baseEnv } = defaults;
  return async (task) => {
    const env = { ...baseEnv, ...(task.env ?? {}) }; // per-task env overrides defaults
    const result = await driver({
      cwd: env.cwd ?? process.cwd(),
      mode: env.mode ?? "print-readonly",
      prompt: task.instruction,
      model: env.model ?? "",
      tools: env.tools ?? [],
      files: env.files ?? [],
      fileContract: env.fileContract ?? "read-only",
      execute: false,
      approve: false,
    });
    return {
      output: result.summary ?? `pi-driver: decision=${result.decision}`,
      files: {},
      decision: result.decision,
      dispatchAllowed: result.dispatchAllowed === true,
      processStartAllowed: result.processStartAllowed === true,
      driver: result,
    };
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test experiments/202606-eval-contract-baseline/tests/agent-pi.test.mjs`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add experiments/202606-eval-contract-baseline/adapters/agent-pi.mjs experiments/202606-eval-contract-baseline/tests/agent-pi.test.mjs
git commit -m "feat(eval-contract): add agent-pi preview adapter"
```

---

### Task 4: README + full-slice verification

**Files:**
- Modify: `experiments/202606-eval-contract-baseline/README.md`

- [ ] **Step 1: Update the README**

In `experiments/202606-eval-contract-baseline/README.md`, add an `## Adapters` section after the `## Modules` section:

```markdown
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
```

Then replace the `## Promotion criteria` body with:

```markdown
## Promotion criteria (experiment -> primitive)
Promote to `primitives/eval-contract/` when the `agent-pi` adapter and at least one
`@davidorex/pi-project-workflows` capability task run reproducibly, per
`docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`.
```

- [ ] **Step 2: Run the whole slice via the package script**

Run: `pnpm run test:eval-contract`
Expected: PASS — task (6) + runner (5) + report (2) + agent-pi (6) = 19 tests pass.

- [ ] **Step 3: Confirm the pi-free fence still holds for the core only**

Run: `! grep -rE "earendil|mariozechner|pi-coding-agent" experiments/202606-eval-contract-baseline/contract/`
Expected: exit 0 (no matches in `contract/`; the adapter importing Pi lives in `adapters/`, intentionally outside the fence).

- [ ] **Step 4: Commit**

```bash
git add experiments/202606-eval-contract-baseline/README.md
git commit -m "docs(eval-contract): document agent-pi adapter and update promotion criteria"
```

---

## Self-Review

**Spec coverage:** Decision 1 (preview path) → Task 3 adapter `execute:false` + test "always runs in preview". Decision 2 (enriched result) → Task 3 return shape + test "flattens decision fields". Decision 3 (opaque `task.env`) → Task 1 + adapter merge in Task 3. Decision 4 (in-process import + injectable driver) → Task 3 imports `runPiDriver`, `driver` param; Task 2 fake driver. Error handling (throw propagates, blocked-as-data) → Task 3 tests "propagates a driver throw" and "blocked as data". Wiring (glob, fence, README) → Task 4. All spec sections map to a task.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command and expected counts.

**Type consistency:** `createPiAgent(defaults)` with `driver` param (Task 3) matches `fakePiDriver()` returning a `driver` with `.calls` (Task 2). The returned `AgentResult` `{ output, files, decision, dispatchAllowed, processStartAllowed, driver }` (Task 3) matches the `verify`/assertions in Task 3 tests. `task.env` written in Task 1 (`{ ...task.env }`) is consumed by the adapter merge in Task 3. The driver options object (`prompt/model/tools/files/mode/fileContract/execute/approve/cwd`) matches the real `runPiDriver` parameter names verified in `scripts/agent-run-pi-driver.mjs`. Test counts: task 4→6, agent-pi 6, total 19 — consistent across Tasks 1, 3, 4.
