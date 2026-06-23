# @davidorex/pi-project-workflows capability tasks — design

Data: 2026-06-23
Status: design aprovado, pendente de plano de implementação

## Context

The eval-contract baseline (`task` / `runner` / `report`) and the first real
adapter (`agent-pi`) are built and merged under
`experiments/202606-eval-contract-baseline/`. The next step in the
mariozechner-sovereignty convergence
(`docs/superpowers/specs/2026-06-22-mariozechner-sovereignty-eval-convergence.md`,
sequencing steps 2–3) is to author the capability tasks for the default-profile
dep `@davidorex/pi-project-workflows` and capture the "with-dep" baseline — the
"before" evidence that gates dropping or substituting the dep.

### Pivotal finding

The headless Pi driver the `agent-pi` adapter wraps
(`scripts/agent-run-pi-driver-payload.mjs`) builds its run with
`--no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files
--no-session`. `@davidorex/pi-project-workflows` delivers its value **entirely
through Pi's extension/skill surface** (the `/monitors` command + hedge/fragility
monitors, `.project/` blocks, workflows YAML, and 4 bundled skills) — exactly the
surface the driver strips. Therefore a dispatch-based `verify` through `agent-pi`
would pass identically with or without the dep, making it useless as a
sovereignty signal.

The dep's surface resolves deterministically from `node_modules` (verified: all 3
extension files + the skills resolve under `packages/pi-stack/node_modules` or
`node_modules`). The repo already proves these three extensions in
`scripts/verify-pi-stack.mjs` (`baselineChecks`). The eval-contract version turns
that binary check into a tiered, repeatable **measurement** that anchors the
evidence-gated cut.

## Decisions (from brainstorming)

1. **Instrument:** a new **capability-resolution probe** (a sibling adapter to
   `agent-pi`), not the `agent-pi` dispatch path. It resolves a task's declared
   surface from `node_modules`. Deterministic, offline, and dep-sensitive: green
   with the dep, red without it.
2. **Granularity:** **three tasks at tier T1**, one per named capability —
   `ppw-monitors`, `ppw-project`, `ppw-workflows` — each verifying its extension
   file + matching skill resolve. Per-capability so a partial first-party
   substitute can be measured (you might replace monitors but not workflows).
3. **Baseline scope:** ship the probe, the 3 tasks, and a deterministic CI test
   asserting all 3 pass **with the dep present**. The green test is the versioned
   baseline and the gate. A dated report is deferred to cut-time (`buildReport`/
   `writeReport` already exist).

## Architecture

```
experiments/202606-eval-contract-baseline/
  contract/                       (unchanged, pi-free)
  adapters/
    agent-pi.mjs                  (unchanged)
    capability-probe.mjs          ← NEW: createCapabilityProbe({ roots, cwd }) => (task) => result
                                     resolves task.env.artifacts against node_modules. No Pi import (pure fs).
  tasks/                          ← NEW dir (the spec's tasks/ leg)
    ppw.mjs                       ← NEW: the 3 capability tasks (T1) + ppwTasks[]
  tests/
    capability-probe.test.mjs     ← NEW: probe unit tests
    ppw.test.mjs                  ← NEW: the 3 tasks pass via runTask WITH the dep (versioned baseline)
  README.md                       ← MODIFY: add a Tasks section
```

The probe lives in `adapters/` (an alternative measurement instrument, sibling to
`agent-pi`) but imports no runtime — pure `node:fs`/`node:path` — so the pi-free
property is even stronger here than for `agent-pi`.

## Probe interface

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

## Task shape

```js
import { defineTask } from "../contract/task.mjs";

const OWNER = "@davidorex/pi-project-workflows";
const verifyResolved = (r) => r.resolved === true;

export const ppwMonitors = defineTask({
  id: "ppw-monitors", tier: "T1",
  instruction: "Provide the behavior-monitors capability (/monitors: hedge, fragility) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: { capability: "monitors", owner: OWNER,
    artifacts: [`${OWNER}/monitors-extension.ts`, `${OWNER}/skills/pi-behavior-monitors/SKILL.md`] },
});

export const ppwProject = defineTask({
  id: "ppw-project", tier: "T1",
  instruction: "Provide the project-blocks capability (.project/ structured blocks) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: { capability: "project", owner: OWNER,
    artifacts: [`${OWNER}/project-extension.ts`, `${OWNER}/skills/pi-project/SKILL.md`] },
});

export const ppwWorkflows = defineTask({
  id: "ppw-workflows", tier: "T1",
  instruction: "Provide the workflows capability (workflows YAML execution) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: { capability: "workflows", owner: OWNER,
    artifacts: [`${OWNER}/workflows-extension.ts`, `${OWNER}/skills/pi-workflows/SKILL.md`] },
});

export const ppwTasks = [ppwMonitors, ppwProject, ppwWorkflows];
```

The `instruction` documents *what the capability is* (the bar a first-party
substitute must clear); `verify` measures *whether the surface resolves*. `env`
carries the owner + artifact list — a machine-readable record of exactly what the
sovereignty cut must replace.

## Testing

**`tests/capability-probe.test.mjs`** (no dep assumptions — uses paths known to
exist/not-exist):
1. resolves when all artifacts exist (e.g. a `package.json` under a root) ⇒
   `resolved === true`, every `artifacts[].found === true`.
2. unresolved when any artifact is missing (one bogus path) ⇒ `resolved === false`,
   the missing entry `found === false`.
3. empty-artifacts guard — `env.artifacts: []` / absent ⇒ `resolved === false`.
4. partial — some found, some not ⇒ `resolved === false`, `output` shows `n/m`.

**`tests/ppw.test.mjs`** (the versioned baseline — runs against real
`node_modules`, dep present):
5. each of `ppwTasks` passes via `runTask(task, createCapabilityProbe())` ⇒
   `passes: 1, passRate: 1`.
6. report rollup — `buildReport(results).summary.byTier.T1` equals
   `{ tasks: 3, passes: 3, attempts: 3 }`, proving the measurement aggregates.

## Baseline / gate semantics

Test #5 green is the "before" evidence: with `@davidorex/pi-project-workflows`
installed, all three capabilities resolve. It is also the gate — dropping the dep
from `packages/pi-stack/package-list.mjs` turns these tests **red** unless a
first-party substitute resolves the same `env.artifacts` (or the tasks' artifact
lists are repointed at the substitute). The dep only leaves `package-list.mjs`
when these tasks are green without it.

## Error handling

The probe never throws on a missing file (`existsSync` ⇒ `false`); absence is
data (`found: false`), consistent with the adapter's "blocked-as-data" stance. A
malformed task (no `env`) resolves to `false`, not a crash.

## Wiring

`test:eval-contract` already globs `tests/*.test.mjs`, so both new test files are
picked up with no `package.json` change. README gains a `## Tasks` section
describing the three capability tasks and the baseline/gate meaning.

## Verification (how we'll know)

- `pnpm run test:eval-contract` green, including the probe unit tests and the 3
  ppw baseline tests, with no network.
- `grep -rE "earendil|mariozechner|pi-coding-agent"
  experiments/202606-eval-contract-baseline/contract/` returns no matches (core
  stays pi-free; the probe imports no runtime at all).
- The 3 ppw tasks pass via `runTask` with the dep present (baseline recorded as a
  versioned green test), and would fail if the dep's surface were absent.

## Non-goals (now)

- Performing the cut (removing the dep) or building the first-party substitute.
- A dated baseline report artifact (deferred to cut-time; `buildReport`/
  `writeReport` already exist).
- Tasks for the opt-in `@ifi/*` layer (later in the convergence sequencing).
- Live Pi runs of these capabilities (the headless driver strips the surface;
  out of scope by construction).
