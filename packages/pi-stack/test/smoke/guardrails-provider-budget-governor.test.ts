import { describe, expect, it } from "vitest";
import {
  detectProviderBudgetGovernorMisconfig,
  providerBudgetGovernorMisconfigReason,
  shouldAnnounceStrictInteractiveMode,
} from "../../extensions/guardrails-core";

describe("guardrails-core provider-budget governor misconfig", () => {
  it("does not flag when governor is disabled", () => {
    expect(detectProviderBudgetGovernorMisconfig(false, {})).toBeUndefined();
  });

  it("flags missing providerBudgets when governor is enabled", () => {
    expect(detectProviderBudgetGovernorMisconfig(true, {})).toBe("missing-provider-budgets");
  });

  it("does not flag when at least one provider budget is configured", () => {
    expect(
      detectProviderBudgetGovernorMisconfig(true, {
        anthropic: { period: "weekly", unit: "tokens-cost", shareTokensPct: 50 },
      }),
    ).toBeUndefined();
  });

  it("renders actionable reason for missing providerBudgets", () => {
    const message = providerBudgetGovernorMisconfigReason("missing-provider-budgets");
    expect(message).toMatch(/providerBudgetGovernor habilitado/i);
    expect(message).toMatch(/\.pi\/settings\.json/i);
  });
});

describe("guardrails-core strict interactive notify calibration", () => {
  it("announces only when strict mode is active and not yet announced", () => {
    expect(shouldAnnounceStrictInteractiveMode(false, true)).toBe(true);
  });

  it("suppresses repeated strict-mode notify after first announcement", () => {
    expect(shouldAnnounceStrictInteractiveMode(true, true)).toBe(false);
  });

  it("does not announce when strict mode is inactive", () => {
    expect(shouldAnnounceStrictInteractiveMode(false, false)).toBe(false);
  });
});
