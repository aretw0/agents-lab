# First-party workflow engine — SP1: the workflow form — design

Data: 2026-06-23
Status: design aprovado, pendente de plano de implementação
Relacionado: `docs/research/0-8-ppw-first-party-coverage-2026-06-23.md`,
`docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`,
`experiments/202606-eval-contract-baseline/tasks/ppw.mjs`

## Context

The first-party coverage investigation found **workflows** is a pure gap: the
lab uses `@davidorex/pi-workflows` (via the umbrella `@davidorex/pi-project-workflows`,
which drags `@mariozechner`) with **no first-party substitute**. The operator
chose to **build a first-party substitute** rather than move the capability to
opt-in.

A full parity engine (YAML DAG execution, typed dataflow, checkpoint/resume,
output-schema validation, reusable agent specs) is too large for one spec, so it
is decomposed into three sub-projects, each its own spec→plan→build cycle:

- **SP1 — the workflow form (this spec):** schema + parser + DAG planner +
  validator, exposing read-only `workflow-list` and `workflow-validate`. Pure,
  deterministic, no agent runtime.
- **SP2 — execution engine:** step executors (`command`/`agent`/`block`) over the
  first-party `agent_run_*` substrate + `${{...}}` templating + typed dataflow →
  the `workflow` run tool.
- **SP3 — advanced surface:** checkpoint/resume, input `source` resolution,
  output-schema validation, `workflow-agents`.

This mirrors how the eval-lab was cultivated — build the form before the runtime.

## Goals (SP1)

- A genuine **first-party, sovereign** workflows *form*: parse, plan (DAG), and
  validate workflow specs, with no `@mariozechner`/`@davidorex` imports.
- Adopt the dep's YAML shape as a documented subset so existing/future specs stay
  portable (true drop-in path for the eventual cut).
- Expose read-only tools `workflow-list` and `workflow-validate`.
- Prove the form resolves first-party via a focused eval task, **without**
  overstating coverage (run is not implemented yet).

## Non-goals (SP1)

- Running workflows (`workflow` tool), `${{...}}` evaluation, `workflow-agents`
  → SP2/SP3.
- Checkpoint/resume, input `source` interactive resolution, output validation
  against bundled JSON schemas → SP3.
- Removing `@davidorex/pi-project-workflows` from the default profile (happens
  after SP2/SP3 deliver run and the gate flips honestly).

## Decisions (from brainstorming)

1. **Approach:** build a first-party substitute (operator choice).
2. **Decomposition:** SP1 = the form first; SP2 execution; SP3 advanced.
3. **Schema fidelity:** adopt the dep's YAML shape as a documented subset
   (portability + drop-in).
4. **Placement:** first-party **pi-stack extension** (sibling to
   `monitor-sovereign.ts`), pure logic in co-located TS modules.
5. **YAML parser:** declare `yaml` (eemeli/yaml, already in the tree, pure,
   sovereign) as a direct pi-stack dependency. pi-stack vendors no parser today.
6. **Eval gate honesty:** add a NEW `ppw-workflows-form` task proving the form
   resolves first-party; keep `ppw-workflows` pointed at the dep until SP2/SP3
   deliver run and the dep is actually cut.

## Architecture & files

```
packages/pi-stack/
  extensions/
    workflow-spec.ts      parseWorkflowSpec(yamlText) -> { ok, spec } | { ok:false, errors }
                          (yaml.parse + TypeBox schema for the adopted subset). Pure.
    workflow-dag.ts       planWorkflow(spec) -> { ok, order, edges } | { ok:false, errors }
                          (ref extraction + topo-sort + cycle/dangling detection). Pure.
    workflow-validate.ts  validateWorkflow(rawYaml) -> structured report. Composes spec + dag. Pure.
    workflow-form.ts      default extension: registers read-only `workflow-list` + `workflow-validate`;
                          discovers .workflows/*.workflow.yaml (+ ~/.pi/agent/workflows/).
  test/smoke/
    workflow-spec.test.ts  workflow-dag.test.ts  workflow-validate.test.ts  workflow-form.test.ts  (vitest)
  package.json            + dependency: "yaml"
packages/pi-skills/skills/
  pi-workflows-sovereign/SKILL.md   first-party skill documenting the form (run = SP2)
experiments/202606-eval-contract-baseline/
  tasks/ppw.mjs           + ppw-workflows-form task (env.artifacts -> first-party form + skill)
  tests/ppw.test.mjs      + assertion that ppw-workflows-form resolves
```

Boundary: every pure module imports only `node:*`, `yaml`, `@sinclair/typebox` —
no `@mariozechner`, no `@davidorex`. This is a genuine sovereign substitute,
sibling to `monitor-sovereign.ts`. Pure-function exports are tested via vitest
`.test.ts` under `test/smoke/`, mirroring `monitor-sovereign-startup-output.test.ts`
and `project-board-surface.test.ts`.

## The form

### Schema (documented subset of the dep's shape)

```
name: string            # required
description?: string
version?: string
input?: { ...JSON-schema object; properties[].source IGNORED in SP1 (SP3) }
steps: { [id: string]: Step }    # required, non-empty
  Step = exactly one executor key:
       { block: ... } | { command: string } | { agent: ... }
       + output?: { format?: "json" | "text" }
refs in string fields: ${{ input.<key> }}, ${{ steps.<id>.output | <filter> }}
```

### `workflow-spec.ts` — parse

```ts
export function parseWorkflowSpec(yamlText: string):
  | { ok: true; spec: WorkflowSpec }
  | { ok: false; errors: Array<{ path: string; message: string }> };
```
`yaml.parse` (catch syntax → one structured error) → TypeBox `Value.Check` /
`Value.Errors` → normalized `WorkflowSpec` or a list of `{ path, message }`.
Never throws; malformed input is data (consistent with the eval probe/adapter).

### `workflow-dag.ts` — plan

```ts
export function planWorkflow(spec: WorkflowSpec):
  | { ok: true; order: string[]; edges: Record<string, string[]> }
  | { ok: false; errors: Array<{ kind: "cycle" | "dangling-step" | "unknown-input"; path: string; message: string }> };
```
Scans each step's `command`/`block`/`agent`/`output` for `${{ steps.<id>.output ... }}`
and `${{ input.<key> ... }}` references by regex (no evaluation in SP1). Builds
edges `step → dependsOn(step)`; validates `input.*` refs against declared input
keys. Topological sort; on failure returns cycle path / dangling step ref /
unknown input ref. Assumes a shape-valid spec (parse runs first).

The reference grammar defined here (`${{ input.x }}`, `${{ steps.id.output | f }}`)
is the SP1/SP2 seam: SP1 proves the graph is sound; SP2 evaluates the same refs
during execution.

### `workflow-validate.ts` — validate (the tool's engine)

```ts
export function validateWorkflow(rawYaml: string): {
  ok: boolean;
  name?: string;
  issues: Array<{ severity: "error" | "warning"; path: string; message: string }>;
};
```
Composes parse + plan. SP1 checks:
- valid YAML; required `name` and non-empty `steps` (error)
- each step has **exactly one** executor key — zero or multiple = error
- `output.format` ∈ {json, text} when present (error otherwise)
- all `${{ steps.X }}` / `${{ input.k }}` refs resolve (error)
- no cycles (error, from `planWorkflow`)
- `agent:` step references a discoverable `*.agent.yaml` (**warning** in SP1;
  `workflow-agents` is SP3)
- unknown top-level keys (warning)

Deferred (SP2/SP3): output-schema validation, template-filter validity, input
`source` resolution.

## Tools (`workflow-form.ts`, read-only)

- `workflow-list` → discover `.workflows/*.workflow.yaml` (+ `~/.pi/agent/workflows/`),
  return `[{ name, description, source }]`.
- `workflow-validate` → run `validateWorkflow` on a named/given spec, return the report.

Registered via the standard `export default function workflowFormExtension(pi: ExtensionAPI)`
pattern (`pi.on(...)` / tool registration), mirroring existing extensions.

## Skill

`packages/pi-skills/skills/pi-workflows-sovereign/SKILL.md` — documents the
sovereign workflows form, the supported subset, and that *run* arrives in SP2.

## Eval gate (honest, two-task)

SP1 does **not** flip `ppw-workflows` or remove the dep (run is unimplemented).
Instead add `ppw-workflows-form` to `tasks/ppw.mjs`, with `env.artifacts`
pointing at the first-party form + skill:

```
artifacts: [
  "<pi-stack extensions root>/workflow-form.ts",
  "<pi-skills skills root>/pi-workflows-sovereign/SKILL.md",
]
```
(The capability probe resolves paths against node_modules roots; the first-party
artifacts are workspace files, so the new task may use a dedicated probe `cwd`/
`roots` anchored at the repo root — same anchoring the baseline already uses — or
a small first-party-root variant. The plan pins the exact resolution.)

`ppw-workflows` stays pointed at the dep. Net: the baseline truthfully reports
"workflows form is first-party; full capability still dep-backed."

## Testing

vitest `.test.ts` under `packages/pi-stack/test/smoke/`:
- `workflow-spec`: valid spec parses to normalized shape; bad YAML → single error;
  missing `name`/`steps`; step with two executors and step with zero executors.
- `workflow-dag`: linear order; diamond DAG order; cycle detected (path reported);
  dangling step ref; unknown input ref.
- `workflow-validate`: aggregates into a report; happy path `ok:true`, no issues;
  agent-ref-missing → warning; multiple-executor → error.
- `workflow-form`: discovery over a tmp `.workflows/` (write fixtures, tmp-dir
  style from `project-board-surface.test.ts`); `workflow-list` shape;
  `workflow-validate` tool on a fixture spec.

Plus the eval-contract assertion that `ppw-workflows-form` resolves
(`experiments/202606-eval-contract-baseline/tests/ppw.test.mjs`).

## Verification (how we'll know)

- `pnpm exec vitest run packages/pi-stack/test/smoke/workflow-*.test.ts` green.
- `pnpm run test:eval-contract` green, including the new `ppw-workflows-form`
  resolution.
- No `@mariozechner`/`@davidorex` import in any `workflow-*.ts`
  (grep clean).
- `workflow-validate` correctly flags a hand-written bad spec (cycle / dangling
  ref / multi-executor) and passes a good one.
