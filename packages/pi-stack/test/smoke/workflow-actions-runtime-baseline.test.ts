import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function repoPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

describe("workflow actions runtime baseline", () => {
  it("keeps publish workflow aligned to Node24 action runtime baseline", () => {
    const publishWorkflow = readFileSync(repoPath(".github", "workflows", "publish.yml"), "utf8");

    expect(publishWorkflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"');
    expect(publishWorkflow).toContain("uses: actions/checkout@v6");
    expect(publishWorkflow).toContain("uses: actions/setup-node@v6");
  });

  it("does not regress to legacy Node20-bound action majors in CI/Publish lane", () => {
    const workflowsDir = repoPath(".github", "workflows");
    const workflowFiles = readdirSync(workflowsDir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));

    const legacyAnchors = [
      "actions/checkout@v4",
      "actions/setup-node@v4",
      "actions/upload-artifact@v4",
      "actions/github-script@v7",
    ];

    for (const file of workflowFiles) {
      const body = readFileSync(path.join(workflowsDir, file), "utf8");
      for (const marker of legacyAnchors) {
        expect(body, `${file} should not include legacy action ${marker}`).not.toContain(marker);
      }
    }
  });
});
