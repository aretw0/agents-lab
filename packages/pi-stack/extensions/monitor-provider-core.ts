import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	CLASSIFIERS,
	CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH,
	CLASSIFIER_MODEL_SETTING_PATH,
	CLASSIFIER_SYSTEM_PROMPT_LINES,
	CLASSIFIER_THINKING_SETTING_PATH,
	DEFAULT_FRAGILITY_WHEN,
	DEFAULT_HEDGE_WHEN,
	DEFAULT_MODEL_BY_PROVIDER,
	DEFAULT_THINKING,
	FRAGILITY_WHEN_PATTERNS,
	FRAGILITY_WHEN_SETTING_PATH,
	HEDGE_PROJECT_CONTEXT_SETTING_PATH,
	HEDGE_WHEN_PATTERNS,
	HEDGE_WHEN_SETTING_PATH,
	THINKING_LEVELS,
	type ThinkingLevel,
} from "./monitor-provider-config";

export function parseCommandInput(input: string): { cmd: string; body: string } {
	const trimmed = input.trim();
	if (!trimmed) return { cmd: "", body: "" };
	const [cmd, ...rest] = trimmed.split(/\s+/);
	return { cmd: (cmd ?? "").toLowerCase(), body: rest.join(" ").trim() };
}

function settingsCandidates(cwd: string): string[] {
	return [
		join(cwd, ".pi", "settings.json"),
		join(homedir(), ".pi", "agent", "settings.json"),
	];
}

function readSettings(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Reads a setting from pi settings (project → global cascade). */
export function detectSetting(cwd: string, path: string[]): unknown {
	for (const candidate of settingsCandidates(cwd)) {
		const settings = readSettings(candidate);
		if (!settings) continue;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let cursor: any = settings;
		for (const key of path) {
			if (cursor == null || typeof cursor !== "object") {
				cursor = undefined;
				break;
			}
			cursor = cursor[key];
		}

		if (cursor !== undefined) return cursor;
	}

	return undefined;
}

/** Returns nested boolean setting, or undefined when missing/invalid. */
export function detectBooleanSetting(
	cwd: string,
	path: string[],
): boolean | undefined {
	const value = detectSetting(cwd, path);
	return typeof value === "boolean" ? value : undefined;
}

/** Returns nested string setting, or undefined when missing/invalid. */
export function detectStringSetting(
	cwd: string,
	path: string[],
): string | undefined {
	const value = detectSetting(cwd, path);
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Returns nested object<string,string> setting, or undefined when invalid. */
export function detectStringMapSetting(
	cwd: string,
	path: string[],
): Record<string, string> | undefined {
	const value = detectSetting(cwd, path);
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;

	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (typeof v !== "string") continue;
		const trimmed = v.trim();
		if (!trimmed) continue;
		out[k] = trimmed;
	}

	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Reads defaultProvider from pi settings (project → global).
 * Returns undefined if not set.
 */
export function detectDefaultProvider(cwd: string): string | undefined {
	const provider = detectStringSetting(cwd, ["defaultProvider"]);
	return provider;
}

/** Resolves the classifier model for a provider from settings/default map. */
export function resolveClassifierModel(
	cwd: string,
	provider?: string,
): {
	model?: string;
	source: "explicit" | "provider-map" | "defaults" | "none";
} {
	const explicit = detectStringSetting(cwd, CLASSIFIER_MODEL_SETTING_PATH);
	if (explicit) return { model: explicit, source: "explicit" };

	if (provider) {
		const customMap = detectStringMapSetting(
			cwd,
			CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH,
		);
		const fromMap = customMap?.[provider];
		if (fromMap) return { model: fromMap, source: "provider-map" };

		const fallback = DEFAULT_MODEL_BY_PROVIDER[provider];
		if (fallback) return { model: fallback, source: "defaults" };
	}

	return { source: "none" };
}

/** Detects classifier thinking level from settings, defaults to "off". */
export function detectClassifierThinking(cwd: string): ThinkingLevel {
	const value = detectStringSetting(cwd, CLASSIFIER_THINKING_SETTING_PATH);
	if (value && THINKING_LEVELS.includes(value as ThinkingLevel)) {
		return value as ThinkingLevel;
	}
	return DEFAULT_THINKING;
}

/** Detects hedge monitor trigger policy, defaults to has_bash. */
export function detectHedgeWhen(cwd: string): string {
	const value = detectStringSetting(cwd, HEDGE_WHEN_SETTING_PATH);
	if (!value) return DEFAULT_HEDGE_WHEN;

	if (HEDGE_WHEN_PATTERNS.includes(value as (typeof HEDGE_WHEN_PATTERNS)[number])) {
		return value;
	}

	if (/^tool\(\w+\)$/.test(value)) return value;
	if (/^every\(\d+\)$/.test(value)) return value;

	return DEFAULT_HEDGE_WHEN;
}

/** Detects whether hedge should include project_vision/project_conventions. */
export function detectHedgeIncludeProjectContext(cwd: string): boolean {
	return detectBooleanSetting(cwd, HEDGE_PROJECT_CONTEXT_SETTING_PATH) ?? false;
}

/** Detects fragility monitor trigger policy, defaults to has_file_writes. */
export function detectFragilityWhen(cwd: string): string {
	const value = detectStringSetting(cwd, FRAGILITY_WHEN_SETTING_PATH);
	if (!value) return DEFAULT_FRAGILITY_WHEN;

	if (
		FRAGILITY_WHEN_PATTERNS.includes(
			value as (typeof FRAGILITY_WHEN_PATTERNS)[number],
		)
	) {
		return value;
	}

	if (/^tool\(\w+\)$/.test(value)) return value;
	if (/^every\(\d+\)$/.test(value)) return value;

	return DEFAULT_FRAGILITY_WHEN;
}

/** Splits provider/model reference. */
export function parseModelRef(
	modelRef: string,
): { provider: string; modelId: string } | undefined {
	const idx = modelRef.indexOf("/");
	if (idx <= 0 || idx >= modelRef.length - 1) return undefined;
	return {
		provider: modelRef.slice(0, idx),
		modelId: modelRef.slice(idx + 1),
	};
}

/** Generates agent YAML override content for a classifier. */
export function generateAgentYaml(
	classifierName: string,
	model: string,
	thinking: ThinkingLevel = DEFAULT_THINKING,
): string {
	const monitorName = classifierName.replace("-classifier", "");
	const descriptions: Record<string, string> = {
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
		`thinking: "${thinking}"`,
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

/**
 * Ensures .pi/agents/ overrides exist for all classifiers.
 * Never overwrites existing files.
 */
export function ensureOverrides(
	cwd: string,
	model: string,
	thinking: ThinkingLevel = DEFAULT_THINKING,
): { created: string[]; skipped: string[] } {
	const agentsDir = join(cwd, ".pi", "agents");
	const created: string[] = [];
	const skipped: string[] = [];

	for (const classifier of CLASSIFIERS) {
		const filePath = join(agentsDir, `${classifier}.agent.yaml`);
		if (existsSync(filePath)) {
			skipped.push(classifier);
			continue;
		}
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			filePath,
			generateAgentYaml(classifier, model, thinking),
			"utf8",
		);
		created.push(classifier);
	}

	return { created, skipped };
}

/**
 * Syncs all classifier override files to one model/thinking profile.
 * Overwrites existing files for the 5 managed classifiers.
 */
export function syncOverrides(
	cwd: string,
	model: string,
	thinking: ThinkingLevel = DEFAULT_THINKING,
): { created: string[]; updated: string[]; unchanged: string[] } {
	const agentsDir = join(cwd, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });

	const created: string[] = [];
	const updated: string[] = [];
	const unchanged: string[] = [];

	for (const classifier of CLASSIFIERS) {
		const filePath = join(agentsDir, `${classifier}.agent.yaml`);
		const next = generateAgentYaml(classifier, model, thinking);

		if (!existsSync(filePath)) {
			writeFileSync(filePath, next, "utf8");
			created.push(classifier);
			continue;
		}

		let current = "";
		try {
			current = readFileSync(filePath, "utf8");
		} catch {
			current = "";
		}

		if (current === next) {
			unchanged.push(classifier);
			continue;
		}

		writeFileSync(filePath, next, "utf8");
		updated.push(classifier);
	}

	return { created, updated, unchanged };
}

/** Returns the model declared in an agent override YAML (best-effort). */
export function extractModelFromAgentYaml(content: string): string | undefined {
	const match = content.match(/^\s*model:\s*([^\s#]+)\s*$/m);
	return match?.[1];
}

/** Returns the template path declared in an agent override YAML (best-effort). */
export function extractTemplateFromAgentYaml(
	content: string,
): string | undefined {
	const match = content.match(/^\s*template:\s*([^\s#]+)\s*$/m);
	return match?.[1];
}

/** Returns true when classifier override already defines prompt.system. */
export function hasSystemPromptInAgentYaml(content: string): boolean {
	return /^\s{2}system:\s*/m.test(content);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Repairs legacy classifier template paths in .pi/agents overrides.
 *
 * Legacy path (broken for current monitor runtime):
 *   template: <monitor>/classify.md
 *
 * Expected path:
 *   template: ../monitors/<monitor>/classify.md
 */
export function repairLegacyTemplateOverrides(cwd: string): {
	repaired: string[];
	skipped: string[];
} {
	const agentsDir = join(cwd, ".pi", "agents");
	const repaired: string[] = [];
	const skipped: string[] = [];

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

		// Already points to monitors tree with a non-default path; do not mutate.
		if (currentTemplate.startsWith("../monitors/")) {
			skipped.push(classifier);
			continue;
		}

		// Only auto-repair known legacy classify paths.
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

/**
 * Repairs classifier overrides missing prompt.system.
 *
 * OpenAI Codex Responses requires `instructions` in payload; monitor runtime
 * maps this from agent systemPrompt. Without prompt.system the classify call
 * can fail with `{"detail":"Instructions are required"}`.
 */
export function repairMissingSystemPromptOverrides(cwd: string): {
	repaired: string[];
	skipped: string[];
} {
	const agentsDir = join(cwd, ".pi", "agents");
	const repaired: string[] = [];
	const skipped: string[] = [];

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
		const systemBlock = [
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

/** Returns current override model per classifier (if files exist). */
export function readOverrideModels(
	cwd: string,
): Record<string, string | undefined> {
	const agentsDir = join(cwd, ".pi", "agents");
	const out: Record<string, string | undefined> = {};

	for (const classifier of CLASSIFIERS) {
		const filePath = join(agentsDir, `${classifier}.agent.yaml`);
		if (!existsSync(filePath)) {
			out[classifier] = undefined;
			continue;
		}

		try {
			const content = readFileSync(filePath, "utf8");
			out[classifier] = extractModelFromAgentYaml(content);
		} catch {
			out[classifier] = undefined;
		}
	}

	return out;
}

/**
 * Best-effort auth/model availability check against runtime model registry.
 */
export function checkModelAvailability(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	modelRegistry: any,
	modelRef: string,
): {
	ok: boolean;
	reason:
		| "ok"
		| "invalid-model"
		| "missing-model"
		| "missing-auth"
		| "unavailable";
} {
	const parsed = parseModelRef(modelRef);
	if (!parsed) return { ok: false, reason: "invalid-model" };

	if (!modelRegistry || typeof modelRegistry.find !== "function") {
		return { ok: false, reason: "unavailable" };
	}

	const model = modelRegistry.find(parsed.provider, parsed.modelId);
	if (!model) return { ok: false, reason: "missing-model" };

	if (typeof modelRegistry.hasConfiguredAuth === "function") {
		const hasAuth = modelRegistry.hasConfiguredAuth(model);
		if (!hasAuth) return { ok: false, reason: "missing-auth" };
	}

	return { ok: true, reason: "ok" };
}
