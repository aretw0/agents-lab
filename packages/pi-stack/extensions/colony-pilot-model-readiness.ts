import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type ModelAuthStatus =
	| "ok"
	| "missing-auth"
	| "missing-model"
	| "invalid-model"
	| "not-set"
	| "unavailable";

export interface ColonyModelReadiness {
	currentModelRef?: string;
	currentModelStatus: ModelAuthStatus;
	defaultProvider?: string;
	defaultModel?: string;
	defaultModelRef?: string;
	defaultModelStatus: ModelAuthStatus;
	antColonyDefaultModelRef?: string;
}

function settingsCandidates(cwd: string): string[] {
	return [
		path.join(cwd, ".pi", "settings.json"),
		path.join(homedir(), ".pi", "agent", "settings.json"),
	];
}

function readTopLevelStringSetting(
	cwd: string,
	key: string,
): string | undefined {
	for (const candidate of settingsCandidates(cwd)) {
		if (!existsSync(candidate)) continue;

		try {
			const json = JSON.parse(readFileSync(candidate, "utf8"));
			const value = json?.[key];
			if (typeof value === "string" && value.trim().length > 0) {
				return value.trim();
			}
		} catch {
			// ignore malformed settings
		}
	}

	return undefined;
}

export function parseProviderModelRef(
	modelRef: string,
): { provider: string; model: string } | undefined {
	const idx = modelRef.indexOf("/");
	if (idx <= 0 || idx >= modelRef.length - 1) return undefined;
	return {
		provider: modelRef.slice(0, idx),
		model: modelRef.slice(idx + 1),
	};
}

export function resolveModelAuthStatus(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	modelRegistry: any,
	modelRef?: string,
): ModelAuthStatus {
	if (!modelRef) return "not-set";

	const parsed = parseProviderModelRef(modelRef);
	if (!parsed) return "invalid-model";

	if (!modelRegistry || typeof modelRegistry.find !== "function") {
		return "unavailable";
	}

	const model = modelRegistry.find(parsed.provider, parsed.model);
	if (!model) return "missing-model";

	if (typeof modelRegistry.hasConfiguredAuth === "function") {
		const hasAuth = modelRegistry.hasConfiguredAuth(model);
		if (!hasAuth) return "missing-auth";
	}

	return "ok";
}

export function resolveColonyModelReadiness(
	cwd: string,
	currentModelRef: string | undefined,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	modelRegistry: any,
): ColonyModelReadiness {
	const defaultProvider = readTopLevelStringSetting(cwd, "defaultProvider");
	const defaultModel = readTopLevelStringSetting(cwd, "defaultModel");

	const currentModelStatus = resolveModelAuthStatus(
		modelRegistry,
		currentModelRef,
	);

	let defaultModelRef: string | undefined;
	if (defaultModel) {
		defaultModelRef = defaultModel.includes("/")
			? defaultModel
			: defaultProvider
				? `${defaultProvider}/${defaultModel}`
				: undefined;
	}

	const defaultModelStatus = defaultModelRef
		? resolveModelAuthStatus(modelRegistry, defaultModelRef)
		: defaultModel
			? "invalid-model"
			: "not-set";

	return {
		currentModelRef,
		currentModelStatus,
		defaultProvider,
		defaultModel,
		defaultModelRef,
		defaultModelStatus,
		antColonyDefaultModelRef: currentModelRef,
	};
}

export function formatModelReadiness(
	readiness: ColonyModelReadiness,
): string[] {
	return [
		"provider/model:",
		`  ant_colony default model: ${readiness.antColonyDefaultModelRef ?? "(none)"}`,
		`  current model status: ${readiness.currentModelStatus}`,
		`  defaultProvider: ${readiness.defaultProvider ?? "(not set)"}`,
		`  defaultModel: ${readiness.defaultModel ?? "(not set)"}`,
		`  defaultModelRef: ${readiness.defaultModelRef ?? "(unresolved)"}`,
		`  default model status: ${readiness.defaultModelStatus}`,
	];
}
