/**
 * monitor-provider-patch — Automatically patches behavior monitor classifiers
 * with provider-aware model specs.
 *
 * Why this exists:
 * - @davidorex/pi-behavior-monitors ships bare classifier models
 *   (`model: claude-sonnet-4-6`), without provider prefix.
 * - In mixed-provider environments (Copilot, Codex, etc.), this can make
 *   monitors silently fail or drift from the active provider.
 *
 * What this extension does:
 * - On session_start, keeps hedge context lean (conversation_history opt-in) and calibrates fragility policy/context.
 * - Resolves classifier model by provider/settings.
 * - Ensures missing .pi/agents classifier overrides exist.
 * - Warns when existing overrides are misaligned with active provider/model.
 * - Exposes /monitor-provider for status and explicit apply/sync.
 *
 * Upstream issue: https://github.com/davidorex/pi-project-workflows/issues/1
 */

/**
 * @capability-id monitor-provider-governance
 * @capability-criticality high
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	CLASSIFIERS,
	CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH,
	CLASSIFIER_MODEL_SETTING_PATH,
	CLASSIFIER_SYSTEM_PROMPT_LINES,
	CLASSIFIER_THINKING_SETTING_PATH,
	COMMIT_HYGIENE_VERIFY_NUDGE_LINE,
	DEFAULT_FRAGILITY_WHEN,
	DEFAULT_HEDGE_WHEN,
	DEFAULT_MODEL_BY_PROVIDER,
	DEFAULT_THINKING,
	FRAGILITY_LEAN_BASE_CONTEXT,
	FRAGILITY_WHEN_PATTERNS,
	FRAGILITY_WHEN_SETTING_PATH,
	HEDGE_HISTORY_SETTING_PATH,
	HEDGE_LEAN_BASE_CONTEXT,
	HEDGE_PROJECT_CONTEXT_SETTING_PATH,
	HEDGE_WHEN_PATTERNS,
	HEDGE_WHEN_SETTING_PATH,
	THINKING_LEVELS,
	WORK_QUALITY_SLICE_NUDGE_LINE,
	type ThinkingLevel,
} from "./monitor-provider-config";
import { ensureMonitorRuntimeClassifyContract } from "./monitor-runtime-contract";

function parseCommandInput(input: string): { cmd: string; body: string } {
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

export type HedgeMonitorPolicy = {
	includeConversationHistory: boolean;
	includeProjectContext: boolean;
	when: string;
};

function normalizeHedgeContext(
	input: unknown,
	policy: HedgeMonitorPolicy,
): string[] {
	const raw = Array.isArray(input)
		? input.filter((item): item is string => typeof item === "string")
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

	const ordered: string[] = [];
	for (const key of HEDGE_LEAN_BASE_CONTEXT) {
		if (normalized.has(key)) ordered.push(key);
	}
	if (normalized.has("conversation_history")) ordered.push("conversation_history");
	if (normalized.has("project_vision")) ordered.push("project_vision");
	if (normalized.has("project_conventions")) ordered.push("project_conventions");

	for (const key of normalized) {
		if (!ordered.includes(key)) ordered.push(key);
	}

	return ordered;
}

/**
 * Ensures hedge monitor follows a lean policy:
 * - trigger (`when`) defaults to has_bash
 * - conversation_history is opt-in
 * - project_vision/project_conventions are opt-in
 */
export function ensureHedgeMonitorPolicy(
	cwd: string,
	policy: HedgeMonitorPolicy,
): { changed: boolean; details: string[] } {
	const monitorPath = join(cwd, ".pi", "monitors", "hedge.monitor.json");
	if (!existsSync(monitorPath)) return { changed: false, details: [] };

	let monitor: Record<string, unknown>;
	try {
		monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
	} catch {
		return { changed: false, details: [] };
	}

	let changed = false;
	const details: string[] = [];

	const currentWhen = typeof monitor["when"] === "string" ? monitor["when"] : undefined;
	if (currentWhen !== policy.when) {
		monitor["when"] = policy.when;
		changed = true;
		details.push(`when=${policy.when}`);
	}

	const hasTopLevelHistory = "conversation_history" in monitor;
	if (!policy.includeConversationHistory && hasTopLevelHistory) {
		delete monitor["conversation_history"];
		changed = true;
	} else if (policy.includeConversationHistory && !hasTopLevelHistory) {
		monitor["conversation_history"] = [];
		changed = true;
	}

	const classify = monitor["classify"];
	if (classify && typeof classify === "object") {
		const nextContext = normalizeHedgeContext(
			(classify as Record<string, unknown>)["context"],
			policy,
		);
		const prevContext = (classify as Record<string, unknown>)["context"];
		const prevSerialized = JSON.stringify(
			Array.isArray(prevContext)
				? prevContext.filter((item): item is string => typeof item === "string")
				: [],
		);
		const nextSerialized = JSON.stringify(nextContext);

		if (prevSerialized !== nextSerialized) {
			(classify as Record<string, unknown>)["context"] = nextContext;
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

/**
 * Backward-compatible helper kept for tests/importers.
 */
export function ensureHedgeMonitorContext(
	cwd: string,
	includeConversationHistory: boolean,
): boolean {
	return ensureHedgeMonitorPolicy(cwd, {
		includeConversationHistory,
		includeProjectContext: false,
		when: DEFAULT_HEDGE_WHEN,
	}).changed;
}

function normalizeFragilityContext(input: unknown): string[] {
	const raw = Array.isArray(input)
		? input.filter((item): item is string => typeof item === "string")
		: [];
	const normalized = new Set(raw);
	normalized.delete("tool_results");
	for (const key of FRAGILITY_LEAN_BASE_CONTEXT) normalized.add(key);

	const ordered: string[] = [];
	for (const key of FRAGILITY_LEAN_BASE_CONTEXT) {
		if (normalized.has(key)) ordered.push(key);
	}
	for (const key of normalized) {
		if (!ordered.includes(key)) ordered.push(key);
	}
	return ordered;
}

const FRAGILITY_EMPTY_OUTPUT_GUARD_LINE =
	"- Only classify empty-output fragility when assistant_text is actually empty (or whitespace-only).";
const FRAGILITY_MONITOR_FEEDBACK_GUARD_LINE =
	"- Automated monitor feedback is not evidence of fragility by itself; validate against actual assistant_text and user-visible outcome.";
const FRAGILITY_SUBSTANTIVE_OUTPUT_GUARD_LINE =
	"- If assistant_text has substantive non-whitespace content, do not flag empty-output fragility.";
const FRAGILITY_EMPTY_RESPONSE_PATTERN_RE =
	/empty response|empty output|responds with empty/i;

export function ensureFragilityClassifierCalibration(cwd: string): {
	changed: boolean;
	details: string[];
} {
	const classifyPath = join(cwd, ".pi", "monitors", "fragility", "classify.md");
	if (!existsSync(classifyPath)) return { changed: false, details: [] };

	let content = "";
	try {
		content = readFileSync(classifyPath, "utf8");
	} catch {
		return { changed: false, details: [] };
	}

	const details: string[] = [];
	const additions: string[] = [];
	if (!content.includes(FRAGILITY_EMPTY_OUTPUT_GUARD_LINE)) {
		additions.push(FRAGILITY_EMPTY_OUTPUT_GUARD_LINE);
		details.push("empty-output-guard");
	}
	if (!content.includes(FRAGILITY_MONITOR_FEEDBACK_GUARD_LINE)) {
		additions.push(FRAGILITY_MONITOR_FEEDBACK_GUARD_LINE);
		details.push("monitor-feedback-guard");
	}
	if (!content.includes(FRAGILITY_SUBSTANTIVE_OUTPUT_GUARD_LINE)) {
		additions.push(FRAGILITY_SUBSTANTIVE_OUTPUT_GUARD_LINE);
		details.push("substantive-output-guard");
	}
	if (additions.length === 0) return { changed: false, details: [] };

	const calibrationBlock = ["Calibration guardrails:", ...additions].join("\n");
	const next = `${content.trimEnd()}\n\n${calibrationBlock}\n`;
	writeFileSync(classifyPath, next, "utf8");
	return { changed: true, details };
}

export function ensureFragilityPatternHygiene(cwd: string): {
	changed: boolean;
	details: string[];
} {
	const patternsPath = join(cwd, ".pi", "monitors", "fragility.patterns.json");
	if (!existsSync(patternsPath)) return { changed: false, details: [] };

	let patterns: unknown;
	try {
		patterns = JSON.parse(readFileSync(patternsPath, "utf8"));
	} catch {
		return { changed: false, details: [] };
	}
	if (!Array.isArray(patterns)) return { changed: false, details: [] };

	const kept: unknown[] = [];
	let removed = 0;
	for (const entry of patterns) {
		if (!entry || typeof entry !== "object") {
			kept.push(entry);
			continue;
		}
		const row = entry as Record<string, unknown>;
		const source = typeof row["source"] === "string" ? row["source"] : "";
		const signal = `${String(row["id"] ?? "")} ${String(row["description"] ?? "")}`;
		const isLearned = source.toLowerCase() === "learned";
		if (isLearned && FRAGILITY_EMPTY_RESPONSE_PATTERN_RE.test(signal)) {
			removed += 1;
			continue;
		}
		kept.push(entry);
	}

	if (removed === 0) return { changed: false, details: [] };
	writeFileSync(patternsPath, JSON.stringify(kept, null, 2) + "\n", "utf8");
	return {
		changed: true,
		details: [`patterns=pruned-empty-response(${removed})`],
	};
}

type InstructionEntry = {
	text: string;
	added_at?: string;
};

function ensureInstructionLine(opts: {
	cwd: string;
	fileName: string;
	line: string;
	detail: string;
}): { changed: boolean; details: string[] } {
	const filePath = join(opts.cwd, ".pi", "monitors", opts.fileName);
	if (!existsSync(filePath)) return { changed: false, details: [] };

	let entries: unknown;
	try {
		entries = JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return { changed: false, details: [] };
	}
	if (!Array.isArray(entries)) return { changed: false, details: [] };

	const rows = entries as unknown[];
	const hasLine = rows.some((entry) => {
		if (!entry || typeof entry !== "object") return false;
		const text = (entry as InstructionEntry).text;
		return typeof text === "string" && text.trim() === opts.line;
	});
	if (hasLine) return { changed: false, details: [] };

	rows.push({ text: opts.line, added_at: new Date().toISOString() });
	writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
	return { changed: true, details: [opts.detail] };
}

export function ensureCommitHygieneInstructionCalibration(cwd: string): {
	changed: boolean;
	details: string[];
} {
	return ensureInstructionLine({
		cwd,
		fileName: "commit-hygiene.instructions.json",
		line: COMMIT_HYGIENE_VERIFY_NUDGE_LINE,
		detail: "commit-hygiene=verification-before-commit-nudge",
	});
}

export function ensureWorkQualityInstructionCalibration(cwd: string): {
	changed: boolean;
	details: string[];
} {
	return ensureInstructionLine({
		cwd,
		fileName: "work-quality.instructions.json",
		line: WORK_QUALITY_SLICE_NUDGE_LINE,
		detail: "work-quality=slice-aware-no-verify-nudge",
	});
}

type FragilityMonitorPolicy = {
	when: string;
};

export function ensureFragilityMonitorPolicy(
	cwd: string,
	policy: FragilityMonitorPolicy,
): {
	changed: boolean;
	details: string[];
} {
	const monitorPath = join(cwd, ".pi", "monitors", "fragility.monitor.json");
	if (!existsSync(monitorPath)) return { changed: false, details: [] };

	let monitor: Record<string, unknown>;
	try {
		monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
	} catch {
		return { changed: false, details: [] };
	}

	let changed = false;
	const details: string[] = [];
	if (monitor["when"] !== policy.when) {
		monitor["when"] = policy.when;
		changed = true;
		details.push(`when=${policy.when}`);
	}

	const classify = monitor["classify"];
	if (!classify || typeof classify !== "object") {
		if (changed) {
			writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
		}
		return { changed, details };
	}

	const prevContext = (classify as Record<string, unknown>)["context"];
	const prevSerialized = JSON.stringify(
		Array.isArray(prevContext)
			? prevContext.filter((item): item is string => typeof item === "string")
			: [],
	);
	const nextContext = normalizeFragilityContext(prevContext);
	const nextSerialized = JSON.stringify(nextContext);
	if (prevSerialized !== nextSerialized) {
		(classify as Record<string, unknown>)["context"] = nextContext;
		changed = true;
		details.push("context=lean(no-tool_results)");
	}

	if (changed) {
		writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
	}
	return { changed, details };
}

/** Backward-compatible helper kept for tests/importers. */
export function ensureFragilityMonitorContext(cwd: string): {
	changed: boolean;
	details: string[];
} {
	return ensureFragilityMonitorPolicy(cwd, { when: DEFAULT_FRAGILITY_WHEN });
}

function readHedgeMonitorState(cwd: string): {
	when?: string;
	hasConversationHistory: boolean;
	hasProjectContext: boolean;
	context: string[];
} | null {
	const monitorPath = join(cwd, ".pi", "monitors", "hedge.monitor.json");
	if (!existsSync(monitorPath)) return null;

	let monitor: Record<string, unknown>;
	try {
		monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
	} catch {
		return null;
	}

	const classify = monitor["classify"];
	const context =
		classify && typeof classify === "object" && Array.isArray((classify as Record<string, unknown>)["context"])
			? ((classify as Record<string, unknown>)["context"] as unknown[]).filter(
				(item): item is string => typeof item === "string",
			)
			: [];

	return {
		when: typeof monitor["when"] === "string" ? monitor["when"] : undefined,
		hasConversationHistory: context.includes("conversation_history"),
		hasProjectContext:
			context.includes("project_vision") ||
			context.includes("project_conventions"),
		context,
	};
}

export function planSessionStartOutput(
	details: string[],
	severity: "info" | "warning",
	opts?: { requiresReload?: boolean },
): {
	notify: boolean;
	status?: string;
	message?: string;
	severity?: "info" | "warning";
} {
	if (details.length === 0) {
		return { notify: false };
	}
	const requiresReload = opts?.requiresReload === true;
	const baseMessage = `monitor-provider-patch: ${details.join(", ")}`;
	if (severity === "warning") {
		return {
			notify: true,
			message: baseMessage,
			severity,
			status: `[mprov] warning:${details.length}`,
		};
	}
	if (requiresReload) {
		return {
			notify: true,
			message: `${baseMessage}\nRecomendado: /reload`,
			severity: "info",
			status: `[mprov] sync:${details.length}`,
		};
	}
	return {
		notify: false,
		message: baseMessage,
		severity: "info",
		status: `[mprov] sync:${details.length}`,
	};
}

function buildStatusReport(
	cwd: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	modelRegistry: any,
): string {
	const provider = detectDefaultProvider(cwd);
	const resolution = resolveClassifierModel(cwd, provider);
	const model = resolution.model;
	const thinking = detectClassifierThinking(cwd);
	const hedgeWhen = detectHedgeWhen(cwd);
	const hedgeIncludeProjectContext = detectHedgeIncludeProjectContext(cwd);
	const hedgeIncludeHistory =
		detectBooleanSetting(cwd, HEDGE_HISTORY_SETTING_PATH) ?? false;
	const explicit = detectStringSetting(cwd, CLASSIFIER_MODEL_SETTING_PATH);
	const customMap =
		detectStringMapSetting(cwd, CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH) ??
		{};

	const effectiveMap = {
		...DEFAULT_MODEL_BY_PROVIDER,
		...customMap,
	};

	const lines: string[] = [];
	lines.push("monitor-provider status");
	lines.push("");
	lines.push(`defaultProvider: ${provider ?? "(não definido)"}`);
	lines.push(`classifierThinking: ${thinking}`);
	lines.push(`classifierModel (global): ${explicit ?? "(não definido)"}`);
	lines.push(
		`hedge policy (settings): when=${hedgeWhen}, conversation_history=${hedgeIncludeHistory ? "on" : "off"}, project_context=${hedgeIncludeProjectContext ? "on" : "off"}`,
	);

	if (model) {
		const availability = checkModelAvailability(modelRegistry, model);
		lines.push(`resolvedClassifierModel: ${model} (${resolution.source})`);
		lines.push(
			`resolvedModelHealth: ${availability.ok ? "ok" : availability.reason}`,
		);
	} else {
		lines.push(`resolvedClassifierModel: (não resolvido)`);
	}

	lines.push("");
	lines.push("provider map (effective):");
	for (const key of Object.keys(effectiveMap).sort()) {
		lines.push(`  ${key} -> ${effectiveMap[key]}`);
	}

	const overrides = readOverrideModels(cwd);
	lines.push("");
	lines.push("overrides (.pi/agents):");
	for (const classifier of CLASSIFIERS) {
		lines.push(`  ${classifier}: ${overrides[classifier] ?? "(ausente)"}`);
	}

	if (model) {
		const mismatched = Object.entries(overrides)
			.filter(
				([, existing]) => typeof existing === "string" && existing.length > 0,
			)
			.filter(([, existing]) => existing !== model)
			.map(([classifier, existing]) => `${classifier}=${existing}`);

		if (mismatched.length > 0) {
			lines.push("");
			lines.push("⚠ overrides divergentes do modelo resolvido:");
			for (const item of mismatched) lines.push(`  - ${item}`);
			lines.push("  Use: /monitor-provider apply");
		}
	}

	const hedgeState = readHedgeMonitorState(cwd);
	if (hedgeState) {
		lines.push("");
		lines.push(
			`hedge monitor (current): when=${hedgeState.when ?? "(none)"}, conversation_history=${hedgeState.hasConversationHistory ? "on" : "off"}, project_context=${hedgeState.hasProjectContext ? "on" : "off"}`,
		);
	}

	return lines.join("\n");
}

function buildTemplateSnippet(): string {
	return JSON.stringify(
		{
			piStack: {
				monitorProviderPatch: {
					classifierThinking: "off",
					hedgeWhen: "has_bash",
					hedgeIncludeProjectContext: false,
					hedgeConversationHistory: false,
					classifierModelByProvider: {
						"github-copilot": "github-copilot/claude-haiku-4.5",
						"openai-codex": "openai-codex/gpt-5.4-mini",
					},
				},
			},
		},
		null,
		2,
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("monitor-provider", {
		description:
			"Diagnostica e aplica perfil de modelo dos classifiers de monitor por provider.",
		handler: async (args, ctx) => {
			const input = (args ?? "").trim();
			const { cmd, body } = parseCommandInput(input);

			if (!cmd || cmd === "status") {
				ctx.ui.notify(buildStatusReport(ctx.cwd, ctx.modelRegistry), "info");
				return;
			}

			if (cmd === "help") {
				ctx.ui.notify(
					[
						"Usage: /monitor-provider <command>",
						"",
						"Commands:",
						"  status                          Mostra provider/model efetivo e overrides atuais",
						"  apply [provider|provider/model] [model]  Sincroniza os 5 overrides para um modelo",
						"  template                        Mostra snippet de configuração para .pi/settings.json",
						"",
						"Exemplos:",
						"  /monitor-provider status",
						"  /monitor-provider apply",
						"  /monitor-provider apply openai-codex",
						"  /monitor-provider apply openai-codex/gpt-5.4-mini",
					].join("\n"),
					"info",
				);
				return;
			}

			if (cmd === "template") {
				ctx.ui.notify(
					[
						"Snippet sugerido (.pi/settings.json):",
						"",
						buildTemplateSnippet(),
					].join("\n"),
					"info",
				);
				return;
			}

			if (cmd === "apply") {
				const tokens = body
					.split(/\s+/)
					.map((t) => t.trim())
					.filter(Boolean);
				const detectedDefaultProvider = detectDefaultProvider(ctx.cwd);

				let provider = detectedDefaultProvider;
				let model = undefined as string | undefined;

				const first = tokens[0];
				const second = tokens[1];

				if (first) {
					if (first.includes("/")) {
						model = first;
						provider = parseModelRef(first)?.provider ?? provider;
					} else {
						provider = first;
					}
				}

				if (second) {
					model = second;
				}

				if (!model) {
					model = resolveClassifierModel(ctx.cwd, provider).model;
				}

				if (!model) {
					ctx.ui.notify(
						[
							"Nao foi possivel resolver o modelo dos classifiers.",
							"Defina defaultProvider e/ou piStack.monitorProviderPatch.classifierModelByProvider,",
							"ou passe o modelo explicitamente em /monitor-provider apply <provider/model>",
						].join("\n"),
						"warning",
					);
					return;
				}

				const thinking = detectClassifierThinking(ctx.cwd);
				const result = syncOverrides(ctx.cwd, model, thinking);
				const availability = checkModelAvailability(ctx.modelRegistry, model);

				const lines = [
					`monitor-provider: apply`,
					`  provider alvo: ${provider ?? "(inferido do model)"}`,
					`  modelo alvo: ${model}`,
					`  thinking: ${thinking}`,
					`  created: ${result.created.length}`,
					`  updated: ${result.updated.length}`,
					`  unchanged: ${result.unchanged.length}`,
					`  model health: ${availability.ok ? "ok" : availability.reason}`,
					"",
					"Recomendado: /reload",
				];

				ctx.ui.notify(
					lines.join("\n"),
					availability.ok || availability.reason === "unavailable"
						? "info"
						: "warning",
				);
				ctx.ui.setEditorText?.("/reload");
				return;
			}

			ctx.ui.notify(
				"Usage: /monitor-provider [status|apply|template|help]",
				"warning",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const runtimeContract = ensureMonitorRuntimeClassifyContract(ctx.cwd);
		const hedgePolicy: HedgeMonitorPolicy = {
			includeConversationHistory:
				detectBooleanSetting(ctx.cwd, HEDGE_HISTORY_SETTING_PATH) ?? false,
			includeProjectContext: detectHedgeIncludeProjectContext(ctx.cwd),
			when: detectHedgeWhen(ctx.cwd),
		};
		const hedgePatch = ensureHedgeMonitorPolicy(ctx.cwd, hedgePolicy);
		const fragilityPolicy: FragilityMonitorPolicy = {
			when: detectFragilityWhen(ctx.cwd),
		};
		const fragilityPatch = ensureFragilityMonitorPolicy(
			ctx.cwd,
			fragilityPolicy,
		);
		const fragilityClassifierPatch = ensureFragilityClassifierCalibration(
			ctx.cwd,
		);
		const fragilityPatternPatch = ensureFragilityPatternHygiene(ctx.cwd);
		const commitHygieneInstructionPatch =
			ensureCommitHygieneInstructionCalibration(ctx.cwd);
		const workQualityInstructionPatch =
			ensureWorkQualityInstructionCalibration(ctx.cwd);

		const provider = detectDefaultProvider(ctx.cwd);
		const { model, source } = resolveClassifierModel(ctx.cwd, provider);

		if (!model) {
			const earlyDetails: string[] = [];
			if (hedgePatch.changed) {
				earlyDetails.push(
					`hedge policy synced (${hedgePatch.details.join(", ") || "ok"})`,
				);
			}
			if (fragilityPatch.changed) {
				earlyDetails.push(
					`fragility policy synced (${fragilityPatch.details.join(", ") || "ok"})`,
				);
			}
			if (fragilityClassifierPatch.changed) {
				earlyDetails.push(
					`fragility classifier synced (${fragilityClassifierPatch.details.join(", ") || "ok"})`,
				);
			}
			if (fragilityPatternPatch.changed) {
				earlyDetails.push(
					`fragility patterns synced (${fragilityPatternPatch.details.join(", ") || "ok"})`,
				);
			}
			if (commitHygieneInstructionPatch.changed) {
				earlyDetails.push(
					`commit-hygiene instructions synced (${commitHygieneInstructionPatch.details.join(", ") || "ok"})`,
				);
			}
			if (workQualityInstructionPatch.changed) {
				earlyDetails.push(
					`work-quality instructions synced (${workQualityInstructionPatch.details.join(", ") || "ok"})`,
				);
			}
			const output = planSessionStartOutput(earlyDetails, "info", {
				requiresReload: earlyDetails.length > 0,
			});
			ctx.ui?.setStatus?.("monitor-provider-patch", output.status);
			if (output.notify && output.message && output.severity) {
				ctx.ui?.notify?.(output.message, output.severity);
			}
			return;
		}

		const thinking = detectClassifierThinking(ctx.cwd);
		const { created } = ensureOverrides(ctx.cwd, model, thinking);
		const legacyTemplateRepair = repairLegacyTemplateOverrides(ctx.cwd);
		const systemPromptRepair = repairMissingSystemPromptOverrides(ctx.cwd);

		const availability = checkModelAvailability(ctx.modelRegistry, model);
		const overrides = readOverrideModels(ctx.cwd);
		const mismatched = Object.entries(overrides)
			.filter(
				([, existing]) => typeof existing === "string" && existing.length > 0,
			)
			.filter(([, existing]) => existing !== model)
			.map(([classifier, existing]) => `${classifier}=${existing}`);

		const details: string[] = [];
		if (created.length > 0) {
			details.push(`criou ${created.length} override(s) (${source})`);
		}
		if (hedgePatch.changed) {
			details.push(
				`hedge policy synced (${hedgePatch.details.join(", ") || "ok"})`,
			);
		}
		if (legacyTemplateRepair.repaired.length > 0) {
			details.push(
				`corrigiu template legado em ${legacyTemplateRepair.repaired.length} override(s)`,
			);
		}
		if (fragilityPatch.changed) {
			details.push(
				`fragility policy synced (${fragilityPatch.details.join(", ") || "ok"})`,
			);
		}
		if (fragilityClassifierPatch.changed) {
			details.push(
				`fragility classifier synced (${fragilityClassifierPatch.details.join(", ") || "ok"})`,
			);
		}
		if (fragilityPatternPatch.changed) {
			details.push(
				`fragility patterns synced (${fragilityPatternPatch.details.join(", ") || "ok"})`,
			);
		}
		if (commitHygieneInstructionPatch.changed) {
			details.push(
				`commit-hygiene instructions synced (${commitHygieneInstructionPatch.details.join(", ") || "ok"})`,
			);
		}
		if (workQualityInstructionPatch.changed) {
			details.push(
				`work-quality instructions synced (${workQualityInstructionPatch.details.join(", ") || "ok"})`,
			);
		}
		if (systemPromptRepair.repaired.length > 0) {
			details.push(
				`corrigiu prompt.system ausente em ${systemPromptRepair.repaired.length} override(s)`,
			);
		}

		let severity: "info" | "warning" = "info";

		if (!availability.ok && availability.reason !== "unavailable") {
			severity = "warning";
			details.push(`modelo ${model} indisponivel (${availability.reason})`);
		}
		if (runtimeContract.repaired.length > 0) details.push(`runtime classify contract repaired (${runtimeContract.repaired.length})`);
		if (runtimeContract.failed.length > 0) {
			severity = "warning";
			details.push(`runtime classify contract repair failed (${runtimeContract.failed.length})`);
		}

		if (mismatched.length > 0) {
			severity = "warning";
			details.push(
				`overrides divergentes detectados (${mismatched.length}) — use /monitor-provider apply`,
			);
		}

		const output = planSessionStartOutput(details, severity, {
			requiresReload:
				created.length > 0 ||
				hedgePatch.changed ||
				fragilityPatch.changed ||
				fragilityClassifierPatch.changed ||
				fragilityPatternPatch.changed ||
				commitHygieneInstructionPatch.changed ||
				workQualityInstructionPatch.changed ||
				legacyTemplateRepair.repaired.length > 0 ||
				systemPromptRepair.repaired.length > 0 ||
				runtimeContract.repaired.length > 0,
		});
		ctx.ui?.setStatus?.("monitor-provider-patch", output.status);
		if (output.notify && output.message && output.severity) {
			ctx.ui?.notify?.(output.message, output.severity);
		}
	});
}
