# Eval Contract Baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal, pi-free evaluation contract — define a Task, run any agent against it, score it (with variance), and write a dated report — as the first slice of the eval-lab safety net.

**Architecture:** A small portable core under `experiments/202606-eval-contract-baseline/contract/` exposing three focused modules (`task`, `runner`, `report`). The runner talks to an `agent` only through a function interface `(task) => { output, files? }`, so it never imports any runtime (Pi today, Refarm later, a fake agent in tests). Verification is an objective predicate carried by each Task. No containers, no real Pi, no benchmark adapters in this slice.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict` (the repo's first-party test runner), pnpm scripts.

**Scope:** This plan delivers ONLY the in-memory contract core. Follow-on plans add: the `agent-pi` container adapter, the terminal-bench task-format reader, capability tasks for the mariozechner-sovereignty inventory, and the readiness gate. See `docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`.

---

## File Structure

- `experiments/202606-eval-contract-baseline/contract/task.mjs` — Task shape + `defineTask` validator + `TIERS`. One responsibility: what a task IS.
- `experiments/202606-eval-contract-baseline/contract/runner.mjs` — `runTask(task, agent, opts)`: run + verify + repeat for variance. One responsibility: executing a task against an agent.
- `experiments/202606-eval-contract-baseline/contract/report.mjs` — `buildReport` + `writeReport`: dated, tier-aggregated result. One responsibility: persisting evidence.
- `experiments/202606-eval-contract-baseline/tests/fixtures/fake-agent.mjs` — deterministic fake agent for tests.
- `experiments/202606-eval-contract-baseline/tests/{task,runner,report}.test.mjs` — tests.
- `experiments/202606-eval-contract-baseline/README.md` — usage + promotion criteria.
- `package.json` — add `test:eval-contract` script.

---

### Task 1: Task contract (`defineTask` + tiers)

**Files:**
- Create: `experiments/202606-eval-contract-baseline/contract/task.mjs`
- Test: `experiments/202606-eval-contract-baseline/tests/task.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// experiments/202606-eval-contract-baseline/tests/task.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { defineTask, TIERS } from "../contract/task.mjs";

test("defineTask returns a normalized task for valid input", () => {
  const task = defineTask({ id: "echo-hello", tier: "T0", instruction: "say hello", verify: (r) => r.output === "hello" });
  assert.equal(task.id, "echo-hello");
  assert.equal(task.tier, "T0");
  assert.equal(typeof task.verify, "function");
});

test("defineTask rejects an unknown tier", () => {
  assert.throws(() => defineTask({ id: "x", tier: "T9", instruction: "i", verify: () => true }), /tier must be one of/);
});

test("defineTask rejects a missing verify function", () => {
  assert.throws(() => defineTask({ id: "x", tier: "T0", instruction: "i" }), /verify must be a function/);
});

test("TIERS lists the basic-to-advanced ladder", () => {
  assert.deepEqual(TIERS, ["T0", "T1", "T2", "T3"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test experiments/202606-eval-contract-baseline/tests/task.test.mjs`
Expected: FAIL — cannot find module `../contract/task.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// experiments/202606-eval-contract-baseline/contract/task.mjs

/**
 * Capability tier ladder (basic -> advanced).
 * T0 single-tool/single-file deterministic; T1 multi-step single-agent;
 * T2 orchestration/guardrails; T3 multi-modal interaction.
 */
export const TIERS = ["T0", "T1", "T2", "T3"];

/**
 * @typedef {object} AgentResult
 * @property {string} output
 * @property {Record<string, string>} [files]
 *
 * @typedef {object} Task
 * @property {string} id
 * @property {string} tier
 * @property {string} instruction
 * @property {(r: AgentResult) => boolean} verify
 */

/** Validate and normalize a Task. Throws on invalid input. @returns {Task} */
export function defineTask({ id, tier, instruction, verify } = {}) {
  if (typeof id !== "string" || id.length === 0) throw new Error("task.id is required");
  if (!TIERS.includes(tier)) throw new Error(`task.tier must be one of ${TIERS.join(", ")}`);
  if (typeof instruction !== "string" || instruction.length === 0) throw new Error("task.instruction is required");
  if (typeof verify !== "function") throw new Error("task.verify must be a function");
  return { id, tier, instruction, verify };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test experiments/202606-eval-contract-baseline/tests/task.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add experiments/202606-eval-contract-baseline/contract/task.mjs experiments/202606-eval-contract-baseline/tests/task.test.mjs
git commit -m "feat(eval-contract): add Task contract with tier ladder"
```

---

### Task 2: Deterministic fake agent fixture

**Files:**
- Create: `experiments/202606-eval-contract-baseline/tests/fixtures/fake-agent.mjs`

- [ ] **Step 1: Write the implementation (test fixture, exercised by Task 3)**

```js
// experiments/202606-eval-contract-baseline/tests/fixtures/fake-agent.mjs

/**
 * Deterministic fake agent for harness tests.
 * Returns a fixed output, or throws if `throwOn` matches the task id.
 * @param {string} output
 * @param {object} [opts]
 * @param {string} [opts.throwOn]
 */
export function fakeAgent(output, { throwOn } = {}) {
  return (task) => {
    if (throwOn && task.id === throwOn) throw new Error(`fake agent failed on ${task.id}`);
    return { output };
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add experiments/202606-eval-contract-baseline/tests/fixtures/fake-agent.mjs
git commit -m "test(eval-contract): add deterministic fake agent fixture"
```

---

### Task 3: Runner with verification and variance

**Files:**
- Create: `experiments/202606-eval-contract-baseline/contract/runner.mjs`
- Test: `experiments/202606-eval-contract-baseline/tests/runner.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// experiments/202606-eval-contract-baseline/tests/runner.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { defineTask } from "../contract/task.mjs";
import { runTask } from "../contract/runner.mjs";
import { fakeAgent } from "./fixtures/fake-agent.mjs";

const helloTask = defineTask({ id: "echo-hello", tier: "T0", instruction: "say hello", verify: (r) => r.output === "hello" });

test("runTask reports a pass when verify succeeds", async () => {
  const result = await runTask(helloTask, fakeAgent("hello"));
  assert.equal(result.taskId, "echo-hello");
  assert.equal(result.tier, "T0");
  assert.equal(result.attempts, 1);
  assert.equal(result.passes, 1);
  assert.equal(result.passRate, 1);
});

test("runTask reports a fail when verify fails", async () => {
  const result = await runTask(helloTask, fakeAgent("goodbye"));
  assert.equal(result.passes, 0);
  assert.equal(result.passRate, 0);
});

test("runTask records a thrown agent as a non-pass with the error", async () => {
  const result = await runTask(helloTask, fakeAgent("hello", { throwOn: "echo-hello" }));
  assert.equal(result.passes, 0);
  assert.match(result.outcomes[0].error, /fake agent failed/);
});

test("runTask computes passRate across repetitions for variance", async () => {
  let n = 0;
  const flaky = () => ({ output: (n++ % 2 === 0) ? "hello" : "miss" });
  const result = await runTask(helloTask, flaky, { repetitions: 4 });
  assert.equal(result.attempts, 4);
  assert.equal(result.passes, 2);
  assert.equal(result.passRate, 0.5);
});

test("runTask rejects an invalid repetitions value", async () => {
  await assert.rejects(() => runTask(helloTask, fakeAgent("hello"), { repetitions: 0 }), /positive integer/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test experiments/202606-eval-contract-baseline/tests/runner.test.mjs`
Expected: FAIL — cannot find module `../contract/runner.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// experiments/202606-eval-contract-baseline/contract/runner.mjs

/**
 * Run a task against an agent, verifying each attempt; repeat for variance.
 * The agent is any function `(task) => AgentResult | Promise<AgentResult>`,
 * so the runner stays runtime-agnostic (no Pi/Refarm import here).
 * @param {import("./task.mjs").Task} task
 * @param {(task: any) => any} agent
 * @param {object} [opts]
 * @param {number} [opts.repetitions]
 */
export async function runTask(task, agent, { repetitions = 1 } = {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error("repetitions must be a positive integer");
  }
  const outcomes = [];
  for (let attempt = 1; attempt <= repetitions; attempt++) {
    let pass = false;
    let error = null;
    try {
      const result = await agent(task);
      pass = task.verify(result) === true;
    } catch (e) {
      error = String(e?.message ?? e);
    }
    outcomes.push({ attempt, pass, error });
  }
  const passes = outcomes.filter((o) => o.pass).length;
  return { taskId: task.id, tier: task.tier, attempts: repetitions, passes, passRate: passes / repetitions, outcomes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test experiments/202606-eval-contract-baseline/tests/runner.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add experiments/202606-eval-contract-baseline/contract/runner.mjs experiments/202606-eval-contract-baseline/tests/runner.test.mjs
git commit -m "feat(eval-contract): add runtime-agnostic runner with variance"
```

---

### Task 4: Report builder and writer

**Files:**
- Create: `experiments/202606-eval-contract-baseline/contract/report.mjs`
- Test: `experiments/202606-eval-contract-baseline/tests/report.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// experiments/202606-eval-contract-baseline/tests/report.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, writeReport } from "../contract/report.mjs";

const results = [
  { taskId: "a", tier: "T0", attempts: 2, passes: 2, passRate: 1, outcomes: [] },
  { taskId: "b", tier: "T0", attempts: 2, passes: 1, passRate: 0.5, outcomes: [] },
  { taskId: "c", tier: "T1", attempts: 1, passes: 0, passRate: 0, outcomes: [] },
];

test("buildReport aggregates summary and per-tier rollup", () => {
  const report = buildReport(results, { generatedAtIso: "2026-06-22T00:00:00.000Z" });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.generatedAtIso, "2026-06-22T00:00:00.000Z");
  assert.equal(report.summary.tasks, 3);
  assert.equal(report.summary.passRate, (1 + 0.5 + 0) / 3);
  assert.deepEqual(report.summary.byTier.T0, { tasks: 2, passes: 3, attempts: 4 });
  assert.deepEqual(report.summary.byTier.T1, { tasks: 1, passes: 0, attempts: 1 });
});

test("writeReport persists JSON to a created directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-report-"));
  try {
    const path = join(dir, "nested", "report.json");
    const report = buildReport(results, { generatedAtIso: "2026-06-22T00:00:00.000Z" });
    const written = writeReport(report, path);
    assert.equal(written, path);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(parsed.summary.tasks, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test experiments/202606-eval-contract-baseline/tests/report.test.mjs`
Expected: FAIL — cannot find module `../contract/report.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// experiments/202606-eval-contract-baseline/contract/report.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Aggregate task results into a dated, tier-rolled report.
 * @param {Array<object>} results
 * @param {object} [opts]
 * @param {string} [opts.generatedAtIso]
 */
export function buildReport(results, { generatedAtIso = new Date().toISOString() } = {}) {
  const byTier = {};
  for (const r of results) {
    const bucket = (byTier[r.tier] ??= { tasks: 0, passes: 0, attempts: 0 });
    bucket.tasks += 1;
    bucket.passes += r.passes;
    bucket.attempts += r.attempts;
  }
  const passRate = results.length ? results.reduce((acc, r) => acc + r.passRate, 0) / results.length : 0;
  return { schemaVersion: 1, generatedAtIso, results, summary: { tasks: results.length, passRate, byTier } };
}

/** Write a report as pretty JSON, creating parent dirs. @returns {string} the path. */
export function writeReport(report, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test experiments/202606-eval-contract-baseline/tests/report.test.mjs`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add experiments/202606-eval-contract-baseline/contract/report.mjs experiments/202606-eval-contract-baseline/tests/report.test.mjs
git commit -m "feat(eval-contract): add dated tier-rolled report builder"
```

---

### Task 5: Runnable script, README, and self-verification

**Files:**
- Modify: `package.json` (scripts block)
- Create: `experiments/202606-eval-contract-baseline/README.md`

- [ ] **Step 1: Add the test script to `package.json`**

In the `scripts` block, add this entry (keep alphabetic neighbourhood near other `test:*` entries):

```json
"test:eval-contract": "node --test experiments/202606-eval-contract-baseline/tests/*.test.mjs",
```

- [ ] **Step 2: Run the whole slice via the new script**

Run: `pnpm run test:eval-contract`
Expected: PASS — all tests across task/runner/report pass (11 tests total).

- [ ] **Step 3: Confirm the core is pi-free (sovereignty/agnosticism invariant)**

Run: `! grep -rE "earendil|mariozechner|pi-coding-agent" experiments/202606-eval-contract-baseline/contract/`
Expected: exit 0 (no matches) — the contract core imports no runtime.

- [ ] **Step 4: Write the README**

```markdown
# eval-contract-baseline (experiment)

Minimal, runtime-agnostic evaluation contract: define a Task, run any agent
against it, score with variance, and write a dated report.

## Modules
- `contract/task.mjs` — `defineTask({ id, tier, instruction, verify })`, `TIERS`.
- `contract/runner.mjs` — `runTask(task, agent, { repetitions })` → scored result.
- `contract/report.mjs` — `buildReport(results)`, `writeReport(report, path)`.

The `agent` is any `(task) => { output, files? }` function, so the runner is
agnostic to Pi/Refarm. The core imports no runtime (see `test:eval-contract`).

## Run
    pnpm run test:eval-contract

## Promotion criteria (experiment -> primitive)
Promote to `primitives/eval-contract/` when a real `agent-pi` adapter and at
least one capability task run reproducibly, per
`docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`.
```

- [ ] **Step 5: Commit**

```bash
git add package.json experiments/202606-eval-contract-baseline/README.md
git commit -m "feat(eval-contract): add test:eval-contract script and README"
```

---

## Self-Review

**Spec coverage (this slice):** the spec's "Eval-harness (a primeira primitiva)" calls for `contract/` with `task`/`runner`/`report`, an agent interface that keeps the core pi-free, and fake-agent tests. Tasks 1–5 implement exactly that. The `agent-pi` adapter, `format-terminal-bench`, capability tasks, and the sovereignty gate are explicitly out of this slice (named in follow-on scope).

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every run step shows the exact command and expected result.

**Type consistency:** the result shape `{ taskId, tier, attempts, passes, passRate, outcomes }` produced by `runTask` (Task 3) is exactly what `buildReport` consumes (Task 4). `defineTask` output `{ id, tier, instruction, verify }` (Task 1) matches the `task.verify` / `task.id` / `task.tier` reads in the runner (Task 3). `fakeAgent` signature `(task) => { output }` (Task 2) matches the agent interface the runner calls (Task 3).
