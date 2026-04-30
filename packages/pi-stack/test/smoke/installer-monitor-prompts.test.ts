import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const installModule = await import("../../install.mjs");
const {
  applyMonitorClassifierPromptPatches,
  planMonitorClassifierPromptPatches,
  patchMonitorAgentPromptText,
  patchMonitorClassifyTemplateText,
} = installModule;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-monitor-prompts-"));
  roots.push(root);
  return root;
}

describe("installer monitor prompt patches", () => {
  it("bridges classifier agent system prompt to classify_verdict tool-call contract", () => {
    const input = [
      "prompt:",
      "  system: |-",
      "    You are a behavior monitor classifier.",
      "    Return your decision by calling classify_verdict exactly once.",
      "    Use CLEAN when no issue is found; FLAG/NEW require a short description.",
    ].join("\n");

    const result = patchMonitorAgentPromptText(input);

    expect(result.changed).toBe(true);
    expect(result.text).toContain("interpret that JSON shape as the classify_verdict arguments");
    expect(patchMonitorAgentPromptText(result.text).changed).toBe(false);
  });

  it("patches monitor classify templates away from raw JSON responses", () => {
    const input = [
      "Check the work.",
      "",
      "Respond with a JSON object:",
      "- {\"verdict\": \"CLEAN\"}",
    ].join("\n");

    const result = patchMonitorClassifyTemplateText(input);

    expect(result.changed).toBe(true);
    expect(result.text).toContain("Call classify_verdict exactly once with:");
    expect(result.text).toContain("Do not answer with plain text or raw JSON outside the tool call.");
  });

  it("applies patches to existing config-root agents and monitor templates", () => {
    const root = tempRoot();
    const agents = join(root, "agents");
    const monitor = join(root, "monitors", "commit-hygiene");
    mkdirSync(agents, { recursive: true });
    mkdirSync(monitor, { recursive: true });

    const agentPath = join(agents, "commit-hygiene-classifier.agent.yaml");
    const templatePath = join(monitor, "classify.md");
    writeFileSync(agentPath, "    Return your decision by calling classify_verdict exactly once.\n    Use CLEAN when no issue is found.\n");
    writeFileSync(templatePath, "Respond with a JSON object:\n- {\"verdict\": \"CLEAN\"}\n");

    const plan = planMonitorClassifierPromptPatches(root);
    const first = applyMonitorClassifierPromptPatches(root);
    const second = applyMonitorClassifierPromptPatches(root);

    expect(plan.needed).toBe(true);
    expect(plan.candidateFiles).toHaveLength(2);
    expect(first.changed).toBe(true);
    expect(first.changedFiles).toHaveLength(2);
    expect(second.changed).toBe(false);
    expect(readFileSync(agentPath, "utf8")).toContain("interpret that JSON shape as the classify_verdict arguments");
    expect(readFileSync(templatePath, "utf8")).toContain("Call classify_verdict exactly once with:");
  });
});
