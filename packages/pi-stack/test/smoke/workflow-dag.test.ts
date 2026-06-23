import { describe, expect, it } from "vitest";
import { planWorkflow } from "../../extensions/workflow-dag";
import type { WorkflowSpec } from "../../extensions/workflow-spec";

const spec = (steps: WorkflowSpec["steps"], input?: WorkflowSpec["input"]): WorkflowSpec => ({ name: "w", steps, input });

describe("planWorkflow", () => {
  it("orders a linear chain by dependency", () => {
    const r = planWorkflow(spec({
      a: { command: "echo a" },
      b: { command: "echo ${{ steps.a.output }}" },
    }));
    expect(r.order).toEqual(["a", "b"]);
    expect(r.issues).toEqual([]);
  });

  it("orders a diamond (a -> b,c -> d)", () => {
    const r = planWorkflow(spec({
      a: { command: "echo a" },
      b: { command: "echo ${{ steps.a.output }}" },
      c: { command: "echo ${{ steps.a.output }}" },
      d: { command: "echo ${{ steps.b.output }} ${{ steps.c.output }}" },
    }));
    expect(r.order?.[0]).toBe("a");
    expect(r.order?.[3]).toBe("d");
    expect(new Set(r.order)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("detects a cycle", () => {
    const r = planWorkflow(spec({
      a: { command: "echo ${{ steps.b.output }}" },
      b: { command: "echo ${{ steps.a.output }}" },
    }));
    expect(r.order).toBeNull();
    expect(r.issues.some((i) => i.message.includes("cycle"))).toBe(true);
  });

  it("flags a dangling step reference", () => {
    const r = planWorkflow(spec({ a: { command: "echo ${{ steps.missing.output }}" } }));
    expect(r.issues).toContainEqual({ severity: "error", path: "steps.a", message: "references unknown step 'missing'" });
  });

  it("flags an unknown input reference and accepts a declared one", () => {
    const declared = planWorkflow(spec({ a: { command: "echo ${{ input.gap_id }}" } }, { properties: { gap_id: {} } }));
    expect(declared.issues).toEqual([]);
    const unknown = planWorkflow(spec({ a: { command: "echo ${{ input.nope }}" } }, { properties: { gap_id: {} } }));
    expect(unknown.issues).toContainEqual({ severity: "error", path: "steps.a", message: "references unknown input 'nope'" });
  });
});
