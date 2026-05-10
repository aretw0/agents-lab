import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import quotaVisibilityExtension, {
  extractUsage,
  parseProviderWindowHours,
  parseOpenAIWhamUsage,
  probeOpenAIWhamUsage,
  findPiManagedOpenAIToken,
  parseProviderBudgets,
  buildProviderModelKey,
  applyOpenAIWhamUsageToBudgets,
  computeWindowStartScores,
  extractCopilotBillingUsageEvents,
  buildProviderWindowInsight,
  buildProviderBudgetStatuses,
  buildRouteAdvisory,
  shortProviderLabel,
  formatBudgetStatusLegend,
  formatBudgetStatusParts,
  resolveQuotaToolOutputPolicy,
  formatQuotaToolJsonOutput,
  estimateHardPathwayMitigation,
  analyzeQuota,
  resolveQuotaSessionRoots,
  type QuotaUsageEvent,
  type ProviderBudgetStatus,
} from "../../extensions/quota-visibility";
import { formatRouteAdvisory } from "../../extensions/quota-visibility-formatting";

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

  it("descobre e conta sessões sandbox locais de forma bounded", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quota-sandbox-"));
    try {
      const sandboxRoot = join(tmp, ".sandbox", "pi-agent", "sessions", "workspace-a");
      mkdirSync(sandboxRoot, { recursive: true });
      const stamp = new Date().toISOString();
      const fileStamp = "2020-01-01T00-00-00-000Z";
      writeFileSync(
        join(sandboxRoot, `${fileStamp}_resumed-session.jsonl`),
        [
          JSON.stringify({ type: "session", timestamp: stamp }),
          JSON.stringify({ type: "message", message: { role: "user" } }),
          JSON.stringify({
            type: "message",
            provider: "openai-codex",
            model: "gpt-test",
            timestamp: stamp,
            message: { role: "assistant" },
            usage: { input: 10, output: 15, totalTokens: 25, cost: { total: 0.01 } },
          }),
        ].join("\n"),
        "utf8",
      );

      const roots = resolveQuotaSessionRoots(tmp);
      expect(roots).toContain(join(tmp, ".sandbox", "pi-agent", "sessions"));

      const status = await analyzeQuota({
        days: 1,
        providerWindowHours: {},
        providerBudgets: {},
        sessionRoots: [join(tmp, ".sandbox", "pi-agent", "sessions")],
      });

      expect(status.source.sessionRoots).toEqual([join(tmp, ".sandbox", "pi-agent", "sessions")]);
      expect(status.source.scannedFiles).toBe(1);
      expect(status.totals.sessions).toBe(1);
      expect(status.totals.tokens).toBe(25);
      expect(status.models[0]?.model).toBe("openai-codex/gpt-test");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mantém raízes ausentes seguras e sem sessões falsas", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quota-missing-root-"));
    try {
      const status = await analyzeQuota({
        days: 1,
        providerWindowHours: {},
        providerBudgets: {},
        sessionRoots: [join(tmp, "missing", "sessions")],
      });

      expect(status.source.scannedFiles).toBe(0);
      expect(status.totals.sessions).toBe(0);
      expect(status.totals.tokens).toBe(0);
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

  it("findPiManagedOpenAIToken escolhe auth openai sem vazar token", () => {
    const found = findPiManagedOpenAIToken({
      anthropic: { access: "sk-ant" },
      openai: { access: "secret-token", expires: Date.now() + 60_000 },
    });

    expect(found).toMatchObject({ authKey: "openai", expired: false });
    expect(found?.token).toBe("secret-token");
  });

  it("parseOpenAIWhamUsage extrai janelas Codex e additional_rate_limits model-specific", () => {
    const nowMs = Date.UTC(2026, 4, 6, 12, 0, 0);
    const parsed = parseOpenAIWhamUsage(
      {
        plan_type: "plus",
        email: "dev@example.test",
        rate_limit: {
          allowed: true,
          primary_window: {
            used_percent: 50,
            limit_window_seconds: 7 * 24 * 60 * 60,
            reset_after_seconds: 6 * 24 * 60 * 60,
          },
          secondary_window: {
            used_percent: 80,
            limit_window_seconds: 5 * 60 * 60,
            reset_after_seconds: 2 * 60 * 60,
          },
        },
        additional_rate_limits: [
          {
            limit_name: "gpt-5.3-codex-spark",
            metered_feature: "gpt-5.3-codex-spark",
            rate_limit: {
              allowed: true,
              primary_window: {
                used_percent: 17,
                limit_window_seconds: 7 * 24 * 60 * 60,
                reset_at: nowMs / 1000 + 7 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      nowMs,
    );

    expect(parsed.provider).toBe("openai-codex");
    expect(parsed.plan).toBe("plus");
    expect(parsed.account).toBe("dev@example.test");
    expect(parsed.windows.map((w) => w.label)).toEqual([
      "Codex (7d)",
      "Codex (5h)",
      "gpt-5.3-codex-spark (7d)",
    ]);
    expect(parsed.windows[0]).toMatchObject({ percentLeft: 50, usedPercent: 50, windowMinutes: 10080 });
    expect(parsed.windows[1]).toMatchObject({ percentLeft: 20, resetDescription: "2h" });
    expect(parsed.windows[2]).toMatchObject({
      model: "gpt-5.3-codex-spark",
      meteredFeature: "gpt-5.3-codex-spark",
      percentLeft: 83,
      resetDescription: "7d",
    });
  });

  it("probeOpenAIWhamUsage usa auth/cache/fetch fail-soft sem rede real", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quota-wham-"));
    try {
      const nowMs = Date.UTC(2026, 4, 6, 12, 0, 0);
      const payload = Buffer.from(JSON.stringify({
        "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" },
      })).toString("base64url");
      const token = `header.${payload}.sig`;
      const authPath = join(tmp, "auth.json");
      const cachePath = join(tmp, "cache.json");
      writeFileSync(authPath, JSON.stringify({ openai: { access: token, expires: Date.now() + 60_000 } }), "utf8");

      const fetchImpl = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
        expect(init.headers.authorization).toBe(`Bearer ${token}`);
        expect(init.headers["chatgpt-account-id"]).toBe("acct_123");
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          async json() {
            return {
              additional_rate_limits: [
                {
                  limit_name: "gpt-5.3-codex-spark",
                  rate_limit: {
                    primary_window: {
                      used_percent: 17,
                      limit_window_seconds: 7 * 24 * 60 * 60,
                      reset_after_seconds: 7 * 24 * 60 * 60,
                    },
                  },
                },
              ],
            };
          },
        };
      });

      const result = await probeOpenAIWhamUsage({ authPath, cachePath, fetchImpl, nowMs });
      expect(result.ok).toBe(true);
      expect(result.cache?.status).toBe("write");
      expect(result.parsed?.windows[0]).toMatchObject({
        model: "gpt-5.3-codex-spark",
        percentLeft: 83,
      });

      const cached = await probeOpenAIWhamUsage({ authPath, cachePath, fetchImpl, nowMs: nowMs + 1000 });
      expect(cached.cache?.status).toBe("hit");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("probeOpenAIWhamUsage usa cache stale quando auth/probe falha e allowStaleCache", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quota-wham-stale-"));
    try {
      const nowMs = Date.UTC(2026, 4, 6, 12, 0, 0);
      const cachePath = join(tmp, "cache.json");
      writeFileSync(cachePath, JSON.stringify({
        cachedAtMs: nowMs - 3_600_000,
        ok: true,
        provider: "openai-codex",
        source: "openai-wham",
        parsed: { provider: "openai-codex", windows: [], notes: ["cached"] },
      }), "utf8");

      const result = await probeOpenAIWhamUsage({
        authPath: join(tmp, "missing-auth.json"),
        cachePath,
        cacheMaxAgeMs: 1,
        allowStaleCache: true,
        nowMs,
      });

      expect(result.ok).toBe(true);
      expect(result.cache?.status).toBe("stale");
      expect(result.note).toContain("stale OpenAI WHAM cache");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parseProviderBudgets aceita chave provider/model sem quebrar provider-only", () => {
    const budgets = parseProviderBudgets({
      "openai-codex": { weeklyQuotaCostUsd: 10 },
      "openai-codex/gpt-5.3-codex-spark": { weeklyQuotaRequests: 100, unit: "requests" },
    });

    expect(Object.keys(budgets).sort()).toEqual([
      "openai-codex",
      "openai-codex/gpt-5.3-codex-spark",
    ]);
    expect(budgets["openai-codex"]?.model).toBeUndefined();
    expect(budgets["openai-codex/gpt-5.3-codex-spark"]?.model).toBe("gpt-5.3-codex-spark");
    expect(buildProviderModelKey("openai-codex", "gpt-5.3-codex-spark")).toBe("openai-codex/gpt-5.3-codex-spark");
  });

  it("applyOpenAIWhamUsageToBudgets separa live dashboard de projeção local model-specific", () => {
    const [budget] = applyOpenAIWhamUsageToBudgets([
      {
        provider: "openai-codex",
        providerAccountKey: "openai-codex",
        model: "gpt-5.3-codex-spark",
        providerModelKey: "openai-codex/gpt-5.3-codex-spark",
        period: "weekly",
        unit: "requests",
        periodDays: 7,
        periodStartIso: "2026-05-01T00:00:00.000Z",
        periodEndIso: "2026-05-07T23:59:59.999Z",
        observedMessages: 10,
        observedTokens: 0,
        observedCostUsd: 0,
        observedRequests: 10,
        projectedTokensEndOfPeriod: 0,
        projectedCostUsdEndOfPeriod: 0,
        projectedRequestsEndOfPeriod: 200,
        periodRequestsCap: 100,
        usedPctRequests: 10,
        projectedPctRequests: 200,
        warnPct: 80,
        hardPct: 100,
        state: "blocked",
        notes: [],
      },
    ], {
      provider: "openai-codex",
      notes: [],
      windows: [
        {
          provider: "openai-codex",
          source: "openai-wham",
          label: "gpt-5.3-codex-spark (7d)",
          groupLabel: "gpt-5.3-codex-spark",
          windowLabel: "primary",
          model: "gpt-5.3-codex-spark",
          percentLeft: 83,
          usedPercent: 17,
          resetDescription: "7d",
        },
      ],
    });

    expect(budget?.state).toBe("warning");
    expect(budget?.dashboardRemainingPct).toBe(83);
    expect(budget?.liveWindowSource).toBe("openai-wham");
    expect(budget?.notes.join("\n")).toContain("projection alone");
  });

  it("applyOpenAIWhamUsageToBudgets sintetiza budget model-specific quando só existe agregado", () => {
    const budgets = applyOpenAIWhamUsageToBudgets([
      {
        provider: "openai-codex",
        providerAccountKey: "openai-codex",
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
        periodCostUsdCap: 10,
        usedPctTokens: 100,
        usedPctCost: 100,
        warnPct: 80,
        hardPct: 100,
        state: "blocked",
        notes: [],
      },
    ], {
      provider: "openai-codex",
      notes: [],
      windows: [
        {
          provider: "openai-codex",
          source: "openai-wham",
          label: "Codex (7d)",
          groupLabel: "Codex",
          windowLabel: "secondary",
          model: "codex",
          percentLeft: 15,
          usedPercent: 85,
        },
        {
          provider: "openai-codex",
          source: "openai-wham",
          label: "GPT-5.3-Codex-Spark (7d)",
          groupLabel: "GPT-5.3-Codex-Spark",
          windowLabel: "secondary",
          model: "gpt-5.3-codex-spark",
          percentLeft: 76,
          usedPercent: 24,
        },
      ],
    });

    const aggregate = budgets.find((b) => b.providerAccountKey === "openai-codex" && !b.providerModelKey);
    const synthetic = budgets.find((b) => b.providerModelKey === "openai-codex/gpt-5.3-codex-spark");
    expect(aggregate?.state).toBe("blocked");
    expect(synthetic).toMatchObject({
      provider: "openai-codex",
      providerModelKey: "openai-codex/gpt-5.3-codex-spark",
      model: "gpt-5.3-codex-spark",
      owner: "openai-wham-live-window",
      state: "ok",
      dashboardRemainingPct: 76,
      usedPctRequests: 24,
      liveWindowSource: "openai-wham",
    });
  });

  it("buildProviderBudgetStatuses filtra budget model-specific sem marcar provider geral", () => {
    const now = Date.now();
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(now - 2 * 3600_000).toISOString(),
        timestampMs: now - 2 * 3600_000,
        dayLocal: "2026-05-06",
        hourLocal: 1,
        provider: "openai-codex",
        model: "gpt-5.3-codex-spark",
        tokens: 100,
        costUsd: 0.01,
        requests: 2,
        sessionFile: "s1.jsonl",
      },
      {
        timestampIso: new Date(now - 1 * 3600_000).toISOString(),
        timestampMs: now - 1 * 3600_000,
        dayLocal: "2026-05-06",
        hourLocal: 2,
        provider: "openai-codex",
        model: "gpt-5",
        tokens: 900,
        costUsd: 0.09,
        requests: 8,
        sessionFile: "s1.jsonl",
      },
    ];

    const evalResult = buildProviderBudgetStatuses(events, {
      days: 7,
      providerBudgets: parseProviderBudgets({
        "openai-codex": { weeklyQuotaRequests: 1000, unit: "requests" },
        "openai-codex/gpt-5.3-codex-spark": { weeklyQuotaRequests: 10, unit: "requests" },
      }),
    });

    const providerBudget = evalResult.budgets.find((b) => b.providerAccountKey === "openai-codex");
    const modelBudget = evalResult.budgets.find((b) => b.providerModelKey === "openai-codex/gpt-5.3-codex-spark");
    expect(providerBudget?.observedRequests).toBe(10);
    expect(providerBudget?.model).toBeUndefined();
    expect(modelBudget?.model).toBe("gpt-5.3-codex-spark");
    expect(modelBudget?.observedRequests).toBe(2);
    expect(modelBudget?.usedPctRequests).toBe(20);
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

  it("buildRouteAdvisory diferencia escopo agregado Codex bloqueado vs pool codex-spark utilizável", () => {
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
    const sparkCandidate = advisory.consideredProviders.find(
      (p) => p.providerModelKey === "openai-codex/gpt-5.3-codex-spark",
    );

    expect(advisory.recommendedProvider).toBe("openai-codex");
    expect(advisory.state).toBe("warning");
    expect(aggregateCandidate).toMatchObject({ state: "blocked", provider: "openai-codex", providerModelKey: undefined });
    expect(sparkCandidate).toMatchObject({
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
      "reliable"
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

    it("usa ⚠ para estado warning", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("github-copilot", "warning", 78)]);
      expect(parts).toEqual(["⚠copilot:78%"]);
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

    it("explica símbolos, percentual local usado e diferença de WHAM", () => {
      const legend = formatBudgetStatusLegend().join("\n");
      expect(legend).toContain("✓=OK, ⚠=WARN, ✗=BLOCK");
      expect(legend).toContain("max local used pressure");
      expect(legend).toContain("not remaining quota");
      expect(legend).toContain("WHAM headroom");
    });
  });
});
