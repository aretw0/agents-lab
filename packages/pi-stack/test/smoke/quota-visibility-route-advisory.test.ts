import { describe, expect, it } from "vitest";
import { buildRouteAdvisory } from "../../extensions/quota-visibility";
import { formatRouteAdvisory } from "../../extensions/quota-visibility-formatting";

function makeStatusWithDashscopeAndSpark() {
  return {
    source: {
      sessionsRoot: "x",
      scannedFiles: 1,
      parsedSessions: 1,
      parsedEvents: 1,
      windowDays: 30,
      generatedAtIso: "2026-05-13T15:49:34.109Z",
    },
    totals: { sessions: 1, userMessages: 1, assistantMessages: 1, toolResultMessages: 0, tokens: 100, costUsd: 0 },
    burn: {
      activeDays: 1,
      avgTokensPerActiveDay: 100,
      avgTokensPerCalendarDay: 100,
      projectedTokensNext7d: 700,
      avgCostPerCalendarDay: 0,
      projectedCostNext7dUsd: 0,
    },
    quota: {},
    providerBudgetPolicy: { configuredProviders: 3, allocationWarnings: [] },
    providerBudgets: [
      {
        provider: "dashscope",
        period: "monthly",
        unit: "tokens-cost",
        periodDays: 31,
        periodStartIso: "2026-05-01T00:00:00.000Z",
        periodEndIso: "2026-05-31T23:59:59.999Z",
        observedMessages: 0,
        observedTokens: 0,
        observedCostUsd: 0,
        observedRequests: 0,
        projectedTokensEndOfPeriod: 0,
        projectedCostUsdEndOfPeriod: 0,
        projectedRequestsEndOfPeriod: 0,
        periodTokensCap: 250000,
        periodCostUsdCap: 0.01,
        usedPctTokens: 0,
        projectedPctTokens: 0,
        warnPct: 70,
        hardPct: 90,
        state: "ok",
        notes: [],
      },
      {
        provider: "openai-codex",
        period: "monthly",
        unit: "tokens-cost",
        periodDays: 31,
        periodStartIso: "2026-05-01T00:00:00.000Z",
        periodEndIso: "2026-05-31T23:59:59.999Z",
        observedMessages: 10,
        observedTokens: 1000,
        observedCostUsd: 10,
        observedRequests: 0,
        projectedTokensEndOfPeriod: 2000,
        projectedCostUsdEndOfPeriod: 20,
        projectedRequestsEndOfPeriod: 0,
        periodTokensCap: 1000,
        periodCostUsdCap: 5,
        usedPctTokens: 100,
        usedPctCost: 200,
        projectedPctTokens: 200,
        projectedPctCost: 400,
        warnPct: 85,
        hardPct: 98,
        state: "blocked",
        notes: [],
      },
      {
        provider: "openai-codex",
        providerModelKey: "openai-codex/gpt-5.3-codex-spark",
        model: "gpt-5.3-codex-spark",
        period: "weekly",
        unit: "requests",
        periodDays: 7,
        periodStartIso: "2026-05-10T00:00:00.000Z",
        periodEndIso: "2026-05-16T23:59:59.999Z",
        observedMessages: 0,
        observedTokens: 0,
        observedCostUsd: 0,
        observedRequests: 20,
        projectedTokensEndOfPeriod: 0,
        projectedCostUsdEndOfPeriod: 0,
        projectedRequestsEndOfPeriod: 25,
        periodRequestsCap: 100,
        usedPctRequests: 20,
        projectedPctRequests: 25,
        warnPct: 80,
        hardPct: 100,
        state: "warning",
        notes: ["separate Spark weekly request pool"],
      },
    ],
    daily: [],
    models: [],
    providerWindows: [],
    topSessionsByTokens: [],
    topSessionsByCost: [],
  };
}

describe("quota visibility route advisory", () => {
  it("respeita routeModelRefs para Spark antes de fallback DashScope", () => {
    const status = makeStatusWithDashscopeAndSpark();

    expect(buildRouteAdvisory(status, "balanced").recommendedProvider).toBe("dashscope");

    const advisory = buildRouteAdvisory(status, "balanced", {
      preferredScopeKeys: ["openai-codex/gpt-5.3-codex-spark", "dashscope/qwen3.6-flash"],
    });

    expect(advisory.recommendedProvider).toBe("openai-codex");
    expect(advisory.recommendedScopeKey).toBe("openai-codex/gpt-5.3-codex-spark");
    expect(advisory.state).toBe("warning");
    expect(advisory.reason).toContain("routeModelRefs");
    expect(formatRouteAdvisory(advisory)).toContain("recommendedScopeKey: openai-codex/gpt-5.3-codex-spark");
  });
});
