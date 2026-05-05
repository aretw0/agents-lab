import type { ProviderBudgetMap, ProviderWindowHours } from "./quota-visibility-types";

export interface QuotaVisibilitySettings {
	defaultDays?: number;
	weeklyQuotaTokens?: number;
	weeklyQuotaCostUsd?: number;
	weeklyQuotaRequests?: number;
	monthlyQuotaTokens?: number;
	monthlyQuotaCostUsd?: number;
	monthlyQuotaRequests?: number;
	providerWindowHours?: ProviderWindowHours;
	providerBudgets?: ProviderBudgetMap;
	routeModelRefs?: Record<string, string>;
	outputPolicy?: QuotaToolOutputPolicy;
}

export interface QuotaToolOutputPolicy {
	compactLargeJson: boolean;
	maxInlineJsonChars: number;
}

export const DEFAULT_TOOL_OUTPUT_POLICY: QuotaToolOutputPolicy = {
	compactLargeJson: true,
	maxInlineJsonChars: 1200,
};

export function resolveQuotaToolOutputPolicy(
	settings?: QuotaVisibilitySettings,
): QuotaToolOutputPolicy {
	const raw = settings?.outputPolicy;
	const maxInline =
		typeof raw?.maxInlineJsonChars === "number" &&
		Number.isFinite(raw.maxInlineJsonChars)
			? Math.max(400, Math.min(20_000, Math.floor(raw.maxInlineJsonChars)))
			: DEFAULT_TOOL_OUTPUT_POLICY.maxInlineJsonChars;

	return {
		compactLargeJson: raw?.compactLargeJson !== false,
		maxInlineJsonChars: maxInline,
	};
}

export function formatQuotaToolJsonOutput(
	label: string,
	data: unknown,
	policy: QuotaToolOutputPolicy = DEFAULT_TOOL_OUTPUT_POLICY,
): string {
	const pretty = JSON.stringify(data, null, 2);
	if (!policy.compactLargeJson || pretty.length <= policy.maxInlineJsonChars) {
		return pretty;
	}

	const maxPreview = Math.max(200, policy.maxInlineJsonChars - 120);
	const preview = pretty.slice(0, maxPreview).trimEnd();
	return [
		`${label}: output compactado (${pretty.length} chars > ${policy.maxInlineJsonChars})`,
		"preview:",
		preview,
		"...",
		"(payload completo disponível em details)",
	].join("\n");
}
