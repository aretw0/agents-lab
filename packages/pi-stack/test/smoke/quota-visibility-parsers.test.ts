import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import quotaVisibilityExtension, {
  extractUsage,
  parseProviderWindowHours,
  parseProviderBudgets,
  computeWindowStartScores,
  extractCopilotBillingUsageEvents,
  buildProviderWindowInsight,
  buildProviderBudgetStatuses,
  buildRouteAdvisory,
  shortProviderLabel,
  formatBudgetStatusParts,
  resolveQuotaToolOutputPolicy,
  formatQuotaToolJsonOutput,
  estimateHardPathwayMitigation,
  type QuotaUsageEvent,
  type ProviderBudgetStatus,
} from "../../extensions/quota-visibility";

/** Minimal ExtensionAPI mock — enough to register without crashing. */
function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
  } as unknown as Parameters<typeof quotaVisibilityExtension>[0];
}

function getRegisteredTool(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
    ([def]: [{ name: string }]) => def.name === name,
  );
  if (!call) throw new Error(`tool not registered: ${name}`);
  return call[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: { cwd: string },
    ) => Promise<{ content?: Array<{ text?: string }>; details?: unknown }>;
  };
}

describe("quota-visibility extension — registration smoke", () => {
  it("não crasha ao ser carregada (sem ctx no escopo global)", () => {
    expect(() => quotaVisibilityExtension(makeMockPi())).not.toThrow();
  });

  it("registra handler para session_start (budget refresh)", () => {
    const pi = makeMockPi();
    quotaVisibilityExtension(pi);
    const registeredEvents = (pi.on as ReturnType<typeof vi.fn>).mock.calls.map(
      ([event]: [string]) => event,
    );
    expect(registeredEvents).toContain("session_start");
  });

  it("registra command budget e tool equivalente por provider", () => {
    const pi = makeMockPi();
    quotaVisibilityExtension(pi);

    const commandNames = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]: [string]) => name,
    );
    const toolNames = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(
      ([def]: [{ name: string }]) => def.name,
    );

    expect(commandNames).toContain("quota-visibility");
    expect(toolNames).toContain("quota_visibility_provider_budgets");
  });

  it("executa tools de quota com output policy resolvido", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quota-tools-"));
    try {
      const pi = makeMockPi();
      quotaVisibilityExtension(pi);
      const ctx = { cwd: tmp };
      const signal = new AbortController().signal;
      for (const name of [
        "quota_visibility_status",
        "quota_visibility_windows",
        "quota_visibility_provider_budgets",
      ]) {
        const tool = getRegisteredTool(pi, name);
        const result = await tool.execute("tool-call", { days: 1 }, signal, () => undefined, ctx);
        expect(result.content?.[0]?.text).toBeTruthy();
        expect(result.details).toBeTruthy();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  describe("quota tool output policy", () => {
    it("resolveQuotaToolOutputPolicy aplica defaults e clamp", () => {
      const p1 = resolveQuotaToolOutputPolicy();
      expect(p1.compactLargeJson).toBe(true);
      expect(p1.maxInlineJsonChars).toBe(1200);

      const p2 = resolveQuotaToolOutputPolicy({
        outputPolicy: { compactLargeJson: false, maxInlineJsonChars: 50 },
      } as any);
      expect(p2.compactLargeJson).toBe(false);
      expect(p2.maxInlineJsonChars).toBe(400);
    });

    it("formatQuotaToolJsonOutput compacta payload grande", () => {
      const data = { rows: Array.from({ length: 100 }, (_, i) => ({ i, txt: "x".repeat(40) })) };
      const text = formatQuotaToolJsonOutput("quota_visibility_status", data, {
        compactLargeJson: true,
        maxInlineJsonChars: 500,
      });
      expect(text).toContain("output compactado");
      expect(text).toContain("payload completo disponível em details");
    });
  });
});

describe("quota-visibility parsers", () => {
  it("estimateHardPathwayMitigation projeta baseline vs pós-automação", () => {
    const projection = estimateHardPathwayMitigation({
      baselineTokens: 10_000,
      baselineCostUsd: 12.5,
      baselineRequests: 200,
      automationCoveragePct: 0.8,
      residualLlmPct: 0.1,
      riskBufferPct: 0.05,
    });

    expect(projection.baseline.tokens).toBe(10_000);
    expect(projection.projectedAfterHardPathway.tokens).toBeLessThan(10_000);
    expect(projection.delta.tokensSaved).toBeGreaterThan(0);
    expect(projection.delta.costUsdSavedPct).toBeGreaterThan(0);
  });

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

  it("parseProviderBudgets aceita chave provider/account com fallback provider-only", () => {
    const budgets = parseProviderBudgets({
      "openai-codex/team-a": {
        owner: "squad-a",
        weeklyQuotaTokens: 1000,
      },
      "openai-codex": {
        weeklyQuotaTokens: 5000,
      },
    });

    expect(budgets["openai-codex/team-a"]?.weeklyQuotaTokens).toBe(1000);
    expect(budgets["openai-codex/team-a"]?.owner).toBe("squad-a");
    expect(budgets["openai-codex"]?.weeklyQuotaTokens).toBe(5000);
  });

  it("extractCopilotBillingUsageEvents injeta custo real faturado (fonte externa) no provider github-copilot", () => {
    const startMs = Date.parse("2026-04-20T00:00:00.000Z");
    const endMs = Date.parse("2026-04-27T00:00:00.000Z");
    const events = extractCopilotBillingUsageEvents({
      records: [
        {
          timestampIso: "2026-04-24T11:00:00.000Z",
          account: "team-alpha",
          costUsd: 3.75,
          requests: 12,
          model: "copilot-billing-api",
        },
        {
          timestampIso: "2026-04-10T11:00:00.000Z",
          account: "team-alpha",
          costUsd: 1.25,
          requests: 3,
        },
      ],
    }, {
      sourceFile: "billing/github-copilot-costs.json",
      windowStartMs: startMs,
      windowEndMs: endMs,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "github-copilot",
      account: "team-alpha",
      providerAccountKey: "github-copilot/team-alpha",
      costUsd: 3.75,
      requests: 12,
      model: "copilot-billing-api",
      sessionFile: "billing/github-copilot-costs.json",
    });
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

  it("buildProviderBudgetStatuses alerta quando shares excedem 100%", () => {
    const now = Date.now();
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(now - 1 * 3600_000).toISOString(),
        timestampMs: now - 1 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 2,
        provider: "openai-codex",
        model: "gpt-5",
        tokens: 200,
        costUsd: 0.1,
        requests: 1,
        sessionFile: "s1.jsonl",
      },
    ];

    const evalResult = buildProviderBudgetStatuses(events, {
      days: 7,
      weeklyQuotaTokens: 10000,
      weeklyQuotaCostUsd: 10,
      providerBudgets: {
        "openai-codex": { shareTokensPct: 70, shareCostPct: 70 },
        "github-copilot": { shareTokensPct: 50, shareCostPct: 50 },
      },
    });

    expect(evalResult.allocationWarnings.length).toBeGreaterThan(0);
    expect(evalResult.allocationWarnings.join("\n")).toContain("shareTokensPct soma");
  });

  it("buildProviderBudgetStatuses aplica matcher account-aware com fallback provider-only", () => {
    const now = Date.now();
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(now - 2 * 3600_000).toISOString(),
        timestampMs: now - 2 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 1,
        provider: "openai-codex",
        account: "team-a",
        providerAccountKey: "openai-codex/team-a",
        model: "gpt-5",
        tokens: 100,
        costUsd: 0.1,
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
        tokens: 50,
        costUsd: 0.05,
        requests: 1,
        sessionFile: "s1.jsonl",
      },
    ];

    const evalResult = buildProviderBudgetStatuses(events, {
      days: 7,
      providerBudgets: {
        "openai-codex/team-a": {
          weeklyQuotaTokens: 200,
        },
        "openai-codex": {
          weeklyQuotaTokens: 1000,
        },
      },
    });

    const accountBudget = evalResult.budgets.find(
      (b) => b.providerAccountKey === "openai-codex/team-a"
    );
    const providerBudget = evalResult.budgets.find(
      (b) => b.providerAccountKey === "openai-codex"
    );

    expect(accountBudget?.account).toBe("team-a");
    expect(accountBudget?.observedTokens).toBe(100);
    expect(providerBudget?.observedTokens).toBe(150);
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
    const nowDate = new Date(now);
    const periodSafeTs = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      1,
      12,
      0,
      0,
      0,
    ).getTime();
    const eventTs = periodSafeTs <= now ? periodSafeTs : now;
    const eventDate = new Date(eventTs);
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: eventDate.toISOString(),
        timestampMs: eventTs,
        dayLocal: eventDate.toISOString().slice(0, 10),
        hourLocal: eventDate.getHours(),
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

  it("remaining requests policy bloqueia quando saldo global já zerou", () => {
    const now = Date.now();
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(now - 1 * 24 * 3600_000).toISOString(),
        timestampMs: now - 1 * 24 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 11,
        provider: "github-copilot",
        model: "claude-sonnet-4.6",
        tokens: 100,
        costUsd: 0,
        requests: 120,
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
          requestSharePolicy: "remaining",
          shareMonthlyRequestsPct: 50,
          warnPct: 80,
          hardPct: 100,
        },
      },
    });

    expect(evalResult.budgets[0]?.periodRequestsCap).toBe(0);
    expect(evalResult.budgets[0]?.usedPctRequests).toBe(100);
    expect(evalResult.budgets[0]?.state).toBe("blocked");
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
      "balanced"
    );

    expect(advisory.recommendedProvider).toBe("github-copilot");
    expect(advisory.noAutoSwitch).toBe(true);
    expect(advisory.state).toBe("ok");
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
      "reliable"
    );

    expect(advisory.recommendedProvider).toBeUndefined();
    expect(advisory.state).toBe("blocked");
    expect(advisory.reason).toContain("BLOCKER");
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

// Helper to build a minimal ProviderBudgetStatus for tests
function makeBudgetStatus(
  provider: string,
  state: "ok" | "warning" | "blocked",
  usedPctCost: number,
): ProviderBudgetStatus {
  return {
    provider,
    period: "monthly",
    unit: "tokens-cost",
    periodDays: 30,
    periodStartIso: "2026-04-01",
    periodEndIso: "2026-04-30",
    observedMessages: 0,
    observedTokens: 0,
    observedCostUsd: 0,
    observedRequests: 0,
    projectedTokensEndOfPeriod: 0,
    projectedCostUsdEndOfPeriod: 0,
    projectedRequestsEndOfPeriod: 0,
    usedPctCost,
    warnPct: 75,
    hardPct: 100,
    state,
    notes: [],
  };
}

describe("quota-visibility — TUI footer formatters", () => {
  describe("shortProviderLabel", () => {
    it("abrevia github-copilot para copilot", () => {
      expect(shortProviderLabel("github-copilot")).toBe("copilot");
    });
    it("abrevia openai-codex para codex", () => {
      expect(shortProviderLabel("openai-codex")).toBe("codex");
    });
    it("abrevia google-gemini-cli para gemini", () => {
      expect(shortProviderLabel("google-gemini-cli")).toBe("gemini");
    });
    it("abrevia google-antigravity para antigrav", () => {
      expect(shortProviderLabel("google-antigravity")).toBe("antigrav");
    });
    it("mantém providers desconhecidos intactos", () => {
      expect(shortProviderLabel("anthropic")).toBe("anthropic");
    });
  });

  describe("formatBudgetStatusParts", () => {
    it("retorna lista vazia para entrada vazia", () => {
      expect(formatBudgetStatusParts([])).toEqual([]);
    });

    it("usa ✓ para estado ok", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("openai-codex", "ok", 12)]);
      expect(parts).toEqual(["✓codex:12%"]);
    });

    it("usa ! para estado warning", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("github-copilot", "warning", 78)]);
      expect(parts).toEqual(["!copilot:78%"]);
    });

    it("usa ✗ para estado blocked", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("github-copilot", "blocked", 100)]);
      expect(parts).toEqual(["✗copilot:100%"]);
    });

    it("usa o maior pct entre tokens/cost/requests", () => {
      const b: ProviderBudgetStatus = {
        ...makeBudgetStatus("openai-codex", "ok", 10),
        usedPctTokens: 55,
        usedPctCost: 10,
        usedPctRequests: 30,
      };
      const [part] = formatBudgetStatusParts([b]);
      expect(part).toBe("✓codex:55%");
    });

    it("arredonda pct fracionário", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("openai-codex", "ok", 12.7)]);
      expect(parts).toEqual(["✓codex:13%"]);
    });

    it("formata múltiplos providers na ordem recebida", () => {
      const parts = formatBudgetStatusParts([
        makeBudgetStatus("openai-codex", "ok", 0),
        makeBudgetStatus("github-copilot", "blocked", 100),
        makeBudgetStatus("google-gemini-cli", "ok", 8),
      ]);
      expect(parts).toEqual(["✓codex:0%", "✗copilot:100%", "✓gemini:8%"]);
    });

    it("trata undefined como 0 (safeNum)", () => {
      const b: ProviderBudgetStatus = {
        ...makeBudgetStatus("openai-codex", "ok", 0),
        usedPctCost: undefined,
        usedPctTokens: undefined,
      };
      const [part] = formatBudgetStatusParts([b]);
      expect(part).toBe("✓codex:0%");
    });
  });
});
