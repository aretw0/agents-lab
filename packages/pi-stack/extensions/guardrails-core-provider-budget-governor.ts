import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseProviderBudgets,
  safeNum,
  type ProviderBudgetMap,
  type ProviderBudgetStatus,
} from "./quota-visibility";

export interface ProviderBudgetGovernorConfig {
  enabled: boolean;
  lookbackDays: number;
  allowOverride: boolean;
  overrideToken: string;
  recoveryCommands: string[];
}

export interface ProviderBudgetGovernorSnapshot {
  atIso: string;
  budgets: ProviderBudgetStatus[];
}

export interface QuotaBudgetSettings {
  weeklyQuotaTokens?: number;
  weeklyQuotaCostUsd?: number;
  weeklyQuotaRequests?: number;
  monthlyQuotaTokens?: number;
  monthlyQuotaCostUsd?: number;
  monthlyQuotaRequests?: number;
  providerBudgets: ProviderBudgetMap;
}

export type ProviderBudgetGovernorMisconfig = "missing-provider-budgets";

export function readQuotaBudgetSettings(cwd: string): QuotaBudgetSettings {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return { providerBudgets: {} };
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.quotaVisibility ?? {};
    return {
      weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
      weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
      weeklyQuotaRequests: safeNum(cfg.weeklyQuotaRequests) || undefined,
      monthlyQuotaTokens: safeNum(cfg.monthlyQuotaTokens) || undefined,
      monthlyQuotaCostUsd: safeNum(cfg.monthlyQuotaCostUsd) || undefined,
      monthlyQuotaRequests: safeNum(cfg.monthlyQuotaRequests) || undefined,
      providerBudgets: parseProviderBudgets(cfg.providerBudgets),
    };
  } catch {
    return { providerBudgets: {} };
  }
}

export function resolveProviderBudgetGovernorConfig(cwd: string): ProviderBudgetGovernorConfig {
  const defaults: ProviderBudgetGovernorConfig = {
    enabled: false,
    lookbackDays: 30,
    allowOverride: true,
    overrideToken: "budget-override:",
    recoveryCommands: ["doctor", "quota-visibility", "model", "login"],
  };

  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return defaults;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.providerBudgetGovernor ?? {};
    const lookback = Number.isFinite(Number(cfg.lookbackDays)) ? Math.floor(Number(cfg.lookbackDays)) : defaults.lookbackDays;
    const recoveryCommands = Array.isArray(cfg.recoveryCommands)
      ? cfg.recoveryCommands
        .filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x: string) => x.trim().toLowerCase())
      : defaults.recoveryCommands;

    return {
      enabled: cfg?.enabled === true,
      lookbackDays: Math.max(1, Math.min(90, lookback)),
      allowOverride: cfg?.allowOverride !== false,
      overrideToken: typeof cfg?.overrideToken === "string" && cfg.overrideToken.trim().length > 0 ? cfg.overrideToken.trim() : defaults.overrideToken,
      recoveryCommands,
    };
  } catch {
    return defaults;
  }
}

export function detectProviderBudgetGovernorMisconfig(
  enabled: boolean,
  providerBudgets: ProviderBudgetMap,
): ProviderBudgetGovernorMisconfig | undefined {
  if (!enabled) return undefined;
  if (Object.keys(providerBudgets).length === 0) return "missing-provider-budgets";
  return undefined;
}

export function providerBudgetGovernorMisconfigReason(
  issue: ProviderBudgetGovernorMisconfig,
): string {
  if (issue === "missing-provider-budgets") {
    return [
      "guardrails-core: providerBudgetGovernor habilitado sem quotaVisibility.providerBudgets.",
      "BLOCK por provider não será aplicado até configurar budgets em .pi/settings.json.",
    ].join(" ");
  }
  return "guardrails-core: providerBudgetGovernor misconfigured.";
}
