import { describe, expect, it } from "vitest";
import { normalizeWorkflowSpec } from "../../extensions/workflow-spec";

const good = {
  name: "demo",
  description: "d",
  steps: { a: { command: "echo hi", output: { format: "json" } }, b: { block: { read: "issues" } } },
};

describe("normalizeWorkflowSpec", () => {
  it("accepts a valid spec and returns the normalized object", () => {
    const r = normalizeWorkflowSpec(good);
    expect(r.spec?.name).toBe("demo");
    expect(Object.keys(r.spec?.steps ?? {})).toEqual(["a", "b"]);
    expect(r.issues).toEqual([]);
  });

  it("errors when name is missing or empty", () => {
    const r = normalizeWorkflowSpec({ steps: { a: { command: "x" } } });
    expect(r.spec).toBeNull();
    expect(r.issues).toContainEqual({ severity: "error", path: "name", message: "name is required and must be a non-empty string" });
  });

  it("errors when steps is missing or empty", () => {
    const r = normalizeWorkflowSpec({ name: "x", steps: {} });
    expect(r.issues.some((i) => i.path === "steps" && i.severity === "error")).toBe(true);
  });

  it("errors when a step has zero or multiple executors", () => {
    const none = normalizeWorkflowSpec({ name: "x", steps: { a: { output: { format: "json" } } } });
    expect(none.issues).toContainEqual({ severity: "error", path: "steps.a", message: "step must have exactly one of: block, command, agent" });
    const many = normalizeWorkflowSpec({ name: "x", steps: { a: { command: "x", block: {} } } });
    expect(many.issues).toContainEqual({ severity: "error", path: "steps.a", message: "step must have exactly one of: block, command, agent" });
  });

  it("errors on a non-string command and a bad output.format", () => {
    const r = normalizeWorkflowSpec({ name: "x", steps: { a: { command: 5 }, b: { command: "y", output: { format: "xml" } } } });
    expect(r.issues).toContainEqual({ severity: "error", path: "steps.a.command", message: "command must be a string" });
    expect(r.issues).toContainEqual({ severity: "error", path: "steps.b.output.format", message: "output.format must be 'json' or 'text'" });
  });

  it("warns on an unknown top-level key", () => {
    const r = normalizeWorkflowSpec({ name: "x", steps: { a: { command: "y" } }, bogus: 1 });
    expect(r.issues).toContainEqual({ severity: "warning", path: "bogus", message: "unknown top-level key" });
    expect(r.spec?.name).toBe("x");
  });

  it("errors when the root is not an object", () => {
    expect(normalizeWorkflowSpec(null).issues).toContainEqual({ severity: "error", path: "", message: "workflow must be a mapping" });
    expect(normalizeWorkflowSpec([]).issues).toContainEqual({ severity: "error", path: "", message: "workflow must be a mapping" });
  });

  it("errors when input is present but not a mapping", () => {
    const r = normalizeWorkflowSpec({ name: "x", input: "nope", steps: { a: { command: "y" } } });
    expect(r.spec).toBeNull();
    expect(r.issues).toContainEqual({ severity: "error", path: "input", message: "input must be a mapping" });
  });
});
