import { describe, expect, it } from "vitest";
import {
  GOVERNANCE_PROFILES,
  applyGovernanceProfile,
  flattenObject,
  parseGovernanceProfile,
} from "../../extensions/governance-profiles";

describe("governance-profiles opt-in model", () => {
  it("preserves unrelated provider routing settings when applying a profile", () => {
    const base = {
      piStack: {
        quotaVisibility: {
          routeModelRefs: {
            "openai-codex": "openai-codex/gpt-5.3-codex",
          },
          providerBudgets: {
            "openai-codex": {
              period: "monthly",
              unit: "tokens-cost",
              monthlyQuotaCostUsd: 50,
            },
          },
        },
      },
    } as Record<string, unknown>;

    const merged = applyGovernanceProfile(base, "balanced");
    const refs = (merged.piStack as any).quotaVisibility.routeModelRefs;
    const budgets = (merged.piStack as any).quotaVisibility.providerBudgets;

    expect(refs["openai-codex"]).toBe("openai-codex/gpt-5.3-codex");
    expect(budgets["openai-codex"].monthlyQuotaCostUsd).toBe(50);
  });

  it("profile patches do not hardcode routeModelRefs/providerBudgets", () => {
    for (const profile of Object.values(GOVERNANCE_PROFILES)) {
      const flat = flattenObject(profile);
      const keys = Object.keys(flat);
      expect(keys.some((k) => k.includes("routeModelRefs"))).toBe(false);
      expect(keys.some((k) => k.includes("providerBudgets"))).toBe(false);
    }
  });

  it("parses only known profile names", () => {
    expect(parseGovernanceProfile("conservative")).toBe("conservative");
    expect(parseGovernanceProfile("balanced")).toBe("balanced");
    expect(parseGovernanceProfile("throughput")).toBe("throughput");
    expect(parseGovernanceProfile("caveman")).toBeUndefined();
  });
});
