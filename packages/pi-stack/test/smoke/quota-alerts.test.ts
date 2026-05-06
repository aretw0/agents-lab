import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildBudgetAlerts,
  build429StreakAlerts,
  buildWindowPressureAlerts,
  buildQuotaAlerts,
  isRateLimitText,
  parse429Streak,
  extractTextFromRecord,
  type QuotaAlertEntry,
} from "../../extensions/quota-alerts";
import quotaAlertsExtension from "../../extensions/quota-alerts";
import type { ProviderBudgetStatus } from "../../extensions/quota-visibility";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBudgetStatus(
  provider: string,
  state: "ok" | "warning" | "blocked",
  overrides: Partial<ProviderBudgetStatus> = {}
): ProviderBudgetStatus {
  return {
    provider,
    period: "weekly",
    unit: "tokens-cost",
    periodDays: 7,
    periodStartIso: "2026-04-10T00:00:00Z",
    periodEndIso: "2026-04-17T00:00:00Z",
    observedMessages: 10,
    observedTokens: 1000,
    observedCostUsd: 1.0,
    observedRequests: 10,
    projectedTokensEndOfPeriod: 5000,
    projectedCostUsdEndOfPeriod: 5.0,
    projectedRequestsEndOfPeriod: 50,
    warnPct: 75,
    hardPct: 100,
    state,
    notes: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isRateLimitText
// ---------------------------------------------------------------------------

describe("quota-alerts — isRateLimitText", () => {
  it("detecta 429 literal", () => {
    expect(isRateLimitText("Error 429: Too Many Requests")).toBe(true);
  });

  it("detecta rate limit case-insensitive", () => {
    expect(isRateLimitText("You have exceeded your RATE LIMIT")).toBe(true);
    expect(isRateLimitText("rate limit exceeded")).toBe(true);
  });

  it("detecta quota exceeded", () => {
    expect(isRateLimitText("quota exceeded for model")).toBe(true);
  });

  it("nao detecta texto normal", () => {
    expect(isRateLimitText("Task completed successfully.")).toBe(false);
    expect(isRateLimitText("Build passed.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractTextFromRecord
// ---------------------------------------------------------------------------

describe("quota-alerts — extractTextFromRecord", () => {
  it("extrai text de message.content como array", () => {
    const rec = {
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "hello 429 error" }] },
    };
    expect(extractTextFromRecord(rec)).toContain("hello 429 error");
  });

  it("extrai text de custom_message.content como string", () => {
    const rec = { type: "custom_message", content: "rate limit exceeded" };
    expect(extractTextFromRecord(rec)).toBe("rate limit exceeded");
  });

  it("retorna vazio para record sem conteudo", () => {
    expect(extractTextFromRecord({ type: "session" })).toBe("");
    expect(extractTextFromRecord(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parse429Streak
// ---------------------------------------------------------------------------

describe("quota-alerts — parse429Streak", () => {
  it("detecta streak de erros 429 dentro da janela", () => {
    const now = Date.now();
    const records = [
      { type: "message", timestamp: new Date(now - 1000).toISOString(), message: { content: "Error 429 rate limit" } },
      { type: "message", timestamp: new Date(now - 2000).toISOString(), message: { content: "429 Too Many Requests" } },
      { type: "message", timestamp: new Date(now - 3000).toISOString(), message: { content: "normal message" } },
    ];
    const hits = parse429Streak(records, 15 * 60 * 1000, 2, "test-provider");
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("nao detecta erros fora da janela de tempo", () => {
    const records = [
      {
        type: "message",
        // 2 hours ago — outside 15min window
        timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        message: { content: "rate limit exceeded" },
      },
    ];
    const hits = parse429Streak(records, 15 * 60 * 1000, 1, "test-provider");
    expect(hits.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildBudgetAlerts
// ---------------------------------------------------------------------------

describe("quota-alerts — buildBudgetAlerts", () => {
  it("gera alert block + overage-consent para provider blocked", () => {
    const alerts = buildBudgetAlerts([makeBudgetStatus("openai", "blocked")]);
    const severities = alerts.map((a) => a.severity);
    expect(severities).toContain("block");
    const sources = alerts.map((a) => a.source);
    expect(sources).toContain("overage-consent");
  });

  it("gera alert warn para provider warning", () => {
    const alerts = buildBudgetAlerts([makeBudgetStatus("anthropic", "warning")]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warn");
    expect(alerts[0].source).toBe("budget");
  });

  it("nao gera alert para provider ok", () => {
    const alerts = buildBudgetAlerts([makeBudgetStatus("gemini", "ok")]);
    expect(alerts).toHaveLength(0);
  });

  it("lista vazia de budgets retorna lista vazia", () => {
    expect(buildBudgetAlerts([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildWindowPressureAlerts
// ---------------------------------------------------------------------------

describe("quota-alerts — buildWindowPressureAlerts", () => {
  it("gera alerta quando projectedPctCost >= 80 e estado ok", () => {
    const budget = makeBudgetStatus("provider-x", "ok", {
      projectedPctCost: 85,
    });
    const alerts = buildWindowPressureAlerts([budget]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].source).toBe("window-pressure");
    expect(alerts[0].severity).toBe("warn");
  });

  it("nao gera alerta quando projectedPct < 80", () => {
    const budget = makeBudgetStatus("provider-x", "ok", {
      projectedPctCost: 70,
    });
    expect(buildWindowPressureAlerts([budget])).toHaveLength(0);
  });

  it("nao gera alerta para provider em estado warning ou blocked (ja coberto por buildBudgetAlerts)", () => {
    const budget = makeBudgetStatus("provider-x", "warning", {
      projectedPctCost: 90,
    });
    expect(buildWindowPressureAlerts([budget])).toHaveLength(0);
  });
});

function writeQuotaAlertsFixture(cwd: string, provider: string): void {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({
      piStack: {
        quotaVisibility: {
          defaultDays: 7,
          routeModelRefs: { [provider]: `${provider}/model-1` },
          providerBudgets: {
            [provider]: {
              period: "monthly",
              unit: "tokens-cost",
              monthlyQuotaTokens: 10,
              monthlyQuotaCostUsd: 0.01,
              warnPct: 50,
              hardPct: 80,
            },
          },
        },
      },
    }),
    "utf8",
  );

  const sessionRoot = join(cwd, ".sandbox", "pi-agent", "sessions", "workspace");
  mkdirSync(sessionRoot, { recursive: true });
  writeFileSync(
    join(sessionRoot, "2020-01-01T00-00-00-000Z_resumed.jsonl"),
    [
      JSON.stringify({ type: "session", timestamp: "2020-01-01T00:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        timestamp: new Date().toISOString(),
        provider,
        model: "model-1",
        message: { role: "assistant" },
        usage: { input: 20, output: 5, totalTokens: 25, cost: { total: 1 } },
      }),
    ].join("\n"),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// buildQuotaAlerts (integração — sem sessoes reais)
// ---------------------------------------------------------------------------

describe("quota-alerts — tool surface", () => {
  it("quota_alerts emits summary-first content with details preserved", async () => {
    const tools: any[] = [];
    const pi = {
      registerTool: vi.fn((tool) => tools.push(tool)),
      registerCommand: vi.fn(),
    } as unknown as Parameters<typeof quotaAlertsExtension>[0];

    quotaAlertsExtension(pi);
    const tool = tools.find((row) => row?.name === "quota_alerts");
    const result = await tool.execute(
      "tc-quota-alerts",
      { lookback_hours: 1 },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: "/nonexistent/path" },
    );

    expect(result.details.summary.total).toBeGreaterThanOrEqual(0);
    expect(String(result.content?.[0]?.text ?? "")).toContain("quota-alerts: total=");
    expect(String(result.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
    expect(String(result.content?.[0]?.text ?? "")).not.toContain('\"alerts\"');
  });
});

describe("quota-alerts — buildQuotaAlerts", () => {
  it("retorna resultado vazio quando nao ha sessoes nem configuracao", async () => {
    const result = await buildQuotaAlerts("/nonexistent/path", 24);
    expect(result.generatedAtIso).toBeDefined();
    expect(result.alerts).toBeInstanceOf(Array);
    expect(result.summary.total).toBe(0);
  });

  it("estrutura do resultado e correta", async () => {
    const result = await buildQuotaAlerts("/nonexistent/path", 1);
    expect(result).toHaveProperty("generatedAtIso");
    expect(result).toHaveProperty("alerts");
    expect(result).toHaveProperty("summary");
    expect(result.summary).toHaveProperty("info");
    expect(result.summary).toHaveProperty("warn");
    expect(result.summary).toHaveProperty("block");
    expect(result.summary).toHaveProperty("total");
  });

  it("usa cwd ao gerar alertas de orçamento para sessões sandbox retomadas", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "quota-alerts-"));
    try {
      const provider = "test-alerts-provider";
      writeQuotaAlertsFixture(cwd, provider);

      const result = await buildQuotaAlerts(cwd, 24);

      expect(result.summary.block).toBeGreaterThanOrEqual(2);
      expect(result.alerts.some((a) => a.provider === provider && a.source === "budget")).toBe(true);
      expect(result.alerts.some((a) => a.provider === provider && a.source === "overage-consent")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
