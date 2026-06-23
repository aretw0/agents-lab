import { describe, expect, it } from "vitest";
import { validateSpec } from "../../extensions/workflow-validate";

describe("validateSpec", () => {
  it("reports ok with the name for a valid spec", () => {
    const r = validateSpec({ name: "demo", steps: { a: { command: "echo a" }, b: { command: "echo ${{ steps.a.output }}" } } });
    expect(r.ok).toBe(true);
    expect(r.name).toBe("demo");
    expect(r.issues).toEqual([]);
  });

  it("is not ok and surfaces spec errors", () => {
    const r = validateSpec({ steps: {} });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "name")).toBe(true);
  });

  it("surfaces dag errors (cycle) for a shape-valid spec", () => {
    const r = validateSpec({ name: "w", steps: { a: { command: "${{ steps.b.output }}" }, b: { command: "${{ steps.a.output }}" } } });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("cycle"))).toBe(true);
  });

  it("keeps warnings but stays ok", () => {
    const r = validateSpec({ name: "w", steps: { a: { command: "x" } }, bogus: 1 });
    expect(r.ok).toBe(true);
    expect(r.issues).toContainEqual({ severity: "warning", path: "bogus", message: "unknown top-level key" });
  });
});
