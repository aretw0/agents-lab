import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listWorkflows } from "../../extensions/workflow-form";

function withWorkflows(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "wf-"));
  try {
    mkdirSync(join(root, ".workflows"), { recursive: true });
    writeFileSync(join(root, ".workflows", "demo.workflow.yaml"), "name: demo\ndescription: a demo\nsteps:\n  a:\n    command: echo hi\n");
    writeFileSync(join(root, ".workflows", "bad.workflow.yaml"), "name: : :\n");
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("listWorkflows", () => {
  it("discovers *.workflow.yaml under a root and reports name + description", () => {
    withWorkflows((root) => {
      const found = listWorkflows([join(root, ".workflows")]);
      const demo = found.find((w) => w.name === "demo");
      expect(demo).toBeTruthy();
      expect(demo?.description).toBe("a demo");
      expect(demo?.source).toContain("demo.workflow.yaml");
    });
  });

  it("lists a malformed spec by filename without throwing", () => {
    withWorkflows((root) => {
      const found = listWorkflows([join(root, ".workflows")]);
      expect(found.some((w) => w.source.endsWith("bad.workflow.yaml"))).toBe(true);
    });
  });

  it("returns [] for a missing directory", () => {
    expect(listWorkflows([join(tmpdir(), "does-not-exist-xyz")])).toEqual([]);
  });
});
