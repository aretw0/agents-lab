/**
 * Shared config/constants for monitor-provider patch.
 * Kept in dedicated module to avoid monolithic extension files.
 */

/** Classifier names from @davidorex/pi-behavior-monitors */
export const CLASSIFIERS = [
	"commit-hygiene-classifier",
	"fragility-classifier",
	"hedge-classifier",
	"unauthorized-action-classifier",
	"work-quality-classifier",
] as const;

/** Known safe defaults for provider-aware classifier model routing */
export const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
	"github-copilot": "github-copilot/claude-haiku-4.5",
	"openai-codex": "openai-codex/gpt-5.4-mini",
};

export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export const THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

export const DEFAULT_THINKING: ThinkingLevel = "off";

export const SETTINGS_ROOT = ["piStack", "monitorProviderPatch"];
export const HEDGE_HISTORY_SETTING_PATH = [
	...SETTINGS_ROOT,
	"hedgeConversationHistory",
];
export const HEDGE_WHEN_SETTING_PATH = [...SETTINGS_ROOT, "hedgeWhen"];
export const HEDGE_PROJECT_CONTEXT_SETTING_PATH = [
	...SETTINGS_ROOT,
	"hedgeIncludeProjectContext",
];
export const CLASSIFIER_MODEL_SETTING_PATH = [...SETTINGS_ROOT, "classifierModel"];
export const CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH = [
	...SETTINGS_ROOT,
	"classifierModelByProvider",
];
export const CLASSIFIER_THINKING_SETTING_PATH = [
	...SETTINGS_ROOT,
	"classifierThinking",
];

export const DEFAULT_HEDGE_WHEN = "has_bash";

export const HEDGE_WHEN_PATTERNS = [
	"always",
	"has_tool_results",
	"has_file_writes",
	"has_bash",
] as const;

export const HEDGE_LEAN_BASE_CONTEXT = [
	"user_text",
	"tool_calls",
	"custom_messages",
	"assistant_text",
] as const;

export const CLASSIFIER_SYSTEM_PROMPT_LINES = [
	"You are a behavior monitor classifier.",
	"Return your decision by calling classify_verdict exactly once.",
	"Use CLEAN when no issue is found; FLAG/NEW require a short description.",
	"Do not fail just because monitor instructions are empty; classify from available context.",
] as const;
