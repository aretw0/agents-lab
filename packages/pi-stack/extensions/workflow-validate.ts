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
