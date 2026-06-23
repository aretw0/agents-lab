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
