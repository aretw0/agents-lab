export interface OutputPolicyConfig {
	compactLargeJson: boolean;
	maxInlineJsonChars: number;
}

export interface CandidateRetentionConfig {
	enabled: boolean;
	maxEntries: number;
	maxAgeDays: number;
}

export const DEFAULT_OUTPUT_POLICY_CONFIG: OutputPolicyConfig = {
	compactLargeJson: true,
	maxInlineJsonChars: 1800,
};

export const DEFAULT_CANDIDATE_RETENTION_CONFIG: CandidateRetentionConfig = {
	enabled: true,
	maxEntries: 40,
	maxAgeDays: 14,
};

export function resolveColonyPilotOutputPolicy(
	raw?: Partial<OutputPolicyConfig>,
): OutputPolicyConfig {
	const maxInline =
		typeof raw?.maxInlineJsonChars === "number" &&
		Number.isFinite(raw.maxInlineJsonChars)
			? Math.floor(raw.maxInlineJsonChars)
			: DEFAULT_OUTPUT_POLICY_CONFIG.maxInlineJsonChars;

	return {
		compactLargeJson: raw?.compactLargeJson !== false,
		maxInlineJsonChars: Math.max(400, Math.min(20_000, maxInline)),
	};
}

export function resolveColonyPilotCandidateRetentionConfig(
	raw?: Partial<CandidateRetentionConfig>,
): CandidateRetentionConfig {
	const maxEntriesRaw =
		typeof raw?.maxEntries === "number" && Number.isFinite(raw.maxEntries)
			? Math.floor(raw.maxEntries)
			: DEFAULT_CANDIDATE_RETENTION_CONFIG.maxEntries;
	const maxAgeDaysRaw =
		typeof raw?.maxAgeDays === "number" && Number.isFinite(raw.maxAgeDays)
			? Math.floor(raw.maxAgeDays)
			: DEFAULT_CANDIDATE_RETENTION_CONFIG.maxAgeDays;

	return {
		enabled: raw?.enabled !== false,
		maxEntries: Math.max(1, Math.min(500, maxEntriesRaw)),
		maxAgeDays: Math.max(1, Math.min(365, maxAgeDaysRaw)),
	};
}

export function formatToolJsonOutput(
	label: string,
	data: unknown,
	policy: OutputPolicyConfig,
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
