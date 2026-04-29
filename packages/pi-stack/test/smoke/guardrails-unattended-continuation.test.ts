import { describe, expect, it } from "vitest";
import { resolveUnattendedContinuationPlan } from "../../extensions/guardrails-core-unattended-continuation";

describe("guardrails unattended continuation", () => {
  it("continues when the next slice is local-safe and progress is saved", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "checkpoint",
    });

    expect(plan).toMatchObject({
      decision: "continue-local",
      canContinue: true,
      reasons: ["local-safe-next-step", "checkpoint-progress-saved"],
      summary: "unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved",
    });
  });

  it("asks for decision when focus is complete but the next step is ambiguous", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: false,
      protectedScope: false,
      risk: false,
      ambiguous: true,
      progressSaved: true,
      contextLevel: "ok",
    });

    expect(plan).toMatchObject({
      decision: "ask-decision",
      canContinue: false,
      reasons: ["ambiguous-next-step", "no-local-safe-next-step"],
    });
  });

  it("blocks protected scopes and real risk", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: true,
      risk: true,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "ok",
    });

    expect(plan).toMatchObject({
      decision: "blocked",
      canContinue: false,
      reasons: ["risk", "protected-scope"],
    });
  });

  it("does not start new work in compact lane", () => {
    const saved = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "compact",
    });
    const unsaved = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: false,
      contextLevel: "compact",
    });

    expect(saved.decision).toBe("pause-for-compact");
    expect(unsaved.decision).toBe("checkpoint");
  });
});
