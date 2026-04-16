import { describe, expect, it } from "vitest";
import {
  parseWhichLikeOutput,
  parseClaudeCodeRequestBudget,
  checkBudgetGate,
  buildProviderHint,
} from "../../extensions/claude-code-adapter";

describe("claude-code adapter — parseWhichLikeOutput", () => {
  it("retorna primeira linha válida", () => {
    expect(parseWhichLikeOutput("C:/tools/claude.exe\nC:/other/claude.exe\n")).toBe("C:/tools/claude.exe");
    expect(parseWhichLikeOutput("\n\n")).toBeUndefined();
    expect(parseWhichLikeOutput("  /usr/local/bin/claude  ")).toBe("/usr/local/bin/claude");
  });
});

describe("claude-code adapter — parseClaudeCodeRequestBudget", () => {
  it("retorna defaults para input vazio", () => {
    const cfg = parseClaudeCodeRequestBudget({});
    expect(cfg.sessionRequestCap).toBe(20);
    expect(cfg.warnFraction).toBe(0.75);
  });

  it("aceita valores customizados válidos", () => {
    const cfg = parseClaudeCodeRequestBudget({ sessionRequestCap: 50, warnFraction: 0.9 });
    expect(cfg.sessionRequestCap).toBe(50);
    expect(cfg.warnFraction).toBe(0.9);
  });

  it("ignora sessionRequestCap <= 0 e usa default", () => {
    const cfg = parseClaudeCodeRequestBudget({ sessionRequestCap: -5 });
    expect(cfg.sessionRequestCap).toBe(20);
  });

  it("ignora warnFraction fora do range (0,1) e usa default", () => {
    const cfgHigh = parseClaudeCodeRequestBudget({ warnFraction: 1.5 });
    expect(cfgHigh.warnFraction).toBe(0.75);
    const cfgZero = parseClaudeCodeRequestBudget({ warnFraction: 0 });
    expect(cfgZero.warnFraction).toBe(0.75);
  });
});

describe("claude-code adapter — checkBudgetGate", () => {
  const cfg = parseClaudeCodeRequestBudget({ sessionRequestCap: 20, warnFraction: 0.75 });

  it("estado ok quando requests abaixo do warnAt", () => {
    const state = checkBudgetGate(5, cfg);
    expect(state.state).toBe("ok");
    expect(state.requestsUsed).toBe(5);
    expect(state.requestsCap).toBe(20);
    expect(state.warnAt).toBe(15);
    expect(state.notes).toHaveLength(0);
  });

  it("estado warn quando requests no threshold ou acima", () => {
    const atWarn = checkBudgetGate(15, cfg);
    expect(atWarn.state).toBe("warn");
    expect(atWarn.notes.length).toBeGreaterThan(0);
    expect(atWarn.notes[0]).toMatch(/approaching/i);
  });

  it("estado block quando requests atingem o cap", () => {
    const atCap = checkBudgetGate(20, cfg);
    expect(atCap.state).toBe("block");
    expect(atCap.notes[0]).toMatch(/cap reached/i);

    const overCap = checkBudgetGate(25, cfg);
    expect(overCap.state).toBe("block");
  });

  it("warnAt calculado corretamente como ceil(cap * warnFraction)", () => {
    const cfg7 = parseClaudeCodeRequestBudget({ sessionRequestCap: 7, warnFraction: 0.5 });
    const state = checkBudgetGate(0, cfg7);
    expect(state.warnAt).toBe(4); // ceil(7 * 0.5) = 4
  });
});

describe("claude-code adapter — buildProviderHint", () => {
  it("retorna routeModelRef correto", () => {
    const hint = buildProviderHint("/usr/bin/claude");
    expect(hint.suggestedRouteModelRef).toBe("claude-code/claude-sonnet-4-6");
    expect(hint.budgetUnit).toBe("requests");
    expect(hint.notes.some((n) => n.includes("subscription"))).toBe(true);
  });

  it("inclui nota de binary não encontrado quando path ausente", () => {
    const hint = buildProviderHint(undefined);
    expect(hint.notes[0]).toMatch(/binary not found/i);
  });
});
