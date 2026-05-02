import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function repoPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

describe("release draft workflow", () => {
  it("keeps draft release flow manual, pinned and Node24-aligned", () => {
    const workflow = readFileSync(repoPath(".github", "workflows", "release-draft.yml"), "utf8");

    expect(workflow).toContain("name: Release Draft");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"');

    expect(workflow).toContain("actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2");
    expect(workflow).toContain("actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0");
    expect(workflow).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1");
    expect(workflow).toContain("actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0");

    expect(workflow).toContain("draft: true");
    expect(workflow).toContain("Validate tag input");
    expect(workflow).toContain("Verify package versions against tag");
  });
});
