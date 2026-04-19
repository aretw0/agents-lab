import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildProgressBar,
  getMode,
  setMode,
  shouldShowPanel,
  buildPanelLines,
  triggerAuto,
  resetAuto,
  resolvePanelMode,
  type PanelMode,
} from "../../extensions/quota-panel";
import type { QuotaStatus, ProviderBudgetStatus } from "../../extensions/quota-visibility";

describe("quota-panel — buildProgressBar", () => {
  it("retorna barra vazia para 0%", () => {
    expect(buildProgressBar(0, 10)).toBe("░░░░░░░░░░");
  });
  it("retorna barra cheia para 100%", () => {
    expect(buildProgressBar(100, 10)).toBe("██████████");
  });
  it("usa meio bloco para frações >= 50%", () => {
    // 46% de 10 chars = 4.6 → 4 cheios + meio + 5 vazios
    expect(buildProgressBar(46, 10)).toBe("████▌░░░░░");
  });
  it("sem meio bloco para frações < 50%", () => {
    // 41% de 10 chars = 4.1 → 4 cheios + 6 vazios
    expect(buildProgressBar(41, 10)).toBe("████░░░░░░");
  });
  it("clipa valores acima de 100", () => {
    expect(buildProgressBar(120, 10)).toBe("██████████");
  });
  it("clipa valores abaixo de 0", () => {
    expect(buildProgressBar(-5, 10)).toBe("░░░░░░░░░░");
  });
  it("funciona com largura 0", () => {
    expect(buildProgressBar(50, 0)).toBe("");
  });
});

describe("quota-panel — mode state", () => {
  beforeEach(() => {
    setMode("off");
  });

  it("resolvePanelMode aceita off|on|auto e fallback em inválido", () => {
    expect(resolvePanelMode("off")).toBe("off");
    expect(resolvePanelMode("on")).toBe("on");
    expect(resolvePanelMode("auto")).toBe("auto");
    expect(resolvePanelMode("x", "auto")).toBe("auto");
  });

  it("modo padrão é off", () => {
    expect(getMode()).toBe("off");
  });
  it("shouldShowPanel retorna false no modo off", () => {
    setMode("off");
    expect(shouldShowPanel()).toBe(false);
  });
  it("shouldShowPanel retorna true no modo on", () => {
    setMode("on");
    expect(shouldShowPanel()).toBe(true);
  });
  it("shouldShowPanel retorna false no modo auto sem trigger", () => {
    setMode("auto");
    expect(shouldShowPanel()).toBe(false);
  });
  it("setMode para off reseta autoTriggered", () => {
    setMode("auto");
    triggerAuto();
    setMode("off");
    expect(shouldShowPanel()).toBe(false);
  });
  it("triggerAuto + modo auto → shouldShowPanel true", () => {
    setMode("auto");
    triggerAuto();
    expect(shouldShowPanel()).toBe(true);
  });
  it("resetAuto + modo auto → shouldShowPanel false", () => {
    setMode("auto");
    triggerAuto();
    resetAuto();
    expect(shouldShowPanel()).toBe(false);
  });
});

function makeMinimalBudgetStatus(
  provider: string,
  state: "ok" | "warning" | "blocked",
  overrides: Partial<ProviderBudgetStatus> = {}
): ProviderBudgetStatus {
  return {
    provider,
    period: "monthly",
    unit: "tokens-cost",
    periodDays: 30,
    periodStartIso: "2026-04-01T00:00:00Z",
    periodEndIso: "2026-04-30T23:59:59Z",
    observedMessages: 10,
    observedTokens: 50_000,
    observedCostUsd: 6.0,
    observedRequests: 10,
    projectedTokensEndOfPeriod: 100_000,
    projectedCostUsdEndOfPeriod: 12.0,
    projectedRequestsEndOfPeriod: 20,
    periodCostUsdCap: 60,
    usedPctCost: 10,
    projectedPctCost: 20,
    warnPct: 75,
    hardPct: 100,
    state,
    notes: [],
    ...overrides,
  };
}

function makeMinimalQuotaStatus(budgets: ProviderBudgetStatus[]): QuotaStatus {
  return {
    source: {
      sessionsRoot: "/fake",
      scannedFiles: 0,
      parsedSessions: 0,
      parsedEvents: 0,
      windowDays: 30,
      generatedAtIso: "2026-04-16T12:00:00Z",
    },
    totals: { sessions: 0, userMessages: 0, assistantMessages: 0, toolResultMessages: 0, tokens: 0, costUsd: 0 },
    burn: { activeDays: 1, avgTokensPerActiveDay: 0, avgTokensPerCalendarDay: 0, projectedTokensNext7d: 0, avgCostPerCalendarDay: 0, projectedCostNext7dUsd: 0 },
    quota: {},
    providerBudgetPolicy: { configuredProviders: budgets.length, allocationWarnings: [] },
    providerBudgets: budgets,
    daily: [],
    models: [],
    providerWindows: [],
    topSessionsByTokens: [],
    topSessionsByCost: [],
  };
}

describe("quota-panel — buildPanelLines", () => {
  beforeEach(() => {
    setMode("off");
    resetAuto();
  });

  it("retorna mensagem de loading quando status é null", () => {
    const lines = buildPanelLines(null, 80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("loading");
  });

  it("retorna array vazio quando não há budgets nem windows", () => {
    const status = makeMinimalQuotaStatus([]);
    const lines = buildPanelLines(status, 80);
    expect(lines).toHaveLength(0);
  });

  it("inclui seção de budgets quando há providers configurados", () => {
    const status = makeMinimalQuotaStatus([makeMinimalBudgetStatus("google-antigravity", "ok")]);
    const lines = buildPanelLines(status, 80);
    expect(lines.some((l) => l.includes("Provider Budgets"))).toBe(true);
    expect(lines.some((l) => l.includes("antigrav"))).toBe(true);
  });

  it("mostra ⚠ para provider em warning", () => {
    const status = makeMinimalQuotaStatus([
      makeMinimalBudgetStatus("openai-codex", "warning", { usedPctCost: 80 }),
    ]);
    const lines = buildPanelLines(status, 80);
    expect(lines.some((l) => l.includes("⚠"))).toBe(true);
  });

  it("mostra ✗ para provider blocked", () => {
    const status = makeMinimalQuotaStatus([
      makeMinimalBudgetStatus("openai-codex", "blocked", { usedPctCost: 100 }),
    ]);
    const lines = buildPanelLines(status, 80);
    expect(lines.some((l) => l.includes("✗"))).toBe(true);
  });

  it("inclui seção Route Advisory quando há budgets", () => {
    const status = makeMinimalQuotaStatus([
      makeMinimalBudgetStatus("google-antigravity", "ok"),
      makeMinimalBudgetStatus("openai-codex", "warning"),
    ]);
    const lines = buildPanelLines(status, 80);
    expect(lines.some((l) => l.includes("Route Advisory"))).toBe(true);
    expect(lines.some((l) => l.includes("balanced →"))).toBe(true);
  });
});

import quotaPanelExtension from "../../extensions/quota-panel";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
  } as unknown as Parameters<typeof quotaPanelExtension>[0];
}

describe("quota-panel — registration smoke", () => {
  it("não crasha ao ser carregada", () => {
    expect(() => quotaPanelExtension(makeMockPi())).not.toThrow();
  });

  it("registra handler para turn_start", () => {
    const pi = makeMockPi();
    quotaPanelExtension(pi);
    const events = (pi.on as ReturnType<typeof vi.fn>).mock.calls.map(([e]: [string]) => e);
    expect(events).toContain("turn_start");
  });

  it("registra o comando /qp", () => {
    const pi = makeMockPi();
    quotaPanelExtension(pi);
    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]: [string]) => name,
    );
    expect(commands).toContain("qp");
  });
});
