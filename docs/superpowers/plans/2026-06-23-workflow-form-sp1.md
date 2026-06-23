# Workflow form (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-party, sovereign workflow *form* — pure schema/parser/DAG/validator modules plus a read-only `workflow-form` pi-stack extension (`workflow_list`/`workflow_validate`) — and prove it resolves first-party via a focused eval task, without removing the dep.

**Architecture:** Pure TS modules in `packages/pi-stack/extensions/` (`workflow-spec` normalize, `workflow-dag` plan, `workflow-validate` compose) operate on already-parsed objects so they need no YAML and are unit-tested in isolation (vitest). A single tiny `workflow-yaml` helper isolates the `yaml` dependency. A thin `workflow-form` extension wires discovery + the two read-only tools. The eval gate gets a new `ppw-workflows-form` task (honest: form resolves first-party while `ppw-workflows` stays on the dep).

**Tech Stack:** TypeScript (pi-stack extensions), `@sinclair/typebox` (+ `/value`), `yaml` (eemeli, new direct dep), vitest (`packages/pi-stack/test/smoke/*.test.ts`); eval gate in Node ESM (`node:test`) under the eval-contract experiment.

Design: `docs/superpowers/specs/2026-06-23-workflow-form-sp1-design.md`.

---

## File Structure

- `packages/pi-stack/extensions/workflow-spec.ts` — CREATE: types + `normalizeWorkflowSpec(parsed)`. Pure; no fs, no yaml.
- `packages/pi-stack/extensions/workflow-dag.ts` — CREATE: `planWorkflow(spec)` (ref extraction + topo-sort + cycle/dangling/unknown-input). Pure.
- `packages/pi-stack/extensions/workflow-validate.ts` — CREATE: `validateSpec(parsed)` composing normalize + plan. Pure.
- `packages/pi-stack/extensions/workflow-yaml.ts` — CREATE: `parseWorkflowYaml(text)` — the ONLY file importing `yaml`.
- `packages/pi-stack/extensions/workflow-form.ts` — CREATE: extension; `listWorkflows(roots)` + `workflow_list`/`workflow_validate` tools.
- `packages/pi-stack/test/smoke/workflow-{spec,dag,validate,yaml,form}.test.ts` — CREATE: vitest tests.
- `packages/pi-stack/package.json` — MODIFY: add `"yaml"` dependency.
- `packages/pi-skills/skills/pi-workflows-sovereign/SKILL.md` — CREATE: first-party skill.
- `experiments/202606-eval-contract-baseline/tasks/ppw.mjs` — MODIFY: add `ppwWorkflowsForm` (separate export, NOT in `ppwTasks`).
- `experiments/202606-eval-contract-baseline/tests/ppw.test.mjs` — MODIFY: assert `ppwWorkflowsForm` resolves first-party.
- `packages/pi-stack/install.mjs` — MODIFY (Task 7): add `workflow-form.ts` to the control-plane excludes, mirroring `monitor-sovereign.ts`.

Shared `Issue` type: `{ severity: "error" | "warning"; path: string; message: string }`, exported from `workflow-spec.ts` and reused everywhere.

---

### Task 1: workflow-spec — normalize a parsed object

**Files:**
- Create: `packages/pi-stack/extensions/workflow-spec.ts`
- Test: `packages/pi-stack/test/smoke/workflow-spec.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pi-stack/test/smoke/workflow-spec.test.ts
import { describe, expect, it } from "vitest";
import { normalizeWorkflowSpec } from "../../extensions/workflow-spec";

const good = {
  name: "demo",
  description: "d",
  steps: { a: { command: "echo hi", output: { format: "json" } }, b: { block: { read: "issues" } } },
};

describe("normalizeWorkflowSpec", () => {
  it("accepts a valid spec and returns the normalized object", () => {
    const r = normalizeWorkflowSpec(good);
    expect(r.spec?.name).toBe("demo");
    expect(Object.keys(r.spec?.steps ?? {})).toEqual(["a", "b"]);
    expect(r.issues).toEqual([]);
  });

  it("errors when name is missing or empty", () => {
    const r = normalizeWorkflowSpec({ steps: { a: { command: "x" } } });
    expect(r.spec).toBeNull();
    expect(r.issues).toContainEqual({ severity: "error", path: "name", message: "name is required and must be a non-empty string" });
  });

  it("errors when steps is missing or empty", () => {
    const r = normalizeWorkflowSpec({ name: "x", steps: {} });
    expect(r.issues.some((i) => i.path === "steps" && i.severity === "error")).toBe(true);
  });

  it("errors when a step has zero or multiple executors", () => {
    const none = normalizeWorkflowSpec({ name: "x", steps: { a: { output: { format: "json" } } } });
    expect(none.issues).toContainEqual({ severity: "error", path: "steps.a", message: "step must have exactly one of: block, command, agent" });
    const many = normalizeWorkflowSpec({ name: "x", steps: { a: { command: "x", block: {} } } });
    expect(many.issues).toContainEqual({ severity: "error", path: "steps.a", message: "step must have exactly one of: block, command, agent" });
  });

  it("errors on a non-string command and a bad output.format", () => {
    const r = normalizeWorkflowSpec({ name: "x", steps: { a: { command: 5 }, b: { command: "y", output: { format: "xml" } } } });
    expect(r.issues).toContainEqual({ severity: "error", path: "steps.a.command", message: "command must be a string" });
    expect(r.issues).toContainEqual({ severity: "error", path: "steps.b.output.format", message: "output.format must be 'json' or 'text'" });
  });

  it("warns on an unknown top-level key", () => {
    const r = normalizeWorkflowSpec({ name: "x", steps: { a: { command: "y" } }, bogus: 1 });
    expect(r.issues).toContainEqual({ severity: "warning", path: "bogus", message: "unknown top-level key" });
    expect(r.spec?.name).toBe("x"); // warning does not block normalization
  });

  it("errors when the root is not an object", () => {
    expect(normalizeWorkflowSpec(null).issues.some((i) => i.path === "")).toBe(true);
    expect(normalizeWorkflowSpec([]).issues.some((i) => i.path === "")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-spec.test.ts`
Expected: FAIL — cannot resolve `../../extensions/workflow-spec`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/pi-stack/extensions/workflow-spec.ts

export interface Issue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface WorkflowStep {
  block?: unknown;
  command?: string;
  agent?: unknown;
  output?: { format?: "json" | "text" };
}

export interface WorkflowSpec {
  name: string;
  description?: string;
  version?: string;
  input?: Record<string, unknown>;
  steps: Record<string, WorkflowStep>;
}

const TOP_LEVEL_KEYS = new Set(["name", "description", "version", "input", "steps"]);
const EXECUTOR_KEYS = ["block", "command", "agent"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate + normalize an already-parsed workflow object. Pure; never throws. */
export function normalizeWorkflowSpec(parsed: unknown): { spec: WorkflowSpec | null; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isPlainObject(parsed)) {
    return { spec: null, issues: [{ severity: "error", path: "", message: "workflow must be a mapping" }] };
  }

  const { name, description, version, steps } = parsed as Record<string, unknown>;

  if (typeof name !== "string" || name.length === 0) {
    issues.push({ severity: "error", path: "name", message: "name is required and must be a non-empty string" });
  }
  if (description !== undefined && typeof description !== "string") {
    issues.push({ severity: "error", path: "description", message: "description must be a string" });
  }
  if (version !== undefined && typeof version !== "string") {
    issues.push({ severity: "error", path: "version", message: "version must be a string" });
  }

  if (!isPlainObject(steps) || Object.keys(steps).length === 0) {
    issues.push({ severity: "error", path: "steps", message: "steps is required and must be a non-empty mapping" });
  } else {
    for (const [id, rawStep] of Object.entries(steps)) {
      if (!isPlainObject(rawStep)) {
        issues.push({ severity: "error", path: `steps.${id}`, message: "step must be a mapping" });
        continue;
      }
      const present = EXECUTOR_KEYS.filter((k) => k in rawStep);
      if (present.length !== 1) {
        issues.push({ severity: "error", path: `steps.${id}`, message: "step must have exactly one of: block, command, agent" });
      }
      if ("command" in rawStep && typeof rawStep.command !== "string") {
        issues.push({ severity: "error", path: `steps.${id}.command`, message: "command must be a string" });
      }
      const output = rawStep.output;
      if (output !== undefined) {
        if (!isPlainObject(output)) {
          issues.push({ severity: "error", path: `steps.${id}.output`, message: "output must be a mapping" });
        } else if (output.format !== undefined && output.format !== "json" && output.format !== "text") {
          issues.push({ severity: "error", path: `steps.${id}.output.format`, message: "output.format must be 'json' or 'text'" });
        }
      }
    }
  }

  for (const key of Object.keys(parsed)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      issues.push({ severity: "warning", path: key, message: "unknown top-level key" });
    }
  }

  const hasError = issues.some((i) => i.severity === "error");
  if (hasError) return { spec: null, issues };
  return { spec: parsed as unknown as WorkflowSpec, issues };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-spec.test.ts`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-stack/extensions/workflow-spec.ts packages/pi-stack/test/smoke/workflow-spec.test.ts
git commit -m "feat(workflow): add workflow-spec normalizer (SP1)"
```

---

### Task 2: workflow-dag — plan the step graph

**Files:**
- Create: `packages/pi-stack/extensions/workflow-dag.ts`
- Test: `packages/pi-stack/test/smoke/workflow-dag.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pi-stack/test/smoke/workflow-dag.test.ts
import { describe, expect, it } from "vitest";
import { planWorkflow } from "../../extensions/workflow-dag";
import type { WorkflowSpec } from "../../extensions/workflow-spec";

const spec = (steps: WorkflowSpec["steps"], input?: WorkflowSpec["input"]): WorkflowSpec => ({ name: "w", steps, input });

describe("planWorkflow", () => {
  it("orders a linear chain by dependency", () => {
    const r = planWorkflow(spec({
      a: { command: "echo a" },
      b: { command: "echo ${{ steps.a.output }}" },
    }));
    expect(r.order).toEqual(["a", "b"]);
    expect(r.issues).toEqual([]);
  });

  it("orders a diamond (a -> b,c -> d)", () => {
    const r = planWorkflow(spec({
      a: { command: "echo a" },
      b: { command: "echo ${{ steps.a.output }}" },
      c: { command: "echo ${{ steps.a.output }}" },
      d: { command: "echo ${{ steps.b.output }} ${{ steps.c.output }}" },
    }));
    expect(r.order?.[0]).toBe("a");
    expect(r.order?.[3]).toBe("d");
    expect(new Set(r.order)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("detects a cycle", () => {
    const r = planWorkflow(spec({
      a: { command: "echo ${{ steps.b.output }}" },
      b: { command: "echo ${{ steps.a.output }}" },
    }));
    expect(r.order).toBeNull();
    expect(r.issues.some((i) => i.message.includes("cycle"))).toBe(true);
  });

  it("flags a dangling step reference", () => {
    const r = planWorkflow(spec({ a: { command: "echo ${{ steps.missing.output }}" } }));
    expect(r.issues).toContainEqual({ severity: "error", path: "steps.a", message: "references unknown step 'missing'" });
  });

  it("flags an unknown input reference and accepts a declared one", () => {
    const declared = planWorkflow(spec({ a: { command: "echo ${{ input.gap_id }}" } }, { properties: { gap_id: {} } }));
    expect(declared.issues).toEqual([]);
    const unknown = planWorkflow(spec({ a: { command: "echo ${{ input.nope }}" } }, { properties: { gap_id: {} } }));
    expect(unknown.issues).toContainEqual({ severity: "error", path: "steps.a", message: "references unknown input 'nope'" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-dag.test.ts`
Expected: FAIL — cannot resolve `../../extensions/workflow-dag`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/pi-stack/extensions/workflow-dag.ts
import type { Issue, WorkflowSpec } from "./workflow-spec";

const STEP_REF = /\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.output/g;
const INPUT_REF = /\$\{\{\s*input\.([A-Za-z0-9_-]+)/g;

function refsIn(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

/** Build the step dependency graph and topologically order it. Pure; assumes a normalized spec. */
export function planWorkflow(spec: WorkflowSpec): { order: string[] | null; edges: Record<string, string[]>; issues: Issue[] } {
  const issues: Issue[] = [];
  const stepIds = Object.keys(spec.steps);
  const inputKeys = new Set(Object.keys((spec.input?.properties as Record<string, unknown> | undefined) ?? {}));
  const edges: Record<string, string[]> = {};

  for (const id of stepIds) {
    const serialized = JSON.stringify(spec.steps[id] ?? {});
    const stepRefs = [...new Set(refsIn(serialized, STEP_REF))];
    for (const ref of stepRefs) {
      if (!spec.steps[ref]) {
        issues.push({ severity: "error", path: `steps.${id}`, message: `references unknown step '${ref}'` });
      }
    }
    for (const ref of new Set(refsIn(serialized, INPUT_REF))) {
      if (!inputKeys.has(ref)) {
        issues.push({ severity: "error", path: `steps.${id}`, message: `references unknown input '${ref}'` });
      }
    }
    edges[id] = stepRefs.filter((ref) => Boolean(spec.steps[ref]));
  }

  if (issues.some((i) => i.severity === "error")) return { order: null, edges, issues };

  // Kahn's algorithm; remaining nodes after draining => cycle.
  const indegree = new Map(stepIds.map((id) => [id, 0]));
  for (const id of stepIds) for (const _dep of edges[id]) indegree.set(id, (indegree.get(id) ?? 0) + 1);
  const queue = stepIds.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const other of stepIds) {
      if (edges[other].includes(id)) {
        indegree.set(other, (indegree.get(other) ?? 0) - 1);
        if ((indegree.get(other) ?? 0) === 0) {
          queue.push(other);
          queue.sort();
        }
      }
    }
  }
  if (order.length !== stepIds.length) {
    const inCycle = stepIds.filter((id) => !order.includes(id)).sort();
    return { order: null, edges, issues: [{ severity: "error", path: "steps", message: `dependency cycle among: ${inCycle.join(", ")}` }] };
  }
  return { order, edges, issues };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-dag.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-stack/extensions/workflow-dag.ts packages/pi-stack/test/smoke/workflow-dag.test.ts
git commit -m "feat(workflow): add workflow-dag planner (SP1)"
```

---

### Task 3: workflow-validate — compose into a report

**Files:**
- Create: `packages/pi-stack/extensions/workflow-validate.ts`
- Test: `packages/pi-stack/test/smoke/workflow-validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pi-stack/test/smoke/workflow-validate.test.ts
import { describe, expect, it } from "vitest";
import { validateSpec } from "../../extensions/workflow-validate";

describe("validateSpec", () => {
  it("reports ok with the name for a valid spec", () => {
    const r = validateSpec({ name: "demo", steps: { a: { command: "echo a" }, b: { command: "echo ${{ steps.a.output }}" } } });
    expect(r.ok).toBe(true);
    expect(r.name).toBe("demo");
    expect(r.issues).toEqual([]);
  });

  it("is not ok and surfaces spec errors", () => {
    const r = validateSpec({ steps: {} });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "name")).toBe(true);
  });

  it("surfaces dag errors (cycle) for a shape-valid spec", () => {
    const r = validateSpec({ name: "w", steps: { a: { command: "${{ steps.b.output }}" }, b: { command: "${{ steps.a.output }}" } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("cycle"))).toBe(true);
  });

  it("keeps warnings but stays ok", () => {
    const r = validateSpec({ name: "w", steps: { a: { command: "x" } }, bogus: 1 });
    expect(r.ok).toBe(true);
    expect(r.issues).toContainEqual({ severity: "warning", path: "bogus", message: "unknown top-level key" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-validate.test.ts`
Expected: FAIL — cannot resolve `../../extensions/workflow-validate`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/pi-stack/extensions/workflow-validate.ts
import { normalizeWorkflowSpec, type Issue } from "./workflow-spec";
import { planWorkflow } from "./workflow-dag";

export interface WorkflowReport {
  ok: boolean;
  name?: string;
  issues: Issue[];
}

/** Validate an already-parsed workflow object: shape (normalize) + graph (plan). Pure. */
export function validateSpec(parsed: unknown): WorkflowReport {
  const { spec, issues } = normalizeWorkflowSpec(parsed);
  if (!spec) return { ok: false, issues };
  const plan = planWorkflow(spec);
  const all = [...issues, ...plan.issues];
  return { ok: !all.some((i) => i.severity === "error"), name: spec.name, issues: all };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-validate.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-stack/extensions/workflow-validate.ts packages/pi-stack/test/smoke/workflow-validate.test.ts
git commit -m "feat(workflow): add workflow-validate composer (SP1)"
```

---

### Task 4: yaml dependency + parse helper

**Files:**
- Modify: `packages/pi-stack/package.json`
- Create: `packages/pi-stack/extensions/workflow-yaml.ts`
- Test: `packages/pi-stack/test/smoke/workflow-yaml.test.ts`

- [ ] **Step 1: Add the `yaml` dependency**

In `packages/pi-stack/package.json`, add to the `dependencies` object (keep alphabetical near `@sinclair/typebox`):

```json
"yaml": "^2.9.0",
```

- [ ] **Step 2: Install (links from the local store; offline-safe — yaml@2.9.0 is already in `node_modules/.pnpm`)**

Run: `pnpm install`
Expected: completes; `node -e "require.resolve('yaml', { paths: ['packages/pi-stack'] })"` prints a path.
If `pnpm install` fails due to network/registry, run `pnpm install --offline` (the version is already in the store). If it still fails, report BLOCKED with the error — do not hand-roll a YAML parser.

- [ ] **Step 3: Write the failing test**

```ts
// packages/pi-stack/test/smoke/workflow-yaml.test.ts
import { describe, expect, it } from "vitest";
import { parseWorkflowYaml } from "../../extensions/workflow-yaml";

describe("parseWorkflowYaml", () => {
  it("parses valid YAML into an object", () => {
    const r = parseWorkflowYaml("name: demo\nsteps:\n  a:\n    command: echo hi\n");
    expect(r.issues).toEqual([]);
    expect((r.value as { name: string }).name).toBe("demo");
  });

  it("returns a structured error on malformed YAML, never throws", () => {
    const r = parseWorkflowYaml("name: : :\n  - broken\n: bad");
    expect(r.value).toBeNull();
    expect(r.issues[0]?.severity).toBe("error");
    expect(r.issues[0]?.message).toMatch(/YAML/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-yaml.test.ts`
Expected: FAIL — cannot resolve `../../extensions/workflow-yaml`.

- [ ] **Step 5: Write the implementation**

```ts
// packages/pi-stack/extensions/workflow-yaml.ts
import YAML from "yaml";
import type { Issue } from "./workflow-spec";

/** Parse YAML text into a JS value. The only module that imports `yaml`. Never throws. */
export function parseWorkflowYaml(text: string): { value: unknown; issues: Issue[] } {
  try {
    const value = YAML.parse(text);
    return { value: value ?? null, issues: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: null, issues: [{ severity: "error", path: "", message: `YAML parse error: ${message}` }] };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-yaml.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/pi-stack/package.json pnpm-lock.yaml packages/pi-stack/extensions/workflow-yaml.ts packages/pi-stack/test/smoke/workflow-yaml.test.ts
git commit -m "feat(workflow): add yaml dep and parse helper (SP1)"
```

---

### Task 5: workflow-form extension (discovery + read-only tools)

**Files:**
- Create: `packages/pi-stack/extensions/workflow-form.ts`
- Test: `packages/pi-stack/test/smoke/workflow-form.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pi-stack/test/smoke/workflow-form.test.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listWorkflows } from "../../extensions/workflow-form";

function withWorkflows(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "wf-"));
  try {
    mkdirSync(join(root, ".workflows"), { recursive: true });
    writeFileSync(join(root, ".workflows", "demo.workflow.yaml"), "name: demo\ndescription: a demo\nsteps:\n  a:\n    command: echo hi\n");
    writeFileSync(join(root, ".workflows", "bad.workflow.yaml"), "name: : :\n");
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("listWorkflows", () => {
  it("discovers *.workflow.yaml under a root and reports name + description", () => {
    withWorkflows((root) => {
      const found = listWorkflows([join(root, ".workflows")]);
      const demo = found.find((w) => w.name === "demo");
      expect(demo).toBeTruthy();
      expect(demo?.description).toBe("a demo");
      expect(demo?.source).toContain("demo.workflow.yaml");
    });
  });

  it("lists a malformed spec by filename without throwing", () => {
    withWorkflows((root) => {
      const found = listWorkflows([join(root, ".workflows")]);
      expect(found.some((w) => w.source.endsWith("bad.workflow.yaml"))).toBe(true);
    });
  });

  it("returns [] for a missing directory", () => {
    expect(listWorkflows([join(tmpdir(), "does-not-exist-xyz")])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-form.test.ts`
Expected: FAIL — cannot resolve `../../extensions/workflow-form`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/pi-stack/extensions/workflow-form.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { parseWorkflowYaml } from "./workflow-yaml";
import { validateSpec } from "./workflow-validate";

export interface WorkflowListEntry {
  name: string;
  description?: string;
  source: string;
}

/** Discover *.workflow.yaml under the given directories. Pure-ish (fs read only); never throws. */
export function listWorkflows(dirs: string[]): WorkflowListEntry[] {
  const entries: WorkflowListEntry[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".workflow.yaml")) continue;
      const source = join(dir, file);
      let name = file.replace(/\.workflow\.yaml$/, "");
      let description: string | undefined;
      const parsed = parseWorkflowYaml(readFileSync(source, "utf8"));
      if (parsed.value && typeof parsed.value === "object") {
        const obj = parsed.value as Record<string, unknown>;
        if (typeof obj.name === "string" && obj.name.length > 0) name = obj.name;
        if (typeof obj.description === "string") description = obj.description;
      }
      entries.push({ name, description, source });
    }
  }
  return entries;
}

function workflowDirs(cwd: string): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const dirs = [join(cwd, ".workflows")];
  if (home) dirs.push(join(home, ".pi", "agent", "workflows"));
  return dirs;
}

/** First-party workflows form: read-only list + validate tools. Run arrives in SP2. */
export default function workflowFormExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "workflow_list",
    label: "Workflow List",
    description: "List available first-party workflows (name, description, source). Read-only.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      return { workflows: listWorkflows(workflowDirs(ctx.cwd)) };
    },
  });

  pi.registerTool({
    name: "workflow_validate",
    label: "Workflow Validate",
    description: "Validate a workflow spec by name (form-level: shape + DAG). Read-only.",
    parameters: Type.Object({ workflow: Type.String({ description: "Workflow name to validate." }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { workflow } = params as { workflow: string };
      const match = listWorkflows(workflowDirs(ctx.cwd)).find((w) => w.name === workflow);
      if (!match) return { ok: false, issues: [{ severity: "error", path: "workflow", message: `workflow '${workflow}' not found` }] };
      const parsed = parseWorkflowYaml(readFileSync(match.source, "utf8"));
      if (parsed.value === null) return { ok: false, name: workflow, issues: parsed.issues };
      return validateSpec(parsed.value);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-form.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-stack/extensions/workflow-form.ts packages/pi-stack/test/smoke/workflow-form.test.ts
git commit -m "feat(workflow): add workflow-form extension with list/validate tools (SP1)"
```

---

### Task 6: skill + eval gate (ppw-workflows-form)

**Files:**
- Create: `packages/pi-skills/skills/pi-workflows-sovereign/SKILL.md`
- Modify: `experiments/202606-eval-contract-baseline/tasks/ppw.mjs`
- Modify: `experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`

- [ ] **Step 1: Write the skill**

Create `packages/pi-skills/skills/pi-workflows-sovereign/SKILL.md`:

```markdown
---
name: pi-workflows-sovereign
description: >
  First-party, sovereign workflows form — author, list, and validate multi-step
  workflow specs (YAML, DAG of block/command/agent steps with typed I/O). Use when
  writing or checking .workflows/*.workflow.yaml. Execution (running workflows) is
  delivered by SP2; this slice provides the form (workflow_list, workflow_validate).
---

# pi-workflows-sovereign (form)

A first-party replacement for the workflows surface of `@davidorex/pi-workflows`,
with no `@mariozechner`/`@davidorex` dependency.

## Supported subset
- `name` (required), `description?`, `version?`
- `input?` — JSON-schema object (interactive `source` ignored at the form level)
- `steps` — mapping of `<id>` to exactly one of `block` | `command` | `agent`,
  with optional `output: { format: json | text }`
- references: `${{ input.<key> }}`, `${{ steps.<id>.output | <filter> }}`

## Tools
- `workflow_list` — discover `.workflows/*.workflow.yaml` (+ `~/.pi/agent/workflows/`).
- `workflow_validate <name>` — shape + DAG validation (cycles, dangling/unknown refs,
  executor-count, output.format).

## Not yet (SP2/SP3)
Running workflows, `${{...}}` evaluation, `workflow_agents`, checkpoint/resume,
input `source` resolution, output-schema validation.
```

- [ ] **Step 2: Write the failing eval test**

In `experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`, add this import alongside the existing `ppwTasks` import:

```js
import { ppwWorkflowsForm } from "../tasks/ppw.mjs";
```

And add this test at the end of the file:

```js
test("the first-party workflows form resolves (ppw-workflows-form)", async () => {
  const firstPartyProbe = createCapabilityProbe({ roots: ["."], cwd: repoRoot });
  const result = await runTask(ppwWorkflowsForm, firstPartyProbe);
  assert.equal(result.passes, 1, "first-party workflow form + skill should resolve");
  assert.equal(result.passRate, 1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`
Expected: FAIL — `ppwWorkflowsForm` is not exported from `../tasks/ppw.mjs`.

- [ ] **Step 4: Add the task**

In `experiments/202606-eval-contract-baseline/tasks/ppw.mjs`, append (do NOT add it to the `ppwTasks` array — that array stays the three dep-backed capabilities):

```js
// First-party workflows form (SP1). Artifacts are workspace files (repo-root-relative),
// so this task is probed with roots ["."] + cwd=repoRoot, not the node_modules roots.
// It proves the form is first-party; ppw-workflows stays dep-backed until run lands (SP2/SP3).
export const ppwWorkflowsForm = defineTask({
  id: "ppw-workflows-form",
  tier: "T1",
  instruction: "Provide the workflows form (list/validate YAML specs) as a first-party Pi extension + skill.",
  verify: verifyResolved,
  env: {
    capability: "workflows-form",
    owner: "@aretw0/pi-stack",
    artifacts: [
      "packages/pi-stack/extensions/workflow-form.ts",
      "packages/pi-skills/skills/pi-workflows-sovereign/SKILL.md",
    ],
  },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`
Expected: PASS — the existing ppw tests plus the new first-party-form test pass.

- [ ] **Step 6: Commit**

```bash
git add packages/pi-skills/skills/pi-workflows-sovereign/SKILL.md experiments/202606-eval-contract-baseline/tasks/ppw.mjs experiments/202606-eval-contract-baseline/tests/ppw.test.mjs
git commit -m "feat(workflow): add sovereign skill and ppw-workflows-form eval gate (SP1)"
```

---

### Task 7: integration — keep audits green + full-slice verification

**Files:**
- Modify: `packages/pi-stack/install.mjs`

- [ ] **Step 1: Mirror monitor-sovereign — exclude workflow-form from the curated runtime**

In `packages/pi-stack/install.mjs`, in the `PI_STACK_CONTROL_PLANE_EXTENSION_EXCLUDES` array (the block that already lists `"!extensions/monitor-sovereign.ts"`), add a sibling line:

```js
  "!extensions/workflow-form.ts",
```

Rationale: like `monitor-sovereign`, the workflows form is a first-party sovereign substitute that is not yet activated in the default strict-curated runtime (activation happens at the cut, after SP2/SP3). Excluding it keeps the curated profile unchanged in this slice.

- [ ] **Step 2: Run the workflow unit tests**

Run: `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-spec.test.ts packages/pi-stack/test/smoke/workflow-dag.test.ts packages/pi-stack/test/smoke/workflow-validate.test.ts packages/pi-stack/test/smoke/workflow-yaml.test.ts packages/pi-stack/test/smoke/workflow-form.test.ts`
Expected: PASS — 21 tests (7 spec + 5 dag + 4 validate + 2 yaml + 3 form).

- [ ] **Step 3: Run the eval-contract slice**

Run: `pnpm run test:eval-contract`
Expected: PASS — 0 failures (the existing eval tests plus the new `ppw-workflows-form` resolution).

- [ ] **Step 4: Confirm sovereignty of the new code**

Run: `! grep -rE "earendil|mariozechner|@davidorex" packages/pi-stack/extensions/workflow-spec.ts packages/pi-stack/extensions/workflow-dag.ts packages/pi-stack/extensions/workflow-validate.ts packages/pi-stack/extensions/workflow-yaml.ts`
Expected: exit 0 — the pure form modules import no runtime/fork. (`workflow-form.ts` legitimately imports the first-party `@earendil-works` ExtensionAPI type, so it is intentionally excluded from this grep.)

- [ ] **Step 5: Run the curation + user-surface audits; register the extension if flagged**

Run: `pnpm run pi-stack:user-surface` and `pnpm exec vitest run packages/pi-stack/test/smoke/curation-coverage.test.ts packages/pi-stack/test/smoke/manifest-integrity.test.ts`
Expected: PASS. If an audit flags `workflow-form` as an unaccounted/`needs-decision` extension, register it exactly the way `monitor-sovereign` is registered: inspect how `monitor-sovereign` appears in the curation-coverage records / data the failing test reads (`packages/pi-stack/extensions/curation-coverage.ts` and its test fixtures) and add an equivalent record for `workflow-form` with the same `suppress-by-filter` strategy (it is filtered by the Step-1 exclude). Re-run the audit to confirm green. If the audit demands something beyond mirroring monitor-sovereign, STOP and report it rather than guessing.

- [ ] **Step 6: Commit**

```bash
git add packages/pi-stack/install.mjs
git commit -m "chore(workflow): exclude workflow-form from curated runtime, mirror monitor-sovereign (SP1)"
```

---

## Self-Review

**Spec coverage:** Decision 3 (adopt dep's shape as subset) → Task 1 schema. Decision 4 (pi-stack extension, pure co-located modules) → Tasks 1–5 in `packages/pi-stack/extensions/`. Decision 5 (`yaml` dep, isolated) → Task 4 (single importer `workflow-yaml.ts`). Decision 6 (honest two-task gate) → Task 6 (`ppw-workflows-form` separate export, `ppw-workflows` untouched). Form schema/parser/DAG/validator → Tasks 1–3. Read-only `workflow_list`/`workflow_validate` tools + discovery → Task 5. Skill → Task 6. Testing (vitest smoke) → every task. Boundary + audits + verification → Task 7. Non-goals (run/templating-eval/workflow_agents/checkpoint) are absent by construction.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command and expected counts. Task 7 Step 5's "register if flagged" names the exact precedent (monitor-sovereign), the exact files, and a STOP-and-report fallback — it is a concrete mirror instruction, not an open-ended placeholder.

**Type consistency:** The shared `Issue` type `{ severity, path, message }` is defined in `workflow-spec.ts` (Task 1) and imported by `workflow-dag.ts` (Task 2), `workflow-validate.ts` (Task 3), and `workflow-yaml.ts` (Task 4). `WorkflowSpec`/`WorkflowStep` (Task 1) are consumed by `planWorkflow` (Task 2). `normalizeWorkflowSpec` → `{ spec, issues }` and `planWorkflow` → `{ order, edges, issues }` are exactly what `validateSpec` composes (Task 3). `validateSpec(parsed)` and `parseWorkflowYaml(text)` are what `workflow-form.ts` calls (Task 5). `verifyResolved` and `defineTask` reused by `ppwWorkflowsForm` (Task 6) already exist in `tasks/ppw.mjs`; `createCapabilityProbe({ roots, cwd })` and `repoRoot` already exist in `ppw.test.mjs`. Tool names `workflow_list`/`workflow_validate` (snake_case) are consistent between Task 5 code and the Task 6 skill doc.
