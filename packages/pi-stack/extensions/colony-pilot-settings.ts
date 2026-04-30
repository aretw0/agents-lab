import {
	readDerivedAgentSettings as readDerivedAgentSettingsImpl,
	readProjectSettings as readProjectSettingsImpl,
	resolveProjectSettingsTopology,
	writeDerivedAgentSettings as writeDerivedAgentSettingsImpl,
	writeProjectSettings as writeProjectSettingsImpl,
} from "./context-watchdog-storage";
import {
	type ProviderBudgetMap,
	parseProviderBudgets,
	safeNum,
} from "./quota-visibility";

export interface QuotaVisibilityBudgetSettings {
	weeklyQuotaTokens?: number;
	weeklyQuotaCostUsd?: number;
	weeklyQuotaRequests?: number;
	monthlyQuotaTokens?: number;
	monthlyQuotaCostUsd?: number;
	monthlyQuotaRequests?: number;
	providerBudgets: ProviderBudgetMap;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export { resolveProjectSettingsTopology };

export function parseColonyPilotSettings<
	TSettings extends object = Record<string, unknown>,
>(cwd: string): TSettings {
	const json = readProjectSettings(cwd);
	return (isPlainObject(json.piStack) && isPlainObject(json.piStack.colonyPilot)
		? json.piStack.colonyPilot
		: isPlainObject(json.extensions) && isPlainObject(json.extensions.colonyPilot)
			? json.extensions.colonyPilot
			: {}) as TSettings;
}

export function parseQuotaVisibilityBudgetSettings(
	cwd: string,
): QuotaVisibilityBudgetSettings {
	const json = readProjectSettings(cwd);
	const cfg = isPlainObject(json.piStack) && isPlainObject(json.piStack.quotaVisibility)
		? json.piStack.quotaVisibility
		: {};

	return {
		weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
		weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
		weeklyQuotaRequests: safeNum(cfg.weeklyQuotaRequests) || undefined,
		monthlyQuotaTokens: safeNum(cfg.monthlyQuotaTokens) || undefined,
		monthlyQuotaCostUsd: safeNum(cfg.monthlyQuotaCostUsd) || undefined,
		monthlyQuotaRequests: safeNum(cfg.monthlyQuotaRequests) || undefined,
		providerBudgets: parseProviderBudgets(cfg.providerBudgets),
	};
}

export function readProjectSettings(cwd: string): Record<string, unknown> {
	return readProjectSettingsImpl(cwd);
}

export function writeProjectSettings(
	cwd: string,
	data: Record<string, unknown>,
): void {
	writeProjectSettingsImpl(cwd, data);
}

export function readDerivedAgentSettings(cwd: string, agentId = "agent"): Record<string, unknown> {
	return readDerivedAgentSettingsImpl(cwd, agentId);
}

export function writeDerivedAgentSettings(
	cwd: string,
	agentId: string,
	data: Record<string, unknown>,
): void {
	writeDerivedAgentSettingsImpl(cwd, agentId, data);
}
