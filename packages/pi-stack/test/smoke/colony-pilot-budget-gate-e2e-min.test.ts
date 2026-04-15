import { describe, it, expect } from "vitest";
import type { ProviderBudgetStatus } from "../../extensions/quota-visibility";
import {
  evaluateProviderBudgetGate,
  resolveColonyPilotBudgetPolicy,
  type AntColonyToolInput,
} from "../../extensions/colony-pilot";

function mkStatus(partial: Partial<ProviderBudgetStatus> & { provider: string; state: "ok" | "warning" | "blocked" }): ProviderBudgetStatus {
  return {
    provider: partial.provider,
    owner: partial.owner,
    period: partial.period ?? "monthly",
    periodDays: partial.periodDays ?? 30,
    periodStartIso: partial.periodStartIso ?? "2026-04-01T00:00:00.000Z",
    periodEndIso: partial.periodEndIso ?? "2026-04-30T23:59:59.999Z",
    observedMessages: partial.observedMessages ?? 10,
    observedTokens: partial.observedTokens ?? 1000,
    observedCostUsd: partial.observedCostUsd ?? 2,
    projectedTokensEndOfPeriod: partial.projectedTokensEndOfPeriod ?? 6000,
    projectedCostUsdEndOfPeriod: partial.projectedCostUsdEndOfPeriod ?? 12,
    periodTokensCap: partial.periodTokensCap ?? 5000,
    periodCostUsdCap: partial.periodCostUsdCap ?? 10,
    usedPctTokens: partial.usedPctTokens ?? 20,
    usedPctCost: partial.usedPctCost ?? 20,
    projectedPctTokens: partial.projectedPctTokens ?? 120,
    projectedPctCost: partial.projectedPctCost ?? 120,
    warnPct: partial.warnPct ?? 80,
    hardPct: partial.hardPct ?? 100,
    state: partial.state,
    notes: partial.notes ?? [],
  };
}

describe("colony-pilot provider-budget gate e2e mínimo (determinístico)", () => {
  it("bloqueia launch quando provider usado está em BLOCK", () => {
    const policy = resolveColonyPilotBudgetPolicy({
      enabled: true,
      enforceProviderBudgetBlock: true,
      allowProviderBudgetOverride: true,
      providerBudgetOverrideToken: "budget-override:",
    });

    const input: AntColonyToolInput = {
      goal: "Implementar fix crítico",
      workerModel: "github-copilot/claude-sonnet-4.6",
    };

    const evalResult = evaluateProviderBudgetGate(
      input,
      "github-copilot/claude-sonnet-4.6",
      input.goal,
      [mkStatus({ provider: "github-copilot", state: "blocked" })],
      [],
      policy
    );

    expect(evalResult.ok).toBe(false);
    expect(evalResult.checked).toBe(true);
    expect(evalResult.blockedProviders).toEqual(["github-copilot"]);
    expect(evalResult.overrideReason).toBeUndefined();
  });

  it("permite launch com override auditável quando policy permite", () => {
    const policy = resolveColonyPilotBudgetPolicy({
      enabled: true,
      enforceProviderBudgetBlock: true,
      allowProviderBudgetOverride: true,
      providerBudgetOverrideToken: "budget-override:",
    });

    const input: AntColonyToolInput = {
      goal: "Incidente produção budget-override: correção urgente acordada com owner",
      workerModel: "github-copilot/claude-sonnet-4.6",
    };

    const evalResult = evaluateProviderBudgetGate(
      input,
      "github-copilot/claude-sonnet-4.6",
      input.goal,
      [mkStatus({ provider: "github-copilot", state: "blocked" })],
      [],
      policy
    );

    expect(evalResult.ok).toBe(true);
    expect(evalResult.checked).toBe(true);
    expect(evalResult.blockedProviders).toEqual(["github-copilot"]);
    expect(evalResult.overrideReason).toBe("correção urgente acordada com owner");
  });

  it("não bloqueia quando BLOCK existe em provider não utilizado no run", () => {
    const policy = resolveColonyPilotBudgetPolicy({
      enabled: true,
      enforceProviderBudgetBlock: true,
      allowProviderBudgetOverride: false,
    });

    const input: AntColonyToolInput = {
      goal: "Refactor interno",
      workerModel: "openai-codex/gpt-5.3-codex",
    };

    const evalResult = evaluateProviderBudgetGate(
      input,
      "openai-codex/gpt-5.3-codex",
      input.goal,
      [mkStatus({ provider: "github-copilot", state: "blocked" })],
      [],
      policy
    );

    expect(evalResult.ok).toBe(true);
    expect(evalResult.checked).toBe(true);
    expect(evalResult.blockedProviders).toEqual([]);
    expect(evalResult.consideredProviders).toEqual(["openai-codex"]);
  });
});
