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

  const { name, description, version, input, steps } = parsed as Record<string, unknown>;

  if (typeof name !== "string" || name.length === 0) {
    issues.push({ severity: "error", path: "name", message: "name is required and must be a non-empty string" });
  }
  if (input !== undefined && !isPlainObject(input)) {
    issues.push({ severity: "error", path: "input", message: "input must be a mapping" });
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
        continue; // sub-field errors are meaningless when the executor is wrong
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
