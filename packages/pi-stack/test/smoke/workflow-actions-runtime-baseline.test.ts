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
    expect(publishWorkflow).toContain("uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2");
    expect(publishWorkflow).toContain("uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0");
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

  it("keeps critical CI actions pinned by SHA (no floating major tags)", () => {
    const ciWorkflow = readFileSync(repoPath(".github", "workflows", "ci.yml"), "utf8");
    const publishWorkflow = readFileSync(repoPath(".github", "workflows", "publish.yml"), "utf8");

    const pinnedAnchors = [
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2",
      "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
      "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0",
    ];

    for (const anchor of pinnedAnchors) {
      expect(ciWorkflow + "\n" + publishWorkflow).toContain(anchor);
    }

    const floatingRegex = /actions\/(checkout|setup-node|upload-artifact|github-script)@v\d+/;
    expect(ciWorkflow).not.toMatch(floatingRegex);
    expect(publishWorkflow).not.toMatch(floatingRegex);
  });
});
