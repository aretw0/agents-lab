import { describe, expect, it } from "vitest";
import { resolveRecurringFailureHardening } from "../../extensions/guardrails-core-recurring-failure";

describe("guardrails recurring failure hardening", () => {
  it("documents a first occurrence before escalating", () => {
    const plan = resolveRecurringFailureHardening({ occurrenceCount: 1 });

    expect(plan).toMatchObject({
      decision: "document-rule",
      hardIntentRequired: false,
      reasons: ["first-occurrence", "rule-missing"],
      summary: "recurring-failure: decision=document-rule hardIntent=no occurrences=1 reasons=first-occurrence,rule-missing",
    });
  });

  it("requires a primitive and regression test on repeated failures", () => {
    const plan = resolveRecurringFailureHardening({
      occurrenceCount: 2,
      hasDocumentedRule: true,
      hasPrimitive: false,
      hasRegressionTest: false,
    });

    expect(plan).toMatchObject({
      decision: "create-primitive",
      hardIntentRequired: true,
      reasons: ["primitive-missing", "regression-test-missing"],
      nextActions: ["create-pure-primitive", "add-regression-test"],
    });
  });

  it("adds runtime guard after primitive and test exist", () => {
    const plan = resolveRecurringFailureHardening({
      occurrenceCount: 2,
      hasDocumentedRule: true,
      hasPrimitive: true,
      hasRegressionTest: true,
      hasRuntimeGuard: false,
    });

    expect(plan).toMatchObject({
      decision: "add-runtime-guard",
      hardIntentRequired: true,
      reasons: ["runtime-guard-missing"],
    });
  });

  it("blocks the old path on third occurrence when guardrails already exist", () => {
    const plan = resolveRecurringFailureHardening({
      occurrenceCount: 3,
      hasDocumentedRule: true,
      hasPrimitive: true,
      hasRegressionTest: true,
      hasRuntimeGuard: true,
      oldPathStillAvailable: true,
    });

    expect(plan).toMatchObject({
      decision: "block-old-path",
      hardIntentRequired: true,
      reasons: ["old-path-still-available", "third-occurrence"],
    });
  });

  it("observes mitigated failures without adding more machinery", () => {
    const plan = resolveRecurringFailureHardening({
      occurrenceCount: 3,
      hasDocumentedRule: true,
      hasPrimitive: true,
      hasRegressionTest: true,
      hasRuntimeGuard: true,
      oldPathStillAvailable: false,
    });

    expect(plan).toMatchObject({
      decision: "observe",
      hardIntentRequired: false,
      reasons: ["mitigated"],
    });
  });
});
