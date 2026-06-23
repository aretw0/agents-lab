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
      if (parsed.value !== null && typeof parsed.value === "object") {
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
