import { describe, expect, it } from "vitest";
import { resolveNudgeFreeLoopCanaryGate, resolveUnattendedContinuationPlan } from "../../extensions/guardrails-core-unattended-continuation";

describe("guardrails unattended continuation", () => {
  it("marks the nudge-free loop canary ready only when every gate is green", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
    });

    expect(gate).toMatchObject({
      decision: "ready",
      canContinueWithoutNudge: true,
      reasons: ["all-gates-green"],
      summary: "nudge-free-loop: decision=ready continue=yes reasons=all-gates-green",
    });
  });

  it("defers the nudge-free loop canary without explicit opt-in", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: false,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
    });

    expect(gate).toMatchObject({
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["missing-opt-in"],
      summary: "nudge-free-loop: decision=defer continue=no reasons=missing-opt-in",
    });
  });

  it("blocks the nudge-free loop canary on protected scope, unexpected git state or stop condition", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: false,
      protectedScopesClear: false,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: false,
    });

    expect(gate).toMatchObject({
      decision: "blocked",
      canContinueWithoutNudge: false,
      reasons: ["unexpected-git-state", "protected-scope-pending", "stop-condition-present"],
      summary: "nudge-free-loop: decision=blocked continue=no reasons=unexpected-git-state,protected-scope-pending,stop-condition-present",
    });
  });

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
