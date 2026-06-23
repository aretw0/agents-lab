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
