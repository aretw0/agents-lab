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
});
