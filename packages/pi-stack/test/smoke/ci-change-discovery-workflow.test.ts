import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("ci workflow change-discovery report-only loop", () => {
  it("keeps report-only change discovery + artifact + pr comment anchors", () => {
    const ciWorkflow = readRepoFile(".github/workflows/ci.yml");

    expect(ciWorkflow).toContain("changes:");
    expect(ciWorkflow).toContain("Change Discovery (report-only)");
    expect(ciWorkflow).toContain("name: ci-change-discovery");
    expect(ciWorkflow).toContain("path: .artifacts/ci-change-discovery");
    expect(ciWorkflow).toContain("impact_label: ${{ steps.detect.outputs.impact_label }}");
    expect(ciWorkflow).toContain("<!-- ci-change-discovery-report -->");
    expect(ciWorkflow).toContain("Upsert comentário de change discovery no PR");
  });

  it("keeps smoke gate full (no auto-skip)", () => {
    const ciWorkflow = readRepoFile(".github/workflows/ci.yml");

    expect(ciWorkflow).toContain("name: Smoke Tests");
    expect(ciWorkflow).toContain("needs: [changes]");
    expect(ciWorkflow).toContain("run: npm run ci:smoke:gate");
  });

  it("keeps actions runtime baseline on Node24 with pinned action SHAs", () => {
    const ciWorkflow = readRepoFile(".github/workflows/ci.yml");

    expect(ciWorkflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"');
    expect(ciWorkflow).toContain("actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2");
    expect(ciWorkflow).toContain("actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0");
    expect(ciWorkflow).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1");
    expect(ciWorkflow).toContain("actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0");
  });
});
