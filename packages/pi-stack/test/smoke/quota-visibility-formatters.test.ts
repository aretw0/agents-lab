import { describe, expect, it } from "vitest";
import {
  formatBudgetStatusLegend,
  formatBudgetStatusParts,
  shortBudgetScopeLabel,
  shortProviderLabel,
  type ProviderBudgetStatus,
} from "../../extensions/quota-visibility";

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

describe("quota-visibility TUI footer formatters", () => {
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
    it("preserva escopo model-specific e account-specific no label curto", () => {
      expect(shortBudgetScopeLabel({ provider: "openai-codex", model: "gpt-worker" })).toBe("codex/gpt-worker");
      expect(shortBudgetScopeLabel({ provider: "github-copilot", account: "team-a" })).toBe("copilot@team-a");
    });
  });

  describe("formatBudgetStatusParts", () => {
    it("retorna lista vazia para entrada vazia", () => {
      expect(formatBudgetStatusParts([])).toEqual([]);
    });

    it("usa ✓ para estado ok", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("openai-codex", "ok", 12)]);
      expect(parts).toEqual(["✓codex:used=12%"]);
    });

    it("usa ⚠ para estado warning", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("github-copilot", "warning", 78)]);
      expect(parts).toEqual(["⚠copilot:used=78%"]);
    });

    it("usa ✗ para estado blocked", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("github-copilot", "blocked", 100)]);
      expect(parts).toEqual(["✗copilot:used=100%"]);
    });

    it("usa o maior pct entre tokens/cost/requests", () => {
      const b: ProviderBudgetStatus = {
        ...makeBudgetStatus("openai-codex", "ok", 10),
        usedPctTokens: 55,
        usedPctCost: 10,
        usedPctRequests: 30,
      };
      const [part] = formatBudgetStatusParts([b]);
      expect(part).toBe("✓codex:used=55%");
    });

    it("arredonda pct fracionário", () => {
      const parts = formatBudgetStatusParts([makeBudgetStatus("openai-codex", "ok", 12.7)]);
      expect(parts).toEqual(["✓codex:used=13%"]);
    });

    it("formata múltiplos providers na ordem recebida", () => {
      const parts = formatBudgetStatusParts([
        makeBudgetStatus("openai-codex", "ok", 0),
        makeBudgetStatus("github-copilot", "blocked", 100),
        makeBudgetStatus("google-gemini-cli", "ok", 8),
      ]);
      expect(parts).toEqual(["✓codex:used=0%", "✗copilot:used=100%", "✓gemini:used=8%"]);
    });

    it("diferencia provider agregado de budget model-specific no footer compacto", () => {
      const parts = formatBudgetStatusParts([
        makeBudgetStatus("openai-codex", "blocked", 100),
        {
          ...makeBudgetStatus("openai-codex", "ok", 2),
          model: "gpt-worker",
          providerModelKey: "openai-codex/gpt-worker",
          unit: "requests",
          usedPctRequests: 2,
        },
      ]);
      expect(parts).toEqual(["✗codex:used=100%", "✓codex/gpt-worker:used=2%"]);
    });

    it("trata undefined como 0 (safeNum)", () => {
      const b: ProviderBudgetStatus = {
        ...makeBudgetStatus("openai-codex", "ok", 0),
        usedPctCost: undefined,
        usedPctTokens: undefined,
      };
      const [part] = formatBudgetStatusParts([b]);
      expect(part).toBe("✓codex:used=0%");
    });

    it("explica símbolos, percentual local usado e diferença de WHAM", () => {
      const legend = formatBudgetStatusLegend().join("\n");
      expect(legend).toContain("✓=OK, ⚠=WARN, ✗=BLOCK");
      expect(legend).toContain("used=%");
      expect(legend).toContain("max local used pressure");
      expect(legend).toContain("not remaining quota");
      expect(legend).toContain("WHAM headroom");
    });
  });
});
