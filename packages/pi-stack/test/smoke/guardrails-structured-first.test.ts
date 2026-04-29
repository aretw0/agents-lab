import { describe, expect, it } from "vitest";
import { resolveStructuredFirstMutationDecision } from "../../extensions/guardrails-core-structured-first";


describe("structured-first mutation guard", () => {
  it("blocks textual edits to project task blocks and recommends board surface", () => {
    const decision = resolveStructuredFirstMutationDecision({
      toolType: "edit",
      path: ".project/tasks.json",
    });

    expect(decision.block).toBe(true);
    expect(decision.auditKey).toBe("guardrails-core.structured-first-block");
    expect(decision.recommendedSurface).toBe("board_query/board_update");
    expect(decision.reason).toContain("structured-first");
    expect(decision.reason).toContain("board_query/board_update");
  });

  it("blocks writes to project verification blocks with structured alternatives", () => {
    const decision = resolveStructuredFirstMutationDecision({
      toolType: "write",
      path: "./.project/verification.json",
    });

    expect(decision.block).toBe(true);
    expect(decision.path).toBe(".project/verification.json");
    expect(decision.recommendedSurface).toContain("board_query");
    expect(decision.recommendedSurface).toContain("structured_io");
  });

  it("allows non-project json and non-structured paths", () => {
    expect(resolveStructuredFirstMutationDecision({ toolType: "edit", path: "package.json" }).block).toBe(false);
    expect(resolveStructuredFirstMutationDecision({ toolType: "write", path: "docs/notes.md" }).block).toBe(false);
  });
});
