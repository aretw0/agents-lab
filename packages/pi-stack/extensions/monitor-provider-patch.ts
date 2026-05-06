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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	CLASSIFIERS,
	CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH,
	CLASSIFIER_MODEL_SETTING_PATH,
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
	WORK_QUALITY_SLICE_NUDGE_LINE,
	type ThinkingLevel,
} from "./monitor-provider-config";
import { ensureMonitorRuntimeClassifyContract } from "./monitor-runtime-contract";
import {
	ensureHedgeInstructionCalibration,
	ensureUnauthorizedActionClassifierCalibration,
	ensureUnauthorizedActionInstructionCalibration,
	ensureUnauthorizedActionMonitorPolicy,
} from "./monitor-provider-authorization-calibration";

import { parseCommandInput, detectSetting, detectBooleanSetting, detectStringSetting, detectStringMapSetting, detectDefaultProvider, resolveClassifierModel, detectClassifierThinking, detectHedgeWhen, detectHedgeIncludeProjectContext, detectFragilityWhen, parseModelRef, generateAgentYaml, ensureOverrides, syncOverrides, extractModelFromAgentYaml, extractTemplateFromAgentYaml, hasSystemPromptInAgentYaml, repairLegacyTemplateOverrides, repairMissingSystemPromptOverrides, readOverrideModels, checkModelAvailability } from "./monitor-provider-core";
export { parseCommandInput, detectSetting, detectBooleanSetting, detectStringSetting, detectStringMapSetting, detectDefaultProvider, resolveClassifierModel, detectClassifierThinking, detectHedgeWhen, detectHedgeIncludeProjectContext, detectFragilityWhen, parseModelRef, generateAgentYaml, ensureOverrides, syncOverrides, extractModelFromAgentYaml, extractTemplateFromAgentYaml, hasSystemPromptInAgentYaml, repairLegacyTemplateOverrides, repairMissingSystemPromptOverrides, readOverrideModels, checkModelAvailability } from "./monitor-provider-core";
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
const FRAGILITY_RELOAD_DEFERRED_GUARD_LINE =
	"- A response that reports completed commits/validation/clean git and asks the operator to run /reload for live runtime validation is substantive deferred handoff, not a silent no-op.";
const FRAGILITY_STALE_DIRTY_GUARD_LINE =
	"- Do not flag stale dirty-state wording from handoff/monitor feedback when newer tool evidence or assistant_text says the working tree is clean.";
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
	if (!content.includes(FRAGILITY_RELOAD_DEFERRED_GUARD_LINE)) {
		additions.push(FRAGILITY_RELOAD_DEFERRED_GUARD_LINE);
		details.push("reload-deferred-handoff-guard");
	}
	if (!content.includes(FRAGILITY_STALE_DIRTY_GUARD_LINE)) {
		additions.push(FRAGILITY_STALE_DIRTY_GUARD_LINE);
		details.push("stale-dirty-feedback-guard");
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

const MONITOR_ISSUE_WRITERS = ["fragility", "work-quality"] as const;

type MonitorIssueWriterName = typeof MONITOR_ISSUE_WRITERS[number];

const MONITOR_ISSUE_PRIORITY: Record<"on_flag" | "on_new", string> = {
	on_flag: "high",
	on_new: "medium",
};

function schemaCompatibleMonitorIssueTemplate(
	monitorName: MonitorIssueWriterName,
	actionName: "on_flag" | "on_new",
	existingId: unknown,
): Record<string, string> {
	return {
		id: typeof existingId === "string" && existingId.trim().length > 0
			? existingId
			: `${monitorName}-{finding_id}`,
		title: "{description}",
		body: "{description}",
		location: `.pi/monitors/${monitorName}.monitor.json`,
		status: "open",
		category: "issue",
		priority: MONITOR_ISSUE_PRIORITY[actionName],
		package: "pi-stack",
		source: "monitor",
	};
}

export function ensureMonitorIssueWriteTemplateSchema(cwd: string): {
	changed: boolean;
	details: string[];
} {
	let changed = false;
	const details: string[] = [];

	for (const monitorName of MONITOR_ISSUE_WRITERS) {
		const monitorPath = join(cwd, ".pi", "monitors", `${monitorName}.monitor.json`);
		if (!existsSync(monitorPath)) continue;

		let monitor: Record<string, unknown>;
		try {
			monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
		} catch {
			continue;
		}

		const actions = monitor["actions"] && typeof monitor["actions"] === "object"
			? monitor["actions"] as Record<string, unknown>
			: undefined;
		if (!actions) continue;

		let monitorChanged = false;
		for (const actionName of ["on_flag", "on_new"] as const) {
			const action = actions[actionName] && typeof actions[actionName] === "object"
				? actions[actionName] as Record<string, unknown>
				: undefined;
			const write = action?.["write"] && typeof action["write"] === "object"
				? action["write"] as Record<string, unknown>
				: undefined;
			if (!write || write["path"] !== ".project/issues.json") continue;

			const template = write["template"] && typeof write["template"] === "object"
				? write["template"] as Record<string, unknown>
				: {};
			const nextTemplate = schemaCompatibleMonitorIssueTemplate(
				monitorName,
				actionName,
				template["id"],
			);
			if (JSON.stringify(template) !== JSON.stringify(nextTemplate)) {
				write["template"] = nextTemplate;
				monitorChanged = true;
			}
		}

		if (monitorChanged) {
			writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
			changed = true;
			details.push(`${monitorName}=issue-template-schema`);
		}
	}

	return { changed, details };
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
					hedgeConversationHistory: true,
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
		const unauthorizedMonitorPatch = ensureUnauthorizedActionMonitorPolicy(ctx.cwd);
		const unauthorizedClassifierPatch =
			ensureUnauthorizedActionClassifierCalibration(ctx.cwd);
		const unauthorizedInstructionPatch =
			ensureUnauthorizedActionInstructionCalibration(ctx.cwd);
		const hedgeInstructionPatch = ensureHedgeInstructionCalibration(ctx.cwd);
		const commitHygieneInstructionPatch =
			ensureCommitHygieneInstructionCalibration(ctx.cwd);
		const workQualityInstructionPatch =
			ensureWorkQualityInstructionCalibration(ctx.cwd);
		const monitorIssueTemplatePatch = ensureMonitorIssueWriteTemplateSchema(ctx.cwd);

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
			if (unauthorizedMonitorPatch.changed) {
				earlyDetails.push(
					`unauthorized-action policy synced (${unauthorizedMonitorPatch.details.join(", ") || "ok"})`,
				);
			}
			if (unauthorizedClassifierPatch.changed) {
				earlyDetails.push(
					`unauthorized-action classifier synced (${unauthorizedClassifierPatch.details.join(", ") || "ok"})`,
				);
			}
			if (unauthorizedInstructionPatch.changed || hedgeInstructionPatch.changed) {
				earlyDetails.push(
					`authorization monitor instructions synced (${[...unauthorizedInstructionPatch.details, ...hedgeInstructionPatch.details].join(", ") || "ok"})`,
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
			if (monitorIssueTemplatePatch.changed) {
				earlyDetails.push(
					`monitor issue templates synced (${monitorIssueTemplatePatch.details.join(", ") || "ok"})`,
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
		if (unauthorizedMonitorPatch.changed) {
			details.push(
				`unauthorized-action policy synced (${unauthorizedMonitorPatch.details.join(", ") || "ok"})`,
			);
		}
		if (unauthorizedClassifierPatch.changed) {
			details.push(
				`unauthorized-action classifier synced (${unauthorizedClassifierPatch.details.join(", ") || "ok"})`,
			);
		}
		if (unauthorizedInstructionPatch.changed || hedgeInstructionPatch.changed) {
			details.push(
				`authorization monitor instructions synced (${[...unauthorizedInstructionPatch.details, ...hedgeInstructionPatch.details].join(", ") || "ok"})`,
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
		if (monitorIssueTemplatePatch.changed) {
			details.push(
				`monitor issue templates synced (${monitorIssueTemplatePatch.details.join(", ") || "ok"})`,
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
				unauthorizedMonitorPatch.changed ||
				unauthorizedClassifierPatch.changed ||
				unauthorizedInstructionPatch.changed ||
				hedgeInstructionPatch.changed ||
				commitHygieneInstructionPatch.changed ||
				workQualityInstructionPatch.changed ||
				legacyTemplateRepair.repaired.length > 0 ||
				systemPromptRepair.repaired.length > 0 ||
				monitorIssueTemplatePatch.changed ||
				runtimeContract.repaired.length > 0,
		});
		ctx.ui?.setStatus?.("monitor-provider-patch", output.status);
		if (output.notify && output.message && output.severity) {
			ctx.ui?.notify?.(output.message, output.severity);
		}
	});
}
