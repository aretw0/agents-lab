import { describe, it, expect } from "vitest";
import {
  extractUsage,
  parseProviderWindowHours,
  parseProviderBudgets,
  computeWindowStartScores,
  buildProviderWindowInsight,
  buildProviderBudgetStatuses,
  type QuotaUsageEvent,
} from "../../extensions/quota-visibility";

describe("quota-visibility parsers", () => {
  it("extractUsage normaliza formatos de usage/cost", () => {
    const u = extractUsage({
      input: 100,
      output: 50,
      cacheRead: 25,
      totalTokens: 175,
      cost: { total: 0.0123 },
    });

    expect(u.totalTokens).toBe(175);
    expect(u.input).toBe(100);
    expect(u.output).toBe(50);
    expect(u.cacheRead).toBe(25);
    expect(u.costTotalUsd).toBeCloseTo(0.0123);
  });

  it("parseProviderWindowHours aceita apenas chaves válidas", () => {
    const map = parseProviderWindowHours({
      anthropic: 5,
      "openai-codex": "5",
      "": 2,
      invalid: 99,
    });

    expect(map).toEqual({
      anthropic: 5,
      "openai-codex": 5,
    });
  });

  it("parseProviderBudgets normaliza regras de share/owner", () => {
    const budgets = parseProviderBudgets({
      "openai-codex": {
        owner: "time-a",
        shareTokensPct: "30",
        shareCostPct: 25,
        warnPct: 70,
        hardPct: 95,
      },
      invalid: {
        shareTokensPct: 999,
      },
    });

    expect(budgets["openai-codex"]).toMatchObject({
      owner: "time-a",
      shareTokensPct: 30,
      shareCostPct: 25,
      warnPct: 70,
      hardPct: 95,
    });
    expect(budgets.invalid).toBeUndefined();
  });

  it("computeWindowStartScores soma janela circular corretamente", () => {
    const hourly = Array.from({ length: 24 }, () => 0);
    hourly[14] = 100;
    hourly[15] = 50;

    const scores = computeWindowStartScores(hourly, 5);

    expect(scores[11]).toBe(150); // 11..15
    expect(scores[10]).toBe(100); // 10..14
    expect(scores[0]).toBe(0);
  });

  it("buildProviderBudgetStatuses aplica shares e bloqueio por provider", () => {
    const now = Date.now();
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(now - 2 * 3600_000).toISOString(),
        timestampMs: now - 2 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 1,
        provider: "openai-codex",
        model: "gpt-5",
        tokens: 4000,
        costUsd: 1.2,
        requests: 1,
        sessionFile: "s1.jsonl",
      },
      {
        timestampIso: new Date(now - 1 * 3600_000).toISOString(),
        timestampMs: now - 1 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 2,
        provider: "openai-codex",
        model: "gpt-5",
        tokens: 2000,
        costUsd: 0.8,
        requests: 1,
        sessionFile: "s1.jsonl",
      },
    ];

    const evalResult = buildProviderBudgetStatuses(events, {
      days: 7,
      weeklyQuotaTokens: 10000,
      weeklyQuotaCostUsd: 10,
      providerBudgets: {
        "openai-codex": {
          owner: "time-a",
          shareTokensPct: 50,
          shareCostPct: 20,
          warnPct: 70,
          hardPct: 90,
        },
      },
    });

    expect(evalResult.allocationWarnings).toEqual([]);
    expect(evalResult.budgets).toHaveLength(1);
    expect(evalResult.budgets[0]?.provider).toBe("openai-codex");
    expect(evalResult.budgets[0]?.period).toBe("weekly");
    expect(evalResult.budgets[0]?.periodTokensCap).toBe(5000);
    expect(evalResult.budgets[0]?.periodCostUsdCap).toBe(2);
    expect(evalResult.budgets[0]?.state).toBe("blocked");
  });

  it("buildProviderBudgetStatuses suporta cota mensal fixa", () => {
    const now = Date.now();
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(now - 3 * 24 * 3600_000).toISOString(),
        timestampMs: now - 3 * 24 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 10,
        provider: "github-copilot",
        model: "gpt-5",
        tokens: 1000,
        costUsd: 0.3,
        requests: 1,
        sessionFile: "s1.jsonl",
      },
    ];

    const evalResult = buildProviderBudgetStatuses(events, {
      days: 30,
      monthlyQuotaTokens: 10000,
      monthlyQuotaCostUsd: 20,
      providerBudgets: {
        "github-copilot": {
          owner: "colega-b",
          period: "monthly",
          shareMonthlyTokensPct: 50,
          shareMonthlyCostPct: 50,
          warnPct: 80,
          hardPct: 100,
        },
      },
    });

    expect(evalResult.budgets).toHaveLength(1);
    expect(evalResult.budgets[0]?.provider).toBe("github-copilot");
    expect(evalResult.budgets[0]?.period).toBe("monthly");
    expect(evalResult.budgets[0]?.periodTokensCap).toBe(5000);
    expect(evalResult.budgets[0]?.periodCostUsdCap).toBe(10);
  });

  it("buildProviderBudgetStatuses suporta budget por requests (copilot)", () => {
    const now = Date.now();
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(now - 2 * 24 * 3600_000).toISOString(),
        timestampMs: now - 2 * 24 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 10,
        provider: "github-copilot",
        model: "claude-sonnet-4.6",
        tokens: 500,
        costUsd: 0,
        requests: 30,
        sessionFile: "s1.jsonl",
      },
    ];

    const evalResult = buildProviderBudgetStatuses(events, {
      days: 30,
      monthlyQuotaRequests: 100,
      providerBudgets: {
        "github-copilot": {
          unit: "requests",
          period: "monthly",
          shareMonthlyRequestsPct: 50,
          warnPct: 70,
          hardPct: 90,
        },
      },
    });

    expect(evalResult.budgets[0]?.periodRequestsCap).toBe(50);
    expect(evalResult.budgets[0]?.usedPctRequests).toBe(60);
    expect(evalResult.budgets[0]?.unit).toBe("requests");
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
