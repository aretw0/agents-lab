import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CLASSIFIERS,
	CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH,
	CLASSIFIER_MODEL_SETTING_PATH,
	DEFAULT_MODEL_BY_PROVIDER,
	HEDGE_HISTORY_SETTING_PATH,
} from "./monitor-provider-config";
import {
	checkModelAvailability,
	detectBooleanSetting,
	detectClassifierThinking,
	detectDefaultProvider,
	detectHedgeIncludeProjectContext,
	detectHedgeWhen,
	detectStringMapSetting,
	detectStringSetting,
	readOverrideModels,
	resolveClassifierModel,
} from "./monitor-provider-core";

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

export function buildStatusReport(
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

export function buildTemplateSnippet(): string {
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
