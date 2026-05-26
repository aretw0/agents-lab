import { describe, expect, it } from "vitest";
import {
  buildProviderWindowInsight,
  buildRouteAdvisory,
  type QuotaUsageEvent,
} from "../../extensions/quota-visibility";
import { formatRouteAdvisory } from "../../extensions/quota-visibility-formatting";

function makeStatusWithDashscopeAndModelPool() {
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
        notes: ["separate model weekly request pool"],
      },
    ],
    daily: [],
    models: [],
    providerWindows: [],
    topSessionsByTokens: [],
    topSessionsByCost: [],
  };
}

describe("quota-visibility route advisory", () => {
  it("respeita routeModelRefs model-specific antes de fallback DashScope", () => {
    const status = makeStatusWithDashscopeAndModelPool();

    expect(buildRouteAdvisory(status, "balanced").recommendedProvider).toBe("dashscope");

    const advisory = buildRouteAdvisory(status, "balanced", {
      preferredScopeKeys: ["openai-codex/gpt-5.3-codex-spark", "dashscope/qwen3.6-flash"],
    });

    expect(advisory.recommendedProvider).toBe("openai-codex");
    expect(advisory.recommendedScopeKey).toBe("openai-codex/gpt-5.3-codex-spark");
    expect(advisory.blockedProviders).not.toContain("openai-codex");
    expect(advisory.state).toBe("warning");
    expect(advisory.reason).toContain("routeModelRefs");
    expect(formatRouteAdvisory(advisory)).toContain("recommendedScopeKey: openai-codex/gpt-5.3-codex-spark");
  });

  it("buildRouteAdvisory escolhe provider OK e nunca auto-switch", () => {
    const advisory = buildRouteAdvisory(
      {
        source: {
          sessionsRoot: "x",
          scannedFiles: 1,
          parsedSessions: 1,
          parsedEvents: 1,
          windowDays: 30,
          generatedAtIso: "2026-04-15T00:00:00.000Z",
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
        providerBudgetPolicy: { configuredProviders: 2, allocationWarnings: [] },
        providerBudgets: [
          {
            provider: "github-copilot",
            period: "monthly",
            unit: "requests",
            periodDays: 30,
            periodStartIso: "2026-04-01T00:00:00.000Z",
            periodEndIso: "2026-04-30T23:59:59.999Z",
            observedMessages: 10,
            observedTokens: 100,
            observedCostUsd: 0,
            observedRequests: 10,
            projectedTokensEndOfPeriod: 300,
            projectedCostUsdEndOfPeriod: 0,
            projectedRequestsEndOfPeriod: 30,
            periodRequestsCap: 100,
            usedPctRequests: 10,
            projectedPctRequests: 30,
            warnPct: 80,
            hardPct: 100,
            state: "ok",
            notes: [],
          },
          {
            provider: "openai-codex",
            period: "monthly",
            unit: "tokens-cost",
            periodDays: 30,
            periodStartIso: "2026-04-01T00:00:00.000Z",
            periodEndIso: "2026-04-30T23:59:59.999Z",
            observedMessages: 10,
            observedTokens: 800,
            observedCostUsd: 3,
            observedRequests: 0,
            projectedTokensEndOfPeriod: 1200,
            projectedCostUsdEndOfPeriod: 4,
            periodTokensCap: 1000,
            usedPctTokens: 80,
            projectedPctTokens: 120,
            warnPct: 80,
            hardPct: 100,
            state: "warning",
            notes: [],
          },
        ],
        daily: [],
        models: [],
        providerWindows: [],
        topSessionsByTokens: [],
        topSessionsByCost: [],
      },
      "balanced",
    );

    expect(advisory.recommendedProvider).toBe("github-copilot");
    expect(advisory.noAutoSwitch).toBe(true);
    expect(advisory.state).toBe("ok");
    expect(advisory.consideredProviders.find((p) => p.provider === "github-copilot")).toMatchObject({
      executionBudgetDecision: "ok",
      executionBudgetReady: true,
      executionBudgetEvidenceSource: "route-advisory",
      executionBudgetEvidenceProvider: "github-copilot",
      executionBudgetEvidenceGeneratedAtIso: "2026-04-15T00:00:00.000Z",
    });
    expect(advisory.consideredProviders.find((p) => p.provider === "github-copilot")?.executionBudgetEvidence).toContain("generatedAt=2026-04-15T00:00:00.000Z");
    expect(advisory.consideredProviders.find((p) => p.provider === "openai-codex")).toMatchObject({
      executionBudgetDecision: "warn",
      executionBudgetReady: true,
    });
  });

  it("buildRouteAdvisory diferencia escopo agregado bloqueado vs pool model-specific utilizável", () => {
    const advisory = buildRouteAdvisory({
      source: {
        sessionsRoot: "x",
        scannedFiles: 1,
        parsedSessions: 1,
        parsedEvents: 1,
        windowDays: 30,
        generatedAtIso: "2026-04-15T00:00:00.000Z",
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
      providerBudgetPolicy: { configuredProviders: 2, allocationWarnings: [] },
      providerBudgets: [
        {
          provider: "openai-codex",
          period: "weekly",
          unit: "tokens-cost",
          periodDays: 7,
          periodStartIso: "2026-04-10T00:00:00.000Z",
          periodEndIso: "2026-04-16T23:59:59.999Z",
          observedMessages: 12,
          observedTokens: 1200,
          observedCostUsd: 5,
          observedRequests: 0,
          projectedTokensEndOfPeriod: 1400,
          projectedCostUsdEndOfPeriod: 6,
          projectedRequestsEndOfPeriod: 0,
          periodTokensCap: 1000,
          usedPctTokens: 120,
          projectedPctTokens: 140,
          warnPct: 80,
          hardPct: 100,
          state: "blocked",
          notes: [],
          liveWindowSource: "openai-wham",
        },
        {
          provider: "openai-codex",
          providerModelKey: "openai-codex/gpt-5.3-codex-spark",
          model: "gpt-5.3-codex-spark",
          period: "weekly",
          unit: "tokens-cost",
          periodDays: 7,
          periodStartIso: "2026-04-10T00:00:00.000Z",
          periodEndIso: "2026-04-16T23:59:59.999Z",
          observedMessages: 1,
          observedTokens: 200,
          observedCostUsd: 1,
          observedRequests: 0,
          projectedTokensEndOfPeriod: 250,
          projectedCostUsdEndOfPeriod: 1.5,
          projectedRequestsEndOfPeriod: 0,
          dashboardRemainingPct: 82,
          dashboardUsedPct: 18,
          dashboardWindowLabel: "7d",
          liveWindowSource: "openai-wham",
          usedPctTokens: 18,
          projectedPctTokens: 25,
          warnPct: 80,
          hardPct: 100,
          state: "warning",
          notes: ["openai-wham live window evidence usable"],
        },
      ],
      daily: [],
      models: [],
      providerWindows: [],
      topSessionsByTokens: [],
      topSessionsByCost: [],
    });

    const aggregateCandidate = advisory.consideredProviders.find(
      (p) => p.provider === "openai-codex" && !p.providerModelKey,
    );
    const modelPoolCandidate = advisory.consideredProviders.find(
      (p) => p.providerModelKey === "openai-codex/gpt-5.3-codex-spark",
    );

    expect(advisory.recommendedProvider).toBe("openai-codex");
    expect(advisory.state).toBe("warning");
    expect(aggregateCandidate).toMatchObject({ state: "blocked", provider: "openai-codex", providerModelKey: undefined });
    expect(modelPoolCandidate).toMatchObject({
      provider: "openai-codex",
      providerModelKey: "openai-codex/gpt-5.3-codex-spark",
      state: "warning",
      executionBudgetEvidenceProvider: "openai-codex/gpt-5.3-codex-spark",
      executionBudgetEvidence: expect.stringContaining("openai-codex/gpt-5.3-codex-spark"),
      executionBudgetDecision: "warn",
    });
    expect(formatRouteAdvisory(advisory)).toContain("openai-codex/gpt-5.3-codex-spark");
  });

  it("buildRouteAdvisory retorna BLOCKER quando todos estão bloqueados", () => {
    const advisory = buildRouteAdvisory(
      {
        source: {
          sessionsRoot: "x",
          scannedFiles: 1,
          parsedSessions: 1,
          parsedEvents: 1,
          windowDays: 30,
          generatedAtIso: "2026-04-15T00:00:00.000Z",
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
        providerBudgetPolicy: { configuredProviders: 1, allocationWarnings: [] },
        providerBudgets: [
          {
            provider: "openai-codex",
            period: "weekly",
            unit: "tokens-cost",
            periodDays: 7,
            periodStartIso: "2026-04-10T00:00:00.000Z",
            periodEndIso: "2026-04-16T23:59:59.999Z",
            observedMessages: 10,
            observedTokens: 1200,
            observedCostUsd: 5,
            observedRequests: 0,
            projectedTokensEndOfPeriod: 1400,
            projectedCostUsdEndOfPeriod: 6,
            periodTokensCap: 1000,
            usedPctTokens: 120,
            projectedPctTokens: 140,
            warnPct: 80,
            hardPct: 100,
            state: "blocked",
            notes: [],
          },
        ],
        daily: [],
        models: [],
        providerWindows: [],
        topSessionsByTokens: [],
        topSessionsByCost: [],
      },
      "reliable",
    );

    expect(advisory.recommendedProvider).toBeUndefined();
    expect(advisory.state).toBe("blocked");
    expect(advisory.reason).toContain("BLOCKER");
    expect(advisory.consideredProviders.every((p) => p.executionBudgetDecision === "blocked")).toBe(true);
    expect(advisory.consideredProviders.every((p) => p.executionBudgetReady === false)).toBe(true);
  });

  it("buildProviderWindowInsight destaca pico e início antes do pico", () => {
    const base = Date.UTC(2026, 3, 14, 0, 0, 0);
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(base + 14 * 3600_000).toISOString(),
        timestampMs: base + 14 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 14,
        provider: "anthropic",
        model: "claude-sonnet",
        tokens: 1200,
        costUsd: 0.02,
        requests: 1,
        sessionFile: "s1.jsonl",
      },
      {
        timestampIso: new Date(base + 15 * 3600_000).toISOString(),
        timestampMs: base + 15 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 15,
        provider: "anthropic",
        model: "claude-sonnet",
        tokens: 900,
        costUsd: 0.015,
        requests: 1,
        sessionFile: "s1.jsonl",
      },
      {
        timestampIso: new Date(base + 3 * 3600_000).toISOString(),
        timestampMs: base + 3 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 3,
        provider: "anthropic",
        model: "claude-sonnet",
        tokens: 100,
        costUsd: 0.002,
        requests: 1,
        sessionFile: "s2.jsonl",
      },
    ];

    const insight = buildProviderWindowInsight("anthropic", 5, events, 7);

    expect(insight.provider).toBe("anthropic");
    expect(insight.windowHours).toBe(5);
    expect(insight.observedTokens).toBe(2200);
    expect(insight.peakHoursLocal[0]).toBe(14);
    expect(insight.suggestedStartHoursBeforePeakLocal).toContain(9);
    expect(insight.highestDemandWindowStartsLocal).toContain(11);
  });
});
