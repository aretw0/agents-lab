import {
	type ColonyTaskSyncConfigShape as ColonyTaskSyncConfigShapeImpl,
} from "./colony-pilot-task-sync";
import {
	DEFAULT_COLONY_PILOT_DELIVERY_POLICY,
	type ColonyPilotDeliveryPolicyConfig as ColonyPilotDeliveryPolicyConfigImpl,
} from "./colony-pilot-delivery-policy";
import {
	type ColonyPilotBudgetPolicyLike as ColonyPilotBudgetPolicyLikeImpl,
} from "./colony-pilot-budget-policy";

export type ColonyPilotBudgetPolicyConfig = ColonyPilotBudgetPolicyLikeImpl & {
	enabled: boolean;
	enforceOnAntColonyTool: boolean;
};

export type ColonyPilotProjectTaskSyncConfig =
	ColonyTaskSyncConfigShapeImpl & {
		enabled: boolean;
		autoQueueRecoveryOnCandidate: boolean;
	};

export type ColonyPilotDeliveryPolicyConfig =
	ColonyPilotDeliveryPolicyConfigImpl;

export const DEFAULT_BUDGET_POLICY: ColonyPilotBudgetPolicyConfig = {
	enabled: false,
	enforceOnAntColonyTool: true,
	requireMaxCost: true,
	autoInjectMaxCost: true,
	defaultMaxCostUsd: 2,
	hardCapUsd: 20,
	minMaxCostUsd: 0.05,
	enforceProviderBudgetBlock: false,
	providerBudgetLookbackDays: 30,
	allowProviderBudgetOverride: true,
	providerBudgetOverrideToken: "budget-override:",
};

export const DEFAULT_PROJECT_TASK_SYNC: ColonyPilotProjectTaskSyncConfig = {
	enabled: false,
	createOnLaunch: true,
	trackProgress: true,
	markTerminalState: true,
	taskIdPrefix: "colony",
	requireHumanClose: true,
	maxNoteLines: 20,
	autoQueueRecoveryOnCandidate: true,
	recoveryTaskSuffix: "promotion",
};

export const DEFAULT_DELIVERY_POLICY: ColonyPilotDeliveryPolicyConfig = {
	...DEFAULT_COLONY_PILOT_DELIVERY_POLICY,
};

function normalizeOptionalBudget(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (value <= 0) return undefined;
	return Number(value.toFixed(4));
}

export function resolveColonyPilotBudgetPolicy(
	raw?: Partial<ColonyPilotBudgetPolicyConfig>,
): ColonyPilotBudgetPolicyConfig {
	const providerBudgetLookbackDaysRaw =
		typeof raw?.providerBudgetLookbackDays === "number" &&
		Number.isFinite(raw.providerBudgetLookbackDays)
			? Math.floor(raw.providerBudgetLookbackDays)
			: DEFAULT_BUDGET_POLICY.providerBudgetLookbackDays;

	const providerBudgetOverrideTokenRaw =
		typeof raw?.providerBudgetOverrideToken === "string"
			? raw.providerBudgetOverrideToken.trim()
			: "";

	return {
		enabled: raw?.enabled === true,
		enforceOnAntColonyTool: raw?.enforceOnAntColonyTool !== false,
		requireMaxCost: raw?.requireMaxCost !== false,
		autoInjectMaxCost: raw?.autoInjectMaxCost !== false,
		defaultMaxCostUsd:
			normalizeOptionalBudget(raw?.defaultMaxCostUsd) ??
			DEFAULT_BUDGET_POLICY.defaultMaxCostUsd,
		hardCapUsd:
			normalizeOptionalBudget(raw?.hardCapUsd) ??
			DEFAULT_BUDGET_POLICY.hardCapUsd,
		minMaxCostUsd:
			normalizeOptionalBudget(raw?.minMaxCostUsd) ??
			DEFAULT_BUDGET_POLICY.minMaxCostUsd,
		enforceProviderBudgetBlock: raw?.enforceProviderBudgetBlock === true,
		providerBudgetLookbackDays: Math.max(
			1,
			Math.min(90, providerBudgetLookbackDaysRaw),
		),
		allowProviderBudgetOverride: raw?.allowProviderBudgetOverride !== false,
		providerBudgetOverrideToken:
			providerBudgetOverrideTokenRaw.length > 0
				? providerBudgetOverrideTokenRaw
				: DEFAULT_BUDGET_POLICY.providerBudgetOverrideToken,
	};
}

export function resolveColonyPilotProjectTaskSync(
	raw?: Partial<ColonyPilotProjectTaskSyncConfig>,
): ColonyPilotProjectTaskSyncConfig {
	const prefixRaw =
		typeof raw?.taskIdPrefix === "string" ? raw.taskIdPrefix.trim() : "";
	const prefix =
		prefixRaw.length > 0 ? prefixRaw : DEFAULT_PROJECT_TASK_SYNC.taskIdPrefix;
	const maxNoteLinesRaw =
		typeof raw?.maxNoteLines === "number" && Number.isFinite(raw.maxNoteLines)
			? Math.floor(raw.maxNoteLines)
			: DEFAULT_PROJECT_TASK_SYNC.maxNoteLines;
	const recoverySuffixRaw =
		typeof raw?.recoveryTaskSuffix === "string"
			? raw.recoveryTaskSuffix.trim()
			: "";
	const recoveryTaskSuffix =
		recoverySuffixRaw.length > 0
			? recoverySuffixRaw.replace(/[^a-zA-Z0-9_-]+/g, "-")
			: DEFAULT_PROJECT_TASK_SYNC.recoveryTaskSuffix;

	return {
		enabled: raw?.enabled === true,
		createOnLaunch: raw?.createOnLaunch !== false,
		trackProgress: raw?.trackProgress !== false,
		markTerminalState: raw?.markTerminalState !== false,
		taskIdPrefix: prefix,
		requireHumanClose: raw?.requireHumanClose !== false,
		maxNoteLines: Math.max(5, Math.min(200, maxNoteLinesRaw)),
		autoQueueRecoveryOnCandidate: raw?.autoQueueRecoveryOnCandidate !== false,
		recoveryTaskSuffix,
	};
}
