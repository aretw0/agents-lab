import { describe, expect, it } from "vitest";
import { resolveValidationMethodPlan } from "../../extensions/guardrails-core-validation-method";

describe("guardrails validation method", () => {
  it("routes marker checks to the safe marker primitive", () => {
    const plan = resolveValidationMethodPlan({
      kind: "marker-check",
      safeMarkerToolAvailable: true,
    });

    expect(plan).toMatchObject({
      decision: "use-safe-marker-check",
      canValidate: true,
      reasons: ["marker-check"],
      summary: "validation-method: decision=use-safe-marker-check canValidate=yes kind=marker-check reasons=marker-check",
    });
  });

  it("routes legacy shell-inline marker checks away from shell", () => {
    const plan = resolveValidationMethodPlan({
      kind: "marker-check",
      safeMarkerToolAvailable: true,
      shellInlineRequested: true,
      commandSensitiveMarkers: true,
    });

    expect(plan).toMatchObject({
      decision: "use-safe-marker-check",
      canValidate: true,
      reasons: ["legacy-shell-inline-requested", "command-sensitive-markers"],
    });
  });

  it("runs focal tests only when the focal gate is known", () => {
    expect(resolveValidationMethodPlan({
      kind: "focal-test",
      focalGateKnown: true,
    }).decision).toBe("run-focal-test");

    expect(resolveValidationMethodPlan({
      kind: "focal-test",
      focalGateKnown: false,
    })).toMatchObject({
      decision: "ask-decision",
      reasons: ["focal-gate-unknown"],
    });
  });

  it("allows read-only structured validation", () => {
    const plan = resolveValidationMethodPlan({ kind: "structured-read" });

    expect(plan).toMatchObject({
      decision: "use-structured-read",
      canValidate: true,
      reasons: ["read-only-structured-validation"],
    });
  });

  it("blocks protected or mutating validation paths", () => {
    const plan = resolveValidationMethodPlan({
      kind: "marker-check",
      touchesProtectedScope: true,
      needsMutation: true,
    });

    expect(plan).toMatchObject({
      decision: "blocked",
      canValidate: false,
      reasons: ["protected-scope", "validation-needs-mutation"],
    });
  });
});
