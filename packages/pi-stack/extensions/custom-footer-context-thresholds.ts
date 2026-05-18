export type ContextThresholds = { warningPct: number; errorPct: number };
export type ContextThresholdOverrides = {
	default?: Partial<ContextThresholds>;
	byProvider?: Record<string, Partial<ContextThresholds>>;
	byProviderModel?: Record<string, Partial<ContextThresholds>>;
};

const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = { warningPct: 50, errorPct: 75 };
const ANTHROPIC_CONTEXT_THRESHOLDS: ContextThresholds = { warningPct: 65, errorPct: 85 };
const GITHUB_COPILOT_GPT53_CODEX_CONTEXT_THRESHOLDS: ContextThresholds = { warningPct: 45, errorPct: 65 };

function normalizeThresholds(
	input: Partial<ContextThresholds> | undefined,
	fallback: ContextThresholds,
): ContextThresholds {
	const warning = Number.isFinite(Number(input?.warningPct))
		? Math.max(1, Math.min(99, Number(input?.warningPct)))
		: fallback.warningPct;
	const error = Number.isFinite(Number(input?.errorPct))
		? Math.max(warning + 1, Math.min(100, Number(input?.errorPct)))
		: fallback.errorPct;
	return {
		warningPct: Math.floor(warning),
		errorPct: Math.floor(error),
	};
}

function isGithubCopilotGpt53Codex(provider: string, modelId: string): boolean {
	return provider === "github-copilot" && modelId.trim().toLowerCase() === "gpt-5.3-codex";
}

export function resolveContextThresholds(
	modelProvider: string | null,
	modelId: string,
	overrides?: ContextThresholdOverrides,
): ContextThresholds {
	const provider = (modelProvider ?? "").trim().toLowerCase();
	const normalizedModelId = String(modelId ?? "").trim().toLowerCase();
	const base = provider === "anthropic"
		? ANTHROPIC_CONTEXT_THRESHOLDS
		: isGithubCopilotGpt53Codex(provider, normalizedModelId)
			? GITHUB_COPILOT_GPT53_CODEX_CONTEXT_THRESHOLDS
			: DEFAULT_CONTEXT_THRESHOLDS;

	let resolved = normalizeThresholds(overrides?.default, base);
	if (provider && overrides?.byProvider?.[provider]) {
		resolved = normalizeThresholds(overrides.byProvider[provider], resolved);
	}

	const modelKey = provider ? `${provider}/${normalizedModelId}` : normalizedModelId;
	const byModel = overrides?.byProviderModel?.[modelKey];
	if (byModel) {
		resolved = normalizeThresholds(byModel, resolved);
	}

	return resolved;
}
