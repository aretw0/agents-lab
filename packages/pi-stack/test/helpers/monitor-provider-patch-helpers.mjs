/**
 * Shared helpers for monitor-provider-patch tests.
 * Extracted to keep test files under complexity threshold.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CLASSIFIERS = [
	"commit-hygiene-classifier",
	"fragility-classifier",
	"hedge-classifier",
	"unauthorized-action-classifier",
	"work-quality-classifier",
];

const COPILOT_MODEL = "github-copilot/claude-haiku-4.5";
const HEDGE_HISTORY_SETTING_PATH = [
	"piStack",
	"monitorProviderPatch",
	"hedgeConversationHistory",
];
const HEDGE_WHEN_SETTING_PATH = [
	"piStack",
	"monitorProviderPatch",
	"hedgeWhen",
];
const HEDGE_PROJECT_CONTEXT_SETTING_PATH = [
	"piStack",
	"monitorProviderPatch",
	"hedgeIncludeProjectContext",
];
const DEFAULT_HEDGE_WHEN = "has_bash";
const HEDGE_LEAN_BASE_CONTEXT = [
	"user_text",
	"tool_calls",
	"custom_messages",
	"assistant_text",
];
const FRAGILITY_LEAN_BASE_CONTEXT = [
	"assistant_text",
	"user_text",
	"tool_calls",
	"custom_messages",
];
const CLASSIFIER_SYSTEM_PROMPT_LINES = [
	"You are a behavior monitor classifier.",
	"Return your decision by calling classify_verdict exactly once.",
	"Use CLEAN when no issue is found; FLAG/NEW require a short description.",
	"Do not fail just because monitor instructions are empty; classify from available context.",
];

function detectDefaultProvider(cwd) {
	const candidates = [join(cwd, ".pi", "settings.json")];
	for (const settingsPath of candidates) {
		if (!existsSync(settingsPath)) continue;
		try {
			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			if (settings.defaultProvider) return settings.defaultProvider;
		} catch {
			// skip
		}
	}
	return undefined;
}

function generateAgentYaml(classifierName, model) {
	const monitorName = classifierName.replace("-classifier", "");
	const descriptions = {
		"commit-hygiene":
			"Classifies whether agent committed changes with proper hygiene",
		fragility: "Classifies whether agent left unaddressed fragilities",
		hedge: "Classifies whether assistant deviated from user intent",
		"unauthorized-action":
			"Classifies whether agent is about to take an unauthorized action",
		"work-quality": "Classifies work quality issues in agent output",
	};

	return [
		`name: ${classifierName}`,
		`role: sensor`,
		`description: ${descriptions[monitorName] ?? `Classifier for ${monitorName}`}`,
		`model: ${model}`,
		`thinking: "off"`,
		`output:`,
		`  format: json`,
		`  schema: ../schemas/verdict.schema.json`,
		`prompt:`,
		`  system: |-`,
		...CLASSIFIER_SYSTEM_PROMPT_LINES.map((line) => `    ${line}`),
		`  task:`,
		`    template: ../monitors/${monitorName}/classify.md`,
		``,
	].join("\n");
}

function extractTemplateFromAgentYaml(content) {
	const match = content.match(/^\s*template:\s*([^\s#]+)\s*$/m);
	return match?.[1];
}

function hasSystemPromptInAgentYaml(content) {
	return /^\s{2}system:\s*/m.test(content);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function repairLegacyTemplateOverrides(cwd) {
	const agentsDir = join(cwd, ".pi", "agents");
	const repaired = [];
	const skipped = [];

	for (const classifier of CLASSIFIERS) {
		const filePath = join(agentsDir, `${classifier}.agent.yaml`);
		if (!existsSync(filePath)) continue;

		let content = "";
		try {
			content = readFileSync(filePath, "utf8");
		} catch {
			skipped.push(classifier);
			continue;
		}

		const currentTemplate = extractTemplateFromAgentYaml(content);
		if (!currentTemplate) {
			skipped.push(classifier);
			continue;
		}

		const monitorName = classifier.replace("-classifier", "");
		const expectedTemplate = `../monitors/${monitorName}/classify.md`;

		if (currentTemplate === expectedTemplate) continue;
		if (currentTemplate.startsWith("../monitors/")) {
			skipped.push(classifier);
			continue;
		}
		if (!currentTemplate.endsWith("/classify.md")) {
			skipped.push(classifier);
			continue;
		}

		const pattern = new RegExp(
			`(^\\s*template:\\s*)${escapeRegExp(currentTemplate)}(\\s*$)`,
			"m",
		);
		const next = content.replace(pattern, `$1${expectedTemplate}$2`);
		if (next === content) {
			skipped.push(classifier);
			continue;
		}

		writeFileSync(filePath, next, "utf8");
		repaired.push(classifier);
	}

	return { repaired, skipped };
}

function repairMissingSystemPromptOverrides(cwd) {
	const agentsDir = join(cwd, ".pi", "agents");
	const repaired = [];
	const skipped = [];

	for (const classifier of CLASSIFIERS) {
		const filePath = join(agentsDir, `${classifier}.agent.yaml`);
		if (!existsSync(filePath)) continue;

		let content = "";
		try {
			content = readFileSync(filePath, "utf8");
		} catch {
			skipped.push(classifier);
			continue;
		}

		if (hasSystemPromptInAgentYaml(content)) continue;

		const newline = content.includes("\r\n") ? "\r\n" : "\n";
		const systemBlock =
			[
				"  system: |-",
				...CLASSIFIER_SYSTEM_PROMPT_LINES.map((line) => `    ${line}`),
			].join(newline) + newline;

		const next = content.replace(
			/(^\s*prompt:\s*\r?\n)(\s{2}task:\s*\r?\n)/m,
			`$1${systemBlock}$2`,
		);

		if (next === content) {
			skipped.push(classifier);
			continue;
		}

		writeFileSync(filePath, next, "utf8");
		repaired.push(classifier);
	}

	return { repaired, skipped };
}

function ensureOverrides(cwd, model) {
	const agentsDir = join(cwd, ".pi", "agents");
	const created = [];
	const skipped = [];

	for (const classifier of CLASSIFIERS) {
		const filePath = join(agentsDir, `${classifier}.agent.yaml`);
		if (existsSync(filePath)) {
			skipped.push(classifier);
			continue;
		}
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(filePath, generateAgentYaml(classifier, model), "utf8");
		created.push(classifier);
	}

	return { created, skipped };
}

function detectBooleanSetting(cwd, path) {
	const candidates = [join(cwd, ".pi", "settings.json")];
	for (const settingsPath of candidates) {
		if (!existsSync(settingsPath)) continue;
		try {
			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			let cursor = settings;
			for (const key of path) {
				if (cursor == null || typeof cursor !== "object") {
					cursor = undefined;
					break;
				}
				cursor = cursor[key];
			}
			if (typeof cursor === "boolean") return cursor;
		} catch {
			// skip
		}
	}
	return undefined;
}

function detectStringSetting(cwd, path) {
	const candidates = [join(cwd, ".pi", "settings.json")];
	for (const settingsPath of candidates) {
		if (!existsSync(settingsPath)) continue;
		try {
			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			let cursor = settings;
			for (const key of path) {
				if (cursor == null || typeof cursor !== "object") {
					cursor = undefined;
					break;
				}
				cursor = cursor[key];
			}
			if (typeof cursor === "string" && cursor.trim()) return cursor.trim();
		} catch {
			// skip
		}
	}
	return undefined;
}

function detectHedgeWhen(cwd) {
	const value = detectStringSetting(cwd, HEDGE_WHEN_SETTING_PATH);
	if (!value) return DEFAULT_HEDGE_WHEN;

	if (
		["always", "has_tool_results", "has_file_writes", "has_bash"].includes(
			value,
		)
	)
		return value;
	if (/^tool\(\w+\)$/.test(value)) return value;
	if (/^every\(\d+\)$/.test(value)) return value;
	return DEFAULT_HEDGE_WHEN;
}

function detectHedgeIncludeProjectContext(cwd) {
	return detectBooleanSetting(cwd, HEDGE_PROJECT_CONTEXT_SETTING_PATH) ?? false;
}

function normalizeHedgeContext(input, policy) {
	const raw = Array.isArray(input)
		? input.filter((item) => typeof item === "string")
		: [];
	const normalized = new Set(raw);
	for (const key of HEDGE_LEAN_BASE_CONTEXT) normalized.add(key);

	if (policy.includeConversationHistory) {
		normalized.add("conversation_history");
	} else {
		normalized.delete("conversation_history");
	}

	if (policy.includeProjectContext) {
		normalized.add("project_vision");
		normalized.add("project_conventions");
	} else {
		normalized.delete("project_vision");
		normalized.delete("project_conventions");
	}

	const ordered = [];
	for (const key of HEDGE_LEAN_BASE_CONTEXT) {
		if (normalized.has(key)) ordered.push(key);
	}
	if (normalized.has("conversation_history"))
		ordered.push("conversation_history");
	if (normalized.has("project_vision")) ordered.push("project_vision");
	if (normalized.has("project_conventions"))
		ordered.push("project_conventions");

	for (const key of normalized) {
		if (!ordered.includes(key)) ordered.push(key);
	}

	return ordered;
}

function ensureHedgeMonitorPolicy(cwd, policy) {
	const monitorPath = join(cwd, ".pi", "monitors", "hedge.monitor.json");
	if (!existsSync(monitorPath)) return { changed: false, details: [] };

	let monitor;
	try {
		monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
	} catch {
		return { changed: false, details: [] };
	}

	let changed = false;
	const details = [];

	if (monitor.when !== policy.when) {
		monitor.when = policy.when;
		changed = true;
		details.push(`when=${policy.when}`);
	}

	// Legacy shape compatibility
	const hasTopLevelHistory = "conversation_history" in monitor;
	if (!policy.includeConversationHistory && hasTopLevelHistory) {
		delete monitor["conversation_history"];
		changed = true;
	} else if (policy.includeConversationHistory && !hasTopLevelHistory) {
		monitor["conversation_history"] = [];
		changed = true;
	}

	// Current davidorex shape: classify.context array
	const classify = monitor.classify;
	if (
		classify &&
		typeof classify === "object" &&
		Array.isArray(classify.context)
	) {
		const next = normalizeHedgeContext(classify.context, policy);
		if (JSON.stringify(classify.context) !== JSON.stringify(next)) {
			classify.context = next;
			changed = true;
			details.push(
				`context=history:${policy.includeConversationHistory ? "on" : "off"},project:${policy.includeProjectContext ? "on" : "off"}`,
			);
		}
	}

	if (changed) {
		writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
	}

	return { changed, details };
}

function ensureHedgeMonitorContext(cwd, includeConversationHistory) {
	return ensureHedgeMonitorPolicy(cwd, {
		includeConversationHistory,
		includeProjectContext: false,
		when: DEFAULT_HEDGE_WHEN,
	}).changed;
}

function normalizeFragilityContext(input) {
	const raw = Array.isArray(input)
		? input.filter((item) => typeof item === "string")
		: [];
	const normalized = new Set(raw);
	normalized.delete("tool_results");
	for (const key of FRAGILITY_LEAN_BASE_CONTEXT) normalized.add(key);

	const ordered = [];
	for (const key of FRAGILITY_LEAN_BASE_CONTEXT) {
		if (normalized.has(key)) ordered.push(key);
	}
	for (const key of normalized) {
		if (!ordered.includes(key)) ordered.push(key);
	}
	return ordered;
}

function ensureFragilityMonitorContext(cwd) {
	const monitorPath = join(cwd, ".pi", "monitors", "fragility.monitor.json");
	if (!existsSync(monitorPath)) return { changed: false, details: [] };

	let monitor;
	try {
		monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
	} catch {
		return { changed: false, details: [] };
	}

	if (!monitor.classify || typeof monitor.classify !== "object") {
		return { changed: false, details: [] };
	}

	const prev = Array.isArray(monitor.classify.context)
		? monitor.classify.context.filter((item) => typeof item === "string")
		: [];
	const next = normalizeFragilityContext(prev);
	if (JSON.stringify(prev) === JSON.stringify(next)) {
		return { changed: false, details: [] };
	}

	monitor.classify.context = next;
	writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
	return { changed: true, details: ["fragility-context=lean(no-tool_results)"] };
}

function simulateSessionStart(cwd) {
	const hedgePolicy = {
		includeConversationHistory:
			detectBooleanSetting(cwd, HEDGE_HISTORY_SETTING_PATH) ?? false,
		includeProjectContext: detectHedgeIncludeProjectContext(cwd),
		when: detectHedgeWhen(cwd),
	};
	const hedgePatch = ensureHedgeMonitorPolicy(cwd, hedgePolicy);
	const fragilityPatch = ensureFragilityMonitorContext(cwd);

	const provider = detectDefaultProvider(cwd);
	if (provider !== "github-copilot") {
		return {
			provider,
			hedgePolicy,
			hedgeChanged: hedgePatch.changed,
			fragilityChanged: fragilityPatch.changed,
			created: [],
			repaired: [],
		};
	}

	const { created } = ensureOverrides(cwd, COPILOT_MODEL);
	const { repaired } = repairLegacyTemplateOverrides(cwd);
	const { repaired: repairedSystemPrompt } =
		repairMissingSystemPromptOverrides(cwd);
	return {
		provider,
		hedgePolicy,
		hedgeChanged: hedgePatch.changed,
		fragilityChanged: fragilityPatch.changed,
		created,
		repaired,
		repairedSystemPrompt,
	};
}

export {
	CLASSIFIERS,
	COPILOT_MODEL,
	HEDGE_HISTORY_SETTING_PATH,
	HEDGE_WHEN_SETTING_PATH,
	HEDGE_PROJECT_CONTEXT_SETTING_PATH,
	DEFAULT_HEDGE_WHEN,
	HEDGE_LEAN_BASE_CONTEXT,
	CLASSIFIER_SYSTEM_PROMPT_LINES,
	detectDefaultProvider,
	generateAgentYaml,
	extractTemplateFromAgentYaml,
	hasSystemPromptInAgentYaml,
	repairLegacyTemplateOverrides,
	repairMissingSystemPromptOverrides,
	ensureOverrides,
	detectBooleanSetting,
	detectStringSetting,
	detectHedgeWhen,
	detectHedgeIncludeProjectContext,
	normalizeHedgeContext,
	ensureHedgeMonitorPolicy,
	ensureHedgeMonitorContext,
	simulateSessionStart,
};
