import { parseProviderModelRef } from "./colony-pilot-model-readiness";
import type { ProviderBudgetStatus } from "./quota-visibility";

export interface AntColonyBudgetInput {
	goal: string;
	maxCost?: number;
	scoutModel?: string;
	workerModel?: string;
	soldierModel?: string;
	designWorkerModel?: string;
	multimodalWorkerModel?: string;
	backendWorkerModel?: string;
	reviewWorkerModel?: string;
}

export interface ColonyPilotBudgetPolicyLike {
	requireMaxCost: boolean;
	autoInjectMaxCost: boolean;
	defaultMaxCostUsd?: number;
	hardCapUsd?: number;
	minMaxCostUsd?: number;
	enforceProviderBudgetBlock: boolean;
	providerBudgetLookbackDays: number;
	allowProviderBudgetOverride: boolean;
	providerBudgetOverrideToken: string;
	enabled?: boolean;
	enforceOnAntColonyTool?: boolean;
}

export interface ColonyPilotBudgetPolicyEvaluation {
	ok: boolean;
	issues: string[];
	effectiveMaxCostUsd?: number;
}

export interface ColonyPilotProviderBudgetGateEvaluation {
	ok: boolean;
	checked: boolean;
	issues: string[];
	consideredProviders: string[];
	blockedProviders: string[];
	allocationWarnings: string[];
	overrideReason?: string;
}

function normalizeOptionalBudget(value: unknown): number | undefined {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return Math.round(n * 100) / 100;
}

function providerOf(modelRef: string | undefined): string | undefined {
	if (!modelRef) return undefined;
	return parseProviderModelRef(modelRef)?.provider;
}

export function parseBudgetOverrideReason(
	goal: string,
	overrideToken: string,
): string | undefined {
	const token = overrideToken.trim();
	if (!token) return undefined;

	const lowerGoal = goal.toLowerCase();
	const lowerToken = token.toLowerCase();
	const idx = lowerGoal.indexOf(lowerToken);
	if (idx < 0) return undefined;

	const raw = goal.slice(idx + token.length).trim();
	if (!raw) return undefined;

	const reason = raw.split(/[\r\n;]+/)[0]?.trim();
	return reason && reason.length > 0 ? reason : undefined;
}

export function collectAntColonyProviders(
	input: AntColonyBudgetInput,
	currentModelRef?: string,
): string[] {
	const out = new Set<string>();

	const add = (modelRef?: string) => {
		const provider = providerOf(modelRef);
		if (provider) out.add(provider);
	};

	add(currentModelRef);
	add(input.scoutModel);
	add(input.workerModel);
	add(input.soldierModel);
	add(input.designWorkerModel);
	add(input.multimodalWorkerModel);
	add(input.backendWorkerModel);
	add(input.reviewWorkerModel);

	return [...out.values()].sort();
}

export function evaluateProviderBudgetGate(
	input: AntColonyBudgetInput,
	currentModelRef: string | undefined,
	goal: string,
	statuses: ProviderBudgetStatus[],
	allocationWarnings: string[],
	policy: ColonyPilotBudgetPolicyLike,
): ColonyPilotProviderBudgetGateEvaluation {
	const consideredProviders = collectAntColonyProviders(input, currentModelRef);
	if (statuses.length === 0) {
		return {
			ok: true,
			checked: false,
			issues: [],
			consideredProviders,
			blockedProviders: [],
			allocationWarnings,
		};
	}

	const blocked = statuses
		.filter((s) => s.state === "blocked")
		.filter(
			(s) =>
				consideredProviders.length === 0 ||
				consideredProviders.includes(s.provider),
		);

	if (blocked.length === 0) {
		return {
			ok: true,
			checked: true,
			issues: [],
			consideredProviders,
			blockedProviders: [],
			allocationWarnings,
		};
	}

	const blockedProviders = blocked.map((s) => s.provider).sort();

	if (policy.allowProviderBudgetOverride) {
		const reason = parseBudgetOverrideReason(
			goal,
			policy.providerBudgetOverrideToken,
		);
		if (reason) {
			return {
				ok: true,
				checked: true,
				issues: [],
				consideredProviders,
				blockedProviders,
				allocationWarnings,
				overrideReason: reason,
			};
		}
	}

	const issues = [
		`provider budget blocked for: ${blockedProviders.join(", ")}`,
		policy.allowProviderBudgetOverride
			? `override required in goal: '${policy.providerBudgetOverrideToken}<reason>'`
			: "override disabled by policy",
	];

	return {
		ok: false,
		checked: true,
		issues,
		consideredProviders,
		blockedProviders,
		allocationWarnings,
	};
}

export function evaluateAntColonyBudgetPolicy(
	input: AntColonyBudgetInput,
	policy: ColonyPilotBudgetPolicyLike,
): ColonyPilotBudgetPolicyEvaluation {
	const issues: string[] = [];

	let effectiveMax =
		typeof input.maxCost === "number" && Number.isFinite(input.maxCost)
			? input.maxCost
			: undefined;

	if (
		(effectiveMax === undefined || effectiveMax <= 0) &&
		policy.autoInjectMaxCost
	) {
		const injected = normalizeOptionalBudget(policy.defaultMaxCostUsd);
		if (injected !== undefined) {
			input.maxCost = injected;
			effectiveMax = injected;
		}
	}

	if (
		policy.requireMaxCost &&
		(effectiveMax === undefined || effectiveMax <= 0)
	) {
		issues.push(
			"maxCost is required for ant_colony (set input.maxCost or configure budgetPolicy.defaultMaxCostUsd)",
		);
	}

	if (effectiveMax !== undefined) {
		const min = normalizeOptionalBudget(policy.minMaxCostUsd);
		const cap = normalizeOptionalBudget(policy.hardCapUsd);

		if (min !== undefined && effectiveMax < min) {
			issues.push(`maxCost (${effectiveMax}) is below minMaxCostUsd (${min})`);
		}

		if (cap !== undefined && effectiveMax > cap) {
			issues.push(`maxCost (${effectiveMax}) exceeds hardCapUsd (${cap})`);
		}
	}

	return {
		ok: issues.length === 0,
		issues,
		effectiveMaxCostUsd: effectiveMax,
	};
}

export function formatBudgetPolicyEvaluation(
	policy: ColonyPilotBudgetPolicyLike,
	evaluation: ColonyPilotBudgetPolicyEvaluation,
): string[] {
	return [
		"budget-policy:",
		`  enabled: ${policy.enabled ? "yes" : "no"}`,
		`  enforceOnAntColonyTool: ${policy.enforceOnAntColonyTool ? "yes" : "no"}`,
		`  requireMaxCost: ${policy.requireMaxCost ? "yes" : "no"}`,
		`  autoInjectMaxCost: ${policy.autoInjectMaxCost ? "yes" : "no"}`,
		`  defaultMaxCostUsd: ${policy.defaultMaxCostUsd ?? "(none)"}`,
		`  hardCapUsd: ${policy.hardCapUsd ?? "(none)"}`,
		`  minMaxCostUsd: ${policy.minMaxCostUsd ?? "(none)"}`,
		`  enforceProviderBudgetBlock: ${policy.enforceProviderBudgetBlock ? "yes" : "no"}`,
		`  providerBudgetLookbackDays: ${policy.providerBudgetLookbackDays}`,
		`  allowProviderBudgetOverride: ${policy.allowProviderBudgetOverride ? "yes" : "no"}`,
		`  providerBudgetOverrideToken: ${policy.providerBudgetOverrideToken}`,
		`  effectiveMaxCostUsd: ${evaluation.effectiveMaxCostUsd ?? "(none)"}`,
	];
}
