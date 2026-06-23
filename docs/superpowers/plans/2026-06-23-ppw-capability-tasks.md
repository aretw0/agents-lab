# @davidorex/pi-project-workflows capability tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author the `@davidorex/pi-project-workflows` capability baseline — a capability-resolution probe (sibling to `agent-pi`) plus three T1 tasks (monitors/project/workflows) whose green CI test is the versioned "with-dep" baseline and the sovereignty gate.

**Architecture:** A new `adapters/capability-probe.mjs` satisfies the runner's `(task) => { output, files? }` interface by resolving a task's declared surface (`task.env.artifacts`) against `node_modules` — no Pi import, pure `node:fs`. Three data-only tasks in `tasks/ppw.mjs` declare each capability's artifacts and verify `r.resolved === true`. Probe unit tests use an isolated tmp dir (deterministic, dep-independent); `ppw.test.mjs` runs the three tasks against the real default probe (the actual baseline, dep present).

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, pnpm scripts.

Design: `docs/superpowers/specs/2026-06-23-ppw-capability-tasks-design.md`.

---

## File Structure

- `experiments/202606-eval-contract-baseline/adapters/capability-probe.mjs` — CREATE: `createCapabilityProbe({ roots, cwd }) => (task) => result`. One responsibility: resolve a task's declared surface on disk.
- `experiments/202606-eval-contract-baseline/tasks/ppw.mjs` — CREATE: the 3 capability tasks + `ppwTasks[]`. Pure data.
- `experiments/202606-eval-contract-baseline/tests/capability-probe.test.mjs` — CREATE: probe unit tests (isolated tmp dir).
- `experiments/202606-eval-contract-baseline/tests/ppw.test.mjs` — CREATE: the 3 tasks pass via `runTask` with the dep present (versioned baseline) + report rollup.
- `experiments/202606-eval-contract-baseline/README.md` — MODIFY: add a `## Tasks` section.

No `package.json` change: `test:eval-contract` already globs `tests/*.test.mjs`.

---

### Task 1: Capability-resolution probe

**Files:**
- Create: `experiments/202606-eval-contract-baseline/adapters/capability-probe.mjs`
- Test: `experiments/202606-eval-contract-baseline/tests/capability-probe.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `experiments/202606-eval-contract-baseline/tests/capability-probe.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTask } from "../contract/task.mjs";
import { createCapabilityProbe } from "../adapters/capability-probe.mjs";

function withTmpRoot(run) {
  const dir = mkdtempSync(join(tmpdir(), "cap-probe-"));
  try {
    writeFileSync(join(dir, "present.txt"), "ok");
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mkTask = (artifacts) =>
  defineTask({ id: "cap-x", tier: "T1", instruction: "i", verify: (r) => r.resolved === true, env: { artifacts } });

test("probe resolves when every artifact exists", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["."], cwd: dir });
    const result = probe(mkTask(["present.txt"]));
    assert.equal(result.resolved, true);
    assert.equal(result.artifacts[0].found, true);
    assert.deepEqual(result.files, {});
  });
});

test("probe is unresolved when any artifact is missing", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["."], cwd: dir });
    const result = probe(mkTask(["present.txt", "missing.txt"]));
    assert.equal(result.resolved, false);
    assert.equal(result.artifacts[0].found, true);
    assert.equal(result.artifacts[1].found, false);
    assert.match(result.output, /1\/2/);
  });
});

test("probe treats an empty surface as unresolved (no vacuous pass)", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["."], cwd: dir });
    assert.equal(probe(mkTask([])).resolved, false);
  });
});

test("probe treats a task without env as unresolved, not a crash", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["."], cwd: dir });
    const task = defineTask({ id: "no-env", tier: "T1", instruction: "i", verify: () => true });
    assert.equal(probe(task).resolved, false);
  });
});

test("probe searches multiple roots in order", () => {
  withTmpRoot((dir) => {
    const probe = createCapabilityProbe({ roots: ["does-not-exist", "."], cwd: dir });
    assert.equal(probe(mkTask(["present.txt"])).resolved, true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test experiments/202606-eval-contract-baseline/tests/capability-probe.test.mjs`
Expected: FAIL — cannot find module `../adapters/capability-probe.mjs`.

- [ ] **Step 3: Write the probe**

Create `experiments/202606-eval-contract-baseline/adapters/capability-probe.mjs`:

```js
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_ROOTS = ["packages/pi-stack/node_modules", "node_modules"];

/**
 * Build an eval-contract agent that measures whether a capability's declared
 * surface resolves on disk. A task lists its required artifacts in env.artifacts
 * (paths relative to a node_modules root); the probe reports whether all resolve.
 * Deterministic and offline — no Pi import. Absence is data, never a throw.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.roots] - node_modules roots, searched in order
 * @param {string} [opts.cwd] - base dir the roots resolve against
 * @returns {(task: import("../contract/task.mjs").Task) => object}
 */
export function createCapabilityProbe({ roots = DEFAULT_ROOTS, cwd = process.cwd() } = {}) {
  return (task) => {
    const artifacts = task.env?.artifacts ?? [];
    const checked = artifacts.map((rel) => ({
      path: rel,
      found: roots.some((r) => existsSync(join(cwd, r, rel))),
    }));
    // empty surface never counts as a capability (guards a vacuous pass)
    const resolved = checked.length > 0 && checked.every((a) => a.found);
    const foundCount = checked.filter((a) => a.found).length;
    return {
      output: `capability ${task.id}: ${resolved ? "resolved" : "unresolved"} (${foundCount}/${checked.length})`,
      files: {},
      resolved,
      artifacts: checked,
    };
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test experiments/202606-eval-contract-baseline/tests/capability-probe.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Confirm the contract core is still pi-free**

Run: `! grep -rE "earendil|mariozechner|pi-coding-agent" experiments/202606-eval-contract-baseline/contract/`
Expected: exit 0 (no matches).

- [ ] **Step 6: Commit**

```bash
git add experiments/202606-eval-contract-baseline/adapters/capability-probe.mjs experiments/202606-eval-contract-baseline/tests/capability-probe.test.mjs
git commit -m "feat(eval-contract): add capability-resolution probe adapter"
```

---

### Task 2: The three ppw capability tasks + baseline test

**Files:**
- Create: `experiments/202606-eval-contract-baseline/tasks/ppw.mjs`
- Test: `experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runTask } from "../contract/runner.mjs";
import { buildReport } from "../contract/report.mjs";
import { createCapabilityProbe } from "../adapters/capability-probe.mjs";
import { ppwTasks, ppwMonitors, ppwProject, ppwWorkflows } from "../tasks/ppw.mjs";

test("ppwTasks lists the three project-workflows capabilities at T1", () => {
  assert.deepEqual(
    ppwTasks.map((t) => t.id),
    ["ppw-monitors", "ppw-project", "ppw-workflows"],
  );
  for (const task of ppwTasks) {
    assert.equal(task.tier, "T1");
    assert.equal(task.env.owner, "@davidorex/pi-project-workflows");
    assert.ok(Array.isArray(task.env.artifacts) && task.env.artifacts.length >= 2);
  }
});

test("each capability resolves with the dep present (baseline)", async () => {
  const probe = createCapabilityProbe();
  for (const task of [ppwMonitors, ppwProject, ppwWorkflows]) {
    const result = await runTask(task, probe);
    assert.equal(result.passes, 1, `${task.id} should resolve with the dep installed`);
    assert.equal(result.passRate, 1);
  }
});

test("the baseline rolls up as a T1 measurement", async () => {
  const probe = createCapabilityProbe();
  const results = [];
  for (const task of ppwTasks) results.push(await runTask(task, probe));
  const report = buildReport(results, { generatedAtIso: "2026-06-23T00:00:00.000Z" });
  assert.deepEqual(report.summary.byTier.T1, { tasks: 3, passes: 3, attempts: 3 });
  assert.equal(report.summary.passRate, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`
Expected: FAIL — cannot find module `../tasks/ppw.mjs`.

- [ ] **Step 3: Write the tasks**

Create `experiments/202606-eval-contract-baseline/tasks/ppw.mjs`:

```js
import { defineTask } from "../contract/task.mjs";

const OWNER = "@davidorex/pi-project-workflows";
const verifyResolved = (r) => r.resolved === true;

export const ppwMonitors = defineTask({
  id: "ppw-monitors",
  tier: "T1",
  instruction: "Provide the behavior-monitors capability (/monitors: hedge, fragility) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: {
    capability: "monitors",
    owner: OWNER,
    artifacts: [`${OWNER}/monitors-extension.ts`, `${OWNER}/skills/pi-behavior-monitors/SKILL.md`],
  },
});

export const ppwProject = defineTask({
  id: "ppw-project",
  tier: "T1",
  instruction: "Provide the project-blocks capability (.project/ structured blocks) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: {
    capability: "project",
    owner: OWNER,
    artifacts: [`${OWNER}/project-extension.ts`, `${OWNER}/skills/pi-project/SKILL.md`],
  },
});

export const ppwWorkflows = defineTask({
  id: "ppw-workflows",
  tier: "T1",
  instruction: "Provide the workflows capability (workflows YAML execution) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: {
    capability: "workflows",
    owner: OWNER,
    artifacts: [`${OWNER}/workflows-extension.ts`, `${OWNER}/skills/pi-workflows/SKILL.md`],
  },
});

export const ppwTasks = [ppwMonitors, ppwProject, ppwWorkflows];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`
Expected: PASS — 3 tests pass (with `@davidorex/pi-project-workflows` installed).

- [ ] **Step 5: Commit**

```bash
git add experiments/202606-eval-contract-baseline/tasks/ppw.mjs experiments/202606-eval-contract-baseline/tests/ppw.test.mjs
git commit -m "feat(eval-contract): add ppw capability tasks with baseline test"
```

---

### Task 3: README + full-slice verification

**Files:**
- Modify: `experiments/202606-eval-contract-baseline/README.md`

- [ ] **Step 1: Update the README**

First Read `experiments/202606-eval-contract-baseline/README.md`. Add a new `## Tasks` section immediately AFTER the `## Adapters` section (and before `## Run`), with exactly this content:

```markdown
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
```

Leave all other parts of the README unchanged.

- [ ] **Step 2: Run the whole slice via the package script**

Run: `pnpm run test:eval-contract`
Expected: PASS — all tests pass, 0 failures (existing 19 + probe 5 + ppw 3 = 27).

- [ ] **Step 3: Confirm the pi-free fence still holds for the core**

Run: `! grep -rE "earendil|mariozechner|pi-coding-agent" experiments/202606-eval-contract-baseline/contract/`
Expected: exit 0 (no matches in `contract/`).

- [ ] **Step 4: Commit**

```bash
git add experiments/202606-eval-contract-baseline/README.md
git commit -m "docs(eval-contract): document ppw capability tasks and baseline gate"
```

---

## Self-Review

**Spec coverage:** Decision 1 (capability-resolution probe) → Task 1 (`capability-probe.mjs` + 5 unit tests). Decision 2 (three T1 tasks per capability) → Task 2 (`tasks/ppw.mjs` with `ppw-monitors`/`ppw-project`/`ppw-workflows`, each extension + skill). Decision 3 (tasks + probe + CI test as versioned baseline/gate) → Task 2's baseline + rollup tests, documented in Task 3's README. Error handling (absence as data, no-env no-crash) → Task 1 tests 3–4. Wiring (glob, fence, README) → Task 3. All spec sections map to a task.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command and expected counts.

**Type consistency:** The probe return `{ output, files, resolved, artifacts: [{ path, found }] }` (Task 1) matches the `verifyResolved = (r) => r.resolved === true` and `result.artifacts[i].found` reads in the tests (Tasks 1–2). `task.env.artifacts` written in `tasks/ppw.mjs` (Task 2) is exactly what the probe reads via `task.env?.artifacts` (Task 1). `runTask(task, probe)` returns `{ passes, passRate, ... }` (per `contract/runner.mjs`) consumed by Task 2's baseline test, and `buildReport(results).summary.byTier.T1 = { tasks, passes, attempts }` (per `contract/report.mjs`) consumed by the rollup test. Test counts: probe 5, ppw 3, slice total 27 — consistent across Tasks 1–3.
