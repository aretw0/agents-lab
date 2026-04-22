/**
 * colony-pilot — Session visibility + colony runtime orchestration primitive.
 * @capability-id colony-runtime-governance
 * @capability-criticality medium
 *
 * Goals:
 * - Give one first-party command surface to orchestrate colony pilot runs
 * - Make "web server running" and "background colony running" states visible
 * - Keep behavior generic (not tightly coupled to one package internals)
 *
 * Current bridge strategy:
 * - Delegates execution to existing slash commands (/monitors, /remote, /colony)
 * - Tracks state heuristically from emitted messages and tool outputs
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	captureColonyRuntimeSnapshot,
	persistColonyRetentionRecord,
	readColonyRetentionSnapshot,
} from "./colony-pilot-candidate-retention";
import type {
	HatchCheckStatus,
	HatchDoctorIssue,
	HatchDoctorSnapshot,
	HatchReadiness,
} from "./colony-pilot-hatch";
import {
	buildHatchDoctorSnapshot,
	capabilityGuidance,
	evaluateHatchReadiness,
	formatHatchDoctorSnapshot,
	formatHatchReadiness,
} from "./colony-pilot-hatch";
import type {
	ColonyPhase,
	MonitorMode,
	PilotCapabilities,
	PilotState,
} from "./colony-pilot-runtime";
import {
	applyTelemetryText,
	buildAntColonyMirrorCandidates,
	buildColonyRunSequence,
	buildColonyStopSequence,
	buildRuntimeRunSequence,
	buildRuntimeStopSequence,
	createPilotState,
	detectPilotCapabilities,
	formatPilotSnapshot,
	missingCapabilities,
	normalizeColonySignalId,
	normalizeQuotedText,
	parseColonySignal,
	parseCommandInput,
	parseMonitorModeFromText,
	parseRemoteAccessUrl,
	renderPilotStatus,
	requiresApplyToBranch,
	snapshotPilotState,
	toBaseCommandName,
} from "./colony-pilot-runtime";
import type {
	ColonyPilotPreflightConfig,
	ColonyPilotPreflightResult,
} from "./colony-pilot-preflight";
import {
	executableProbe,
	formatPreflightResult,
	resolveColonyPilotPreflightConfig,
	runColonyPilotPreflight,
} from "./colony-pilot-preflight";
import type {
	ColonyModelReadiness,
	ModelAuthStatus,
} from "./colony-pilot-model-readiness";
import {
	formatModelReadiness,
	parseProviderModelRef,
	resolveColonyModelReadiness,
	resolveModelAuthStatus,
} from "./colony-pilot-model-readiness";
import {
	appendNote,
	ensureRecoveryTaskForCandidate as ensureRecoveryTaskForCandidateInternal,
	extractColonyGoalFromMessageText,
	readProjectTasksBlock,
	upsertProjectTaskFromColonySignal,
	writeProjectTasksBlock,
} from "./colony-pilot-task-sync";
import {
	analyzeQuota,
	type ProviderBudgetMap,
	type ProviderBudgetStatus,
	parseProviderBudgets,
	safeNum,
} from "./quota-visibility";

export type {
	ColonyModelReadiness,
	ColonyPhase,
	ColonyPilotPreflightConfig,
	ColonyPilotPreflightResult,
	HatchCheckStatus,
	HatchDoctorIssue,
	HatchDoctorSnapshot,
	HatchReadiness,
	ModelAuthStatus,
	MonitorMode,
	PilotCapabilities,
	PilotState,
};
export {
	applyTelemetryText,
	buildAntColonyMirrorCandidates,
	buildColonyRunSequence,
	buildColonyStopSequence,
	executableProbe,
	buildHatchDoctorSnapshot,
	buildRuntimeRunSequence,
	buildRuntimeStopSequence,
	capabilityGuidance,
	createPilotState,
	detectPilotCapabilities,
	evaluateHatchReadiness,
	formatHatchDoctorSnapshot,
	formatHatchReadiness,
	missingCapabilities,
	normalizeColonySignalId,
	normalizeQuotedText,
	parseProviderModelRef,
	parseColonySignal,
	parseCommandInput,
	parseMonitorModeFromText,
	parseRemoteAccessUrl,
	resolveColonyPilotPreflightConfig,
	resolveColonyModelReadiness,
	resolveModelAuthStatus,
	runColonyPilotPreflight,
	requiresApplyToBranch,
	snapshotPilotState,
	toBaseCommandName,
};

const ROLE_ORDER: Array<Exclude<ColonyAgentRole, "queen">> = [
	"scout",
	"worker",
	"soldier",
	"design",
	"multimodal",
	"backend",
	"review",
];

const CORE_ROLE_ORDER: Array<Exclude<ColonyAgentRole, "queen">> = [
	"scout",
	"worker",
	"soldier",
];

type AntColonyRoleModelInputKey =
	| "scoutModel"
	| "workerModel"
	| "soldierModel"
	| "designWorkerModel"
	| "multimodalWorkerModel"
	| "backendWorkerModel"
	| "reviewWorkerModel";

const ROLE_TO_INPUT_KEY: Record<
	Exclude<ColonyAgentRole, "queen">,
	AntColonyRoleModelInputKey
> = {
	scout: "scoutModel",
	worker: "workerModel",
	soldier: "soldierModel",
	design: "designWorkerModel",
	multimodal: "multimodalWorkerModel",
	backend: "backendWorkerModel",
	review: "reviewWorkerModel",
};

const DEFAULT_MODEL_POLICY: ColonyPilotModelPolicyConfig = {
	enabled: true,
	specializedRolesEnabled: false,
	autoInjectRoleModels: true,
	requireHealthyCurrentModel: true,
	requireExplicitRoleModels: false,
	requiredRoles: ["scout", "worker", "soldier"],
	enforceFullModelRef: true,
	allowMixedProviders: true,
	allowedProviders: [],
	allowedProvidersByRole: {},
	roleModels: {},
	sparkGateEnabled: false,
	sparkAllowedGoalTriggers: ["planning recovery", "scout burst"],
	sparkScoutOnlyTrigger: "scout burst",
};

const DEFAULT_BUDGET_POLICY: ColonyPilotBudgetPolicyConfig = {
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

const DEFAULT_PROJECT_TASK_SYNC: ColonyPilotProjectTaskSyncConfig = {
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

const DEFAULT_DELIVERY_POLICY: ColonyPilotDeliveryPolicyConfig = {
	enabled: false,
	mode: "report-only",
	requireWorkspaceReport: true,
	requireTaskSummary: true,
	requireFileInventory: false,
	requireValidationCommandLog: false,
	blockOnMissingEvidence: true,
};

export interface ColonyPilotOutputPolicyConfig {
	compactLargeJson: boolean;
	maxInlineJsonChars: number;
}

const DEFAULT_OUTPUT_POLICY: ColonyPilotOutputPolicyConfig = {
	compactLargeJson: true,
	maxInlineJsonChars: 1800,
};

export interface ColonyPilotCandidateRetentionConfig {
	enabled: boolean;
	maxEntries: number;
	maxAgeDays: number;
}

const DEFAULT_CANDIDATE_RETENTION_CONFIG: ColonyPilotCandidateRetentionConfig =
	{
		enabled: true,
		maxEntries: 40,
		maxAgeDays: 14,
	};

export interface AntColonyToolInput {
	goal: string;
	maxAnts?: number;
	maxCost?: number;
	scoutModel?: string;
	workerModel?: string;
	soldierModel?: string;
	designWorkerModel?: string;
	multimodalWorkerModel?: string;
	backendWorkerModel?: string;
	reviewWorkerModel?: string;
	deliveryMode?: ColonyDeliveryMode;
}

/** Parse and validate a per-call delivery mode override from raw tool input.
 *  Returns the valid ColonyDeliveryMode if provided and recognized, else undefined. */
export function parseDeliveryModeOverride(
	input: unknown,
): ColonyDeliveryMode | undefined {
	if (!input || typeof input !== "object") return undefined;
	const raw = (input as Record<string, unknown>)["deliveryMode"];
	if (
		raw === "report-only" ||
		raw === "patch-artifact" ||
		raw === "apply-to-branch"
	) {
		return raw as ColonyDeliveryMode;
	}
	return undefined;
}

function extractRuntimeColonyId(signalId: string): string | undefined {
	const raw = signalId.split("|")[1]?.trim();
	if (!raw) return undefined;
	if (raw.includes("${") || raw.includes("}")) return undefined;
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw)) return undefined;
	return raw;
}

function normalizeRoleList(value: unknown): ColonyAgentRole[] {
	if (!Array.isArray(value)) return [...DEFAULT_MODEL_POLICY.requiredRoles];
	const allowed: ColonyAgentRole[] = ["queen", ...ROLE_ORDER];
	const out = value.filter(
		(v): v is ColonyAgentRole =>
			typeof v === "string" && allowed.includes(v as ColonyAgentRole),
	);
	return out.length > 0 ? out : [...DEFAULT_MODEL_POLICY.requiredRoles];
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
		.map((v) => v.trim());
}

function normalizeRoleModels(value: unknown): ColonyRoleModelMap {
	const input = isPlainObject(value) ? (value as Record<string, unknown>) : {};
	const out: ColonyRoleModelMap = {};
	for (const role of ROLE_ORDER) {
		const v = input[role];
		if (typeof v === "string" && v.trim().length > 0) out[role] = v.trim();
	}
	return out;
}

function normalizeAllowedProvidersByRole(
	value: unknown,
): Partial<Record<ColonyAgentRole, string[]>> {
	const input = isPlainObject(value) ? (value as Record<string, unknown>) : {};
	const out: Partial<Record<ColonyAgentRole, string[]>> = {};
	for (const role of ["queen", ...ROLE_ORDER] as ColonyAgentRole[]) {
		const providers = normalizeStringList(input[role]);
		if (providers.length > 0) out[role] = providers;
	}
	return out;
}

export function resolveColonyPilotModelPolicy(
	raw?: Partial<ColonyPilotModelPolicyConfig>,
): ColonyPilotModelPolicyConfig {
	const specializedRolesEnabled = raw?.specializedRolesEnabled === true;
	const requestedRequiredRoles = normalizeRoleList(raw?.requiredRoles);
	const sparkAllowedGoalTriggers = normalizeStringList(
		raw?.sparkAllowedGoalTriggers,
	)
		.map((v) => v.toLowerCase())
		.filter((v, idx, arr) => arr.indexOf(v) === idx);
	const sparkScoutOnlyTriggerRaw =
		typeof raw?.sparkScoutOnlyTrigger === "string"
			? raw.sparkScoutOnlyTrigger.trim().toLowerCase()
			: "";
	const requiredRoles = specializedRolesEnabled
		? requestedRequiredRoles
		: requestedRequiredRoles.filter(
				(role) =>
					role === "queen" ||
					CORE_ROLE_ORDER.includes(role as Exclude<ColonyAgentRole, "queen">),
			);

	return {
		enabled: raw?.enabled !== false,
		specializedRolesEnabled,
		autoInjectRoleModels: raw?.autoInjectRoleModels !== false,
		requireHealthyCurrentModel: raw?.requireHealthyCurrentModel !== false,
		requireExplicitRoleModels: raw?.requireExplicitRoleModels === true,
		requiredRoles,
		enforceFullModelRef: raw?.enforceFullModelRef !== false,
		allowMixedProviders: raw?.allowMixedProviders !== false,
		allowedProviders: normalizeStringList(raw?.allowedProviders),
		allowedProvidersByRole: normalizeAllowedProvidersByRole(
			raw?.allowedProvidersByRole,
		),
		roleModels: normalizeRoleModels(raw?.roleModels),
		sparkGateEnabled: raw?.sparkGateEnabled === true,
		sparkAllowedGoalTriggers:
			sparkAllowedGoalTriggers.length > 0
				? sparkAllowedGoalTriggers
				: [...DEFAULT_MODEL_POLICY.sparkAllowedGoalTriggers],
		sparkScoutOnlyTrigger:
			sparkScoutOnlyTriggerRaw || DEFAULT_MODEL_POLICY.sparkScoutOnlyTrigger,
	};
}

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

export function resolveColonyPilotDeliveryPolicy(
	raw?: Partial<ColonyPilotDeliveryPolicyConfig>,
): ColonyPilotDeliveryPolicyConfig {
	const modeRaw = typeof raw?.mode === "string" ? raw.mode.trim() : "";
	const mode: ColonyDeliveryMode =
		modeRaw === "patch-artifact" ||
		modeRaw === "apply-to-branch" ||
		modeRaw === "report-only"
			? modeRaw
			: DEFAULT_DELIVERY_POLICY.mode;

	return {
		enabled: raw?.enabled === true,
		mode,
		requireWorkspaceReport: raw?.requireWorkspaceReport !== false,
		requireTaskSummary: raw?.requireTaskSummary !== false,
		requireFileInventory: raw?.requireFileInventory === true,
		requireValidationCommandLog: raw?.requireValidationCommandLog === true,
		blockOnMissingEvidence: raw?.blockOnMissingEvidence !== false,
	};
}

export function evaluateColonyDeliveryEvidence(
	text: string,
	phase: ColonyPhase,
	policy: ColonyPilotDeliveryPolicyConfig,
): ColonyPilotDeliveryEvaluation {
	const validationHeadingPattern =
		/(?:validation\s+command\s+log|validation\s+commands?|comandos?\s+de\s+valida[cç][aã]o)/i;
	const commandLikePattern =
		/(?:pnpm|npm|npx|vitest|node(?:\.exe)?\s+--test|\S*node(?:\.exe)?\s+\S+|tsc|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle(?:w)?\s+test|bun\s+test)\b/i;
	const hasValidationHeading = validationHeadingPattern.test(text);
	const hasCommandLikeLine =
		new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:` + "`" + `)?${commandLikePattern.source}`, "m").test(text);
	const hasValidationInlineCommand =
		new RegExp(
			`(?:^|\\n)\\s*${validationHeadingPattern.source}\\s*[:\-]\\s*(?:` + "`" + `)?${commandLikePattern.source}`,
			"im",
		).test(text);

	const evidence: ColonyPilotDeliveryEvidence = {
		hasWorkspaceReport:
			/###\s+🧪\s+Workspace|Mode:\s+(?:isolated|shared)/i.test(text),
		hasTaskSummary: /\*\*Tasks:\*\*\s*\d+\/\d+|tasks\s+done/i.test(text),
		hasFileInventory:
			/(?:files?\s+(?:changed|altered|touched)|arquivos?\s+alterad|invent[aá]rio\s+final)/i.test(
				text,
			),
		hasValidationCommandLog:
			hasValidationInlineCommand || (hasValidationHeading && hasCommandLikeLine),
	};

	if (!policy.enabled || phase !== "completed") {
		return { ok: true, issues: [], evidence };
	}

	const issues: string[] = [];
	if (policy.requireWorkspaceReport && !evidence.hasWorkspaceReport) {
		issues.push("delivery evidence missing: workspace report");
	}
	if (policy.requireTaskSummary && !evidence.hasTaskSummary) {
		issues.push("delivery evidence missing: task summary");
	}
	if (policy.requireFileInventory && !evidence.hasFileInventory) {
		issues.push("delivery evidence missing: file inventory");
	}
	if (policy.requireValidationCommandLog && !evidence.hasValidationCommandLog) {
		issues.push(
			"delivery evidence missing: validation command log (expected section 'Validation command log' with command lines in backticks)",
		);
	}

	return { ok: issues.length === 0, issues, evidence };
}

export function formatDeliveryPolicyEvaluation(
	policy: ColonyPilotDeliveryPolicyConfig,
	evalResult: ColonyPilotDeliveryEvaluation,
): string[] {
	return [
		"delivery policy:",
		`  enabled: ${policy.enabled ? "yes" : "no"}`,
		`  mode: ${policy.mode}`,
		`  requireWorkspaceReport: ${policy.requireWorkspaceReport ? "yes" : "no"}`,
		`  requireTaskSummary: ${policy.requireTaskSummary ? "yes" : "no"}`,
		`  requireFileInventory: ${policy.requireFileInventory ? "yes" : "no"}`,
		`  requireValidationCommandLog: ${policy.requireValidationCommandLog ? "yes" : "no"}`,
		`  blockOnMissingEvidence: ${policy.blockOnMissingEvidence ? "yes" : "no"}`,
		`  evaluation: ${evalResult.ok ? "ok" : "issues"}`,
	];
}

export function colonyPhaseToProjectTaskStatus(
	phase: ColonyPhase,
	requireHumanClose: boolean,
): "planned" | "in-progress" | "completed" | "blocked" {
	if (phase === "failed" || phase === "aborted" || phase === "budget_exceeded")
		return "blocked";
	if (phase === "completed")
		return requireHumanClose ? "in-progress" : "completed";
	return "in-progress";
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
	input: AntColonyToolInput,
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

export interface ColonyPilotProviderBudgetGateEvaluation {
	ok: boolean;
	checked: boolean;
	issues: string[];
	consideredProviders: string[];
	blockedProviders: string[];
	allocationWarnings: string[];
	overrideReason?: string;
}

export function evaluateProviderBudgetGate(
	input: AntColonyToolInput,
	currentModelRef: string | undefined,
	goal: string,
	statuses: ProviderBudgetStatus[],
	allocationWarnings: string[],
	policy: ColonyPilotBudgetPolicyConfig,
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
	input: AntColonyToolInput,
	policy: ColonyPilotBudgetPolicyConfig,
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

function formatBudgetPolicyEvaluation(
	policy: ColonyPilotBudgetPolicyConfig,
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

export interface ColonyModelPolicyEvaluation {
	ok: boolean;
	issues: string[];
	effectiveModels: Record<ColonyAgentRole, string | undefined>;
}

function providerOf(modelRef: string | undefined): string | undefined {
	if (!modelRef) return undefined;
	return parseProviderModelRef(modelRef)?.provider;
}

export function evaluateAntColonyModelPolicy(
	input: AntColonyToolInput,
	currentModelRef: string | undefined,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	modelRegistry: any,
	policy: ColonyPilotModelPolicyConfig,
	goal?: string,
): ColonyModelPolicyEvaluation {
	const issues: string[] = [];
	const effectiveModels: Record<ColonyAgentRole, string | undefined> = {
		queen: currentModelRef,
		scout: undefined,
		worker: undefined,
		soldier: undefined,
		design: undefined,
		multimodal: undefined,
		backend: undefined,
		review: undefined,
	};

	const activeRoles = policy.specializedRolesEnabled
		? ROLE_ORDER
		: CORE_ROLE_ORDER;

	if (policy.requireHealthyCurrentModel) {
		const status = resolveModelAuthStatus(modelRegistry, currentModelRef);
		if (status !== "ok" && status !== "unavailable") {
			issues.push(
				`queen model invalid/unavailable for runtime: ${currentModelRef ?? "(none)"} (${status})`,
			);
		}
	}

	const queenProvider = providerOf(currentModelRef);
	const queenAllowed = policy.allowedProvidersByRole.queen ?? [];
	if (
		queenProvider &&
		queenAllowed.length > 0 &&
		!queenAllowed.includes(queenProvider)
	) {
		issues.push(
			`queen provider '${queenProvider}' is not in allowedProvidersByRole.queen`,
		);
	}

	for (const role of ROLE_ORDER) {
		const key = ROLE_TO_INPUT_KEY[role];
		const explicit =
			typeof input[key] === "string" ? input[key]?.trim() : undefined;
		const roleIsActive = activeRoles.includes(role);
		const configured = roleIsActive ? policy.roleModels[role] : undefined;

		if (
			!explicit &&
			roleIsActive &&
			policy.autoInjectRoleModels &&
			configured
		) {
			input[key] = configured;
		}

		const effective =
			(typeof input[key] === "string" && input[key]?.trim().length
				? input[key]?.trim()
				: undefined) ?? currentModelRef;
		effectiveModels[role] = effective;

		// In generic-first mode, specialist roles are advisory only unless explicitly overridden.
		if (!roleIsActive && !explicit) {
			continue;
		}

		if (
			policy.requireExplicitRoleModels &&
			policy.requiredRoles.includes(role) &&
			!input[key]
		) {
			issues.push(`missing explicit model for role '${role}' (${String(key)})`);
			continue;
		}

		if (!effective) {
			issues.push(`role '${role}' has no effective model`);
			continue;
		}

		if (policy.enforceFullModelRef && !parseProviderModelRef(effective)) {
			issues.push(`role '${role}' model must be provider/model: ${effective}`);
			continue;
		}

		const status = resolveModelAuthStatus(modelRegistry, effective);
		if (status !== "ok" && status !== "unavailable") {
			issues.push(`role '${role}' model not ready: ${effective} (${status})`);
		}

		const provider = providerOf(effective);
		if (
			provider &&
			policy.allowedProviders.length > 0 &&
			!policy.allowedProviders.includes(provider)
		) {
			issues.push(
				`role '${role}' provider '${provider}' is not in allowedProviders`,
			);
		}

		const roleAllowed = policy.allowedProvidersByRole[role] ?? [];
		if (provider && roleAllowed.length > 0 && !roleAllowed.includes(provider)) {
			issues.push(
				`role '${role}' provider '${provider}' is not in allowedProvidersByRole.${role}`,
			);
		}
	}

	if (!policy.allowMixedProviders) {
		const providers = new Set<string>();
		for (const role of ["queen", ...activeRoles] as ColonyAgentRole[]) {
			const p = providerOf(effectiveModels[role]);
			if (p) providers.add(p);
		}
		if (providers.size > 1) {
			issues.push(
				`mixed providers are disabled, found: ${[...providers].join(", ")}`,
			);
		}
	}

	if (policy.sparkGateEnabled) {
		const sparkRoles = (["queen", ...ROLE_ORDER] as ColonyAgentRole[]).filter(
			(role) => {
				const modelRef = effectiveModels[role];
				return (
					typeof modelRef === "string" &&
					modelRef.toLowerCase().includes("codex-spark")
				);
			},
		);

		if (sparkRoles.length > 0) {
			const normalizedGoal = (goal ?? "").toLowerCase();
			const matchedSparkTriggers = policy.sparkAllowedGoalTriggers.filter(
				(trigger) => normalizedGoal.includes(trigger),
			);

			if (matchedSparkTriggers.length === 0) {
				issues.push(
					`spark model usage requires explicit goal trigger: ${policy.sparkAllowedGoalTriggers.join(", ")}`,
				);
			} else {
				const hasPlanningRecoveryTrigger =
					matchedSparkTriggers.includes("planning recovery");
				const hasScoutOnlyTrigger = matchedSparkTriggers.includes(
					policy.sparkScoutOnlyTrigger,
				);

				if (!hasPlanningRecoveryTrigger && hasScoutOnlyTrigger) {
					const nonScoutRoles = sparkRoles.filter((role) => role !== "scout");
					if (nonScoutRoles.length > 0) {
						issues.push(
							`spark with trigger '${policy.sparkScoutOnlyTrigger}' is scout-only; found roles: ${nonScoutRoles.join(", ")}`,
						);
					}
				}
			}
		}
	}

	return {
		ok: issues.length === 0,
		issues,
		effectiveModels,
	};
}

function formatPolicyEvaluation(
	policy: ColonyPilotModelPolicyConfig,
	evalResult: ColonyModelPolicyEvaluation,
): string[] {
	const roleAllowRows = (["queen", ...ROLE_ORDER] as ColonyAgentRole[])
		.map((role) => {
			const providers = policy.allowedProvidersByRole[role] ?? [];
			if (providers.length === 0) return undefined;
			return `    ${role}: ${providers.join(", ")}`;
		})
		.filter((row): row is string => Boolean(row));

	const activeRoles = policy.specializedRolesEnabled
		? ROLE_ORDER
		: CORE_ROLE_ORDER;

	return [
		"model-policy:",
		`  enabled: ${policy.enabled ? "yes" : "no"}`,
		`  specializedRolesEnabled: ${policy.specializedRolesEnabled ? "yes" : "no"}`,
		`  activeRoles: ${activeRoles.join(", ")}`,
		`  autoInjectRoleModels: ${policy.autoInjectRoleModels ? "yes" : "no"}`,
		`  requireHealthyCurrentModel: ${policy.requireHealthyCurrentModel ? "yes" : "no"}`,
		`  requireExplicitRoleModels: ${policy.requireExplicitRoleModels ? "yes" : "no"}`,
		`  requiredRoles: ${policy.requiredRoles.join(", ") || "(none)"}`,
		`  allowMixedProviders: ${policy.allowMixedProviders ? "yes" : "no"}`,
		`  allowedProviders: ${policy.allowedProviders.join(", ") || "(any)"}`,
		`  sparkGateEnabled: ${policy.sparkGateEnabled ? "yes" : "no"}`,
		`  sparkAllowedGoalTriggers: ${policy.sparkAllowedGoalTriggers.join(", ") || "(none)"}`,
		`  sparkScoutOnlyTrigger: ${policy.sparkScoutOnlyTrigger || "(none)"}`,
		`  allowedProvidersByRole: ${roleAllowRows.length > 0 ? "(configured)" : "(none)"}`,
		...(roleAllowRows.length > 0 ? roleAllowRows : []),
		"  effectiveModels:",
		`    queen: ${evalResult.effectiveModels.queen ?? "(none)"}`,
		...ROLE_ORDER.map(
			(role) => `    ${role}: ${evalResult.effectiveModels[role] ?? "(none)"}`,
		),
	];
}

function inspectAntColonyRuntime(cwd: string) {
	const roots = buildAntColonyMirrorCandidates(cwd).filter((p) =>
		existsSync(p),
	);
	const retention = readColonyRetentionSnapshot(cwd, 12);

	const mirrors = roots.map((rootPath) => {
		const coloniesDir = path.join(rootPath, "colonies");
		const worktreesDir = path.join(rootPath, "worktrees");

		const colonies: Array<{
			id: string;
			status: string;
			updatedAt: number;
			goal?: string;
			statePath: string;
		}> = [];
		if (existsSync(coloniesDir)) {
			for (const d of readdirSync(coloniesDir, { withFileTypes: true })) {
				if (!d.isDirectory()) continue;
				const statePath = path.join(coloniesDir, d.name, "state.json");
				if (!existsSync(statePath)) continue;
				try {
					const json = JSON.parse(readFileSync(statePath, "utf8"));
					const st = statSync(statePath);
					colonies.push({
						id: json.id ?? d.name,
						status: json.status ?? "unknown",
						goal: typeof json.goal === "string" ? json.goal : undefined,
						updatedAt: st.mtimeMs,
						statePath,
					});
				} catch {
					// ignore malformed state
				}
			}
		}

		colonies.sort((a, b) => b.updatedAt - a.updatedAt);

		const worktrees: Array<{ name: string; path: string; updatedAt: number }> =
			[];
		if (existsSync(worktreesDir)) {
			for (const d of readdirSync(worktreesDir, { withFileTypes: true })) {
				if (!d.isDirectory()) continue;
				const full = path.join(worktreesDir, d.name);
				if (!existsSync(path.join(full, ".git"))) continue;
				worktrees.push({
					name: d.name,
					path: full,
					updatedAt: statSync(full).mtimeMs,
				});
			}
		}

		worktrees.sort((a, b) => b.updatedAt - a.updatedAt);

		return {
			root: rootPath,
			colonies: colonies.slice(0, 8),
			worktrees: worktrees.slice(0, 8),
		};
	});

	return { cwd: path.resolve(cwd), mirrors, retention };
}

function formatArtifactsReport(
	data: ReturnType<typeof inspectAntColonyRuntime>,
): string {
	const out: string[] = [];
	out.push("colony-pilot artifacts");
	out.push(`cwd: ${data.cwd}`);

	if (data.mirrors.length === 0) {
		out.push("No ant-colony workspace mirror found for this cwd.");
	}

	for (const m of data.mirrors) {
		out.push("");
		out.push(`mirror: ${m.root}`);

		out.push("  colonies:");
		if (m.colonies.length === 0) out.push("    (none)");
		for (const c of m.colonies) {
			out.push(
				`    - ${c.id} [${c.status}] ${new Date(c.updatedAt).toISOString()}`,
			);
			out.push(`      state: ${c.statePath}`);
			if (c.goal) out.push(`      goal: ${c.goal.slice(0, 100)}`);
		}

		out.push("  worktrees:");
		if (m.worktrees.length === 0) out.push("    (none)");
		for (const w of m.worktrees) {
			out.push(`    - ${w.name} ${new Date(w.updatedAt).toISOString()}`);
			out.push(`      path: ${w.path}`);
		}
	}

	out.push("");
	out.push(`retention: ${data.retention.exists ? "enabled" : "absent"}`);
	out.push(`retentionRoot: ${data.retention.root}`);
	out.push(`retentionRecords: ${data.retention.count}`);
	if (data.retention.records.length === 0) {
		out.push("  (none)");
	} else {
		for (const entry of data.retention.records) {
			out.push(
				`  - ${entry.record.colonyId} [${entry.record.phase}] ${entry.updatedAtIso}`,
			);
			out.push(`    file: ${entry.path}`);
			if (entry.record.runtimeColonyId) {
				out.push(`    runtimeId: ${entry.record.runtimeColonyId}`);
			}
			if (entry.record.runtimeSnapshotPath) {
				out.push(`    recovery: ${entry.record.runtimeSnapshotPath}`);
			}
			if (entry.record.runtimeSnapshotMissingReason) {
				out.push(
					`    recovery-missing: ${entry.record.runtimeSnapshotMissingReason}`,
				);
			}
			if (entry.record.goal) {
				out.push(`    goal: ${entry.record.goal.slice(0, 100)}`);
			}
		}
	}

	return out.join("\n");
}

export type ColonyAgentRole =
	| "queen"
	| "scout"
	| "worker"
	| "soldier"
	| "design"
	| "multimodal"
	| "backend"
	| "review";

export interface ColonyRoleModelMap {
	scout?: string;
	worker?: string;
	soldier?: string;
	design?: string;
	multimodal?: string;
	backend?: string;
	review?: string;
}

export interface ColonyPilotModelPolicyConfig {
	enabled: boolean;
	specializedRolesEnabled: boolean;
	autoInjectRoleModels: boolean;
	requireHealthyCurrentModel: boolean;
	requireExplicitRoleModels: boolean;
	requiredRoles: ColonyAgentRole[];
	enforceFullModelRef: boolean;
	allowMixedProviders: boolean;
	allowedProviders: string[];
	allowedProvidersByRole: Partial<Record<ColonyAgentRole, string[]>>;
	roleModels: ColonyRoleModelMap;
	sparkGateEnabled: boolean;
	sparkAllowedGoalTriggers: string[];
	sparkScoutOnlyTrigger: string;
}

export interface ColonyPilotBudgetPolicyConfig {
	enabled: boolean;
	enforceOnAntColonyTool: boolean;
	requireMaxCost: boolean;
	autoInjectMaxCost: boolean;
	defaultMaxCostUsd?: number;
	hardCapUsd?: number;
	minMaxCostUsd?: number;
	enforceProviderBudgetBlock: boolean;
	providerBudgetLookbackDays: number;
	allowProviderBudgetOverride: boolean;
	providerBudgetOverrideToken: string;
}

export interface ColonyPilotBudgetPolicyEvaluation {
	ok: boolean;
	issues: string[];
	effectiveMaxCostUsd?: number;
}

export interface ColonyPilotProjectTaskSyncConfig {
	enabled: boolean;
	createOnLaunch: boolean;
	trackProgress: boolean;
	markTerminalState: boolean;
	taskIdPrefix: string;
	requireHumanClose: boolean;
	maxNoteLines: number;
	autoQueueRecoveryOnCandidate: boolean;
	recoveryTaskSuffix: string;
}

export type ColonyDeliveryMode =
	| "report-only"
	| "patch-artifact"
	| "apply-to-branch";

export interface ColonyPilotDeliveryPolicyConfig {
	enabled: boolean;
	mode: ColonyDeliveryMode;
	requireWorkspaceReport: boolean;
	requireTaskSummary: boolean;
	requireFileInventory: boolean;
	requireValidationCommandLog: boolean;
	blockOnMissingEvidence: boolean;
}

export interface ColonyPilotDeliveryEvidence {
	hasWorkspaceReport: boolean;
	hasTaskSummary: boolean;
	hasFileInventory: boolean;
	hasValidationCommandLog: boolean;
}

export interface ColonyPilotDeliveryEvaluation {
	ok: boolean;
	issues: string[];
	evidence: ColonyPilotDeliveryEvidence;
}

interface ColonyPilotSettings {
	preflight?: Partial<ColonyPilotPreflightConfig>;
	modelPolicy?: Partial<ColonyPilotModelPolicyConfig>;
	budgetPolicy?: Partial<ColonyPilotBudgetPolicyConfig>;
	projectTaskSync?: Partial<ColonyPilotProjectTaskSyncConfig>;
	deliveryPolicy?: Partial<ColonyPilotDeliveryPolicyConfig>;
	outputPolicy?: Partial<ColonyPilotOutputPolicyConfig>;
	candidateRetention?: Partial<ColonyPilotCandidateRetentionConfig>;
}

interface QuotaVisibilityBudgetSettings {
	weeklyQuotaTokens?: number;
	weeklyQuotaCostUsd?: number;
	weeklyQuotaRequests?: number;
	monthlyQuotaTokens?: number;
	monthlyQuotaCostUsd?: number;
	monthlyQuotaRequests?: number;
	providerBudgets: ProviderBudgetMap;
}

function parseColonyPilotSettings(cwd: string): ColonyPilotSettings {
	try {
		const p = path.join(cwd, ".pi", "settings.json");
		if (!existsSync(p)) return {};
		const json = JSON.parse(readFileSync(p, "utf8"));
		return json?.piStack?.colonyPilot ?? json?.extensions?.colonyPilot ?? {};
	} catch {
		return {};
	}
}

function parseQuotaVisibilityBudgetSettings(
	cwd: string,
): QuotaVisibilityBudgetSettings {
	try {
		const p = path.join(cwd, ".pi", "settings.json");
		if (!existsSync(p)) return { providerBudgets: {} };
		const json = JSON.parse(readFileSync(p, "utf8"));
		const cfg = json?.piStack?.quotaVisibility ?? {};

		return {
			weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
			weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
			weeklyQuotaRequests: safeNum(cfg.weeklyQuotaRequests) || undefined,
			monthlyQuotaTokens: safeNum(cfg.monthlyQuotaTokens) || undefined,
			monthlyQuotaCostUsd: safeNum(cfg.monthlyQuotaCostUsd) || undefined,
			monthlyQuotaRequests: safeNum(cfg.monthlyQuotaRequests) || undefined,
			providerBudgets: parseProviderBudgets(cfg.providerBudgets),
		};
	} catch {
		return { providerBudgets: {} };
	}
}

export function resolveColonyPilotOutputPolicy(
	raw?: Partial<ColonyPilotOutputPolicyConfig>,
): ColonyPilotOutputPolicyConfig {
	const maxInline =
		typeof raw?.maxInlineJsonChars === "number" &&
		Number.isFinite(raw.maxInlineJsonChars)
			? Math.floor(raw.maxInlineJsonChars)
			: DEFAULT_OUTPUT_POLICY.maxInlineJsonChars;

	return {
		compactLargeJson: raw?.compactLargeJson !== false,
		maxInlineJsonChars: Math.max(400, Math.min(20_000, maxInline)),
	};
}

export function resolveColonyPilotCandidateRetentionConfig(
	raw?: Partial<ColonyPilotCandidateRetentionConfig>,
): ColonyPilotCandidateRetentionConfig {
	const maxEntriesRaw =
		typeof raw?.maxEntries === "number" && Number.isFinite(raw.maxEntries)
			? Math.floor(raw.maxEntries)
			: DEFAULT_CANDIDATE_RETENTION_CONFIG.maxEntries;
	const maxAgeDaysRaw =
		typeof raw?.maxAgeDays === "number" && Number.isFinite(raw.maxAgeDays)
			? Math.floor(raw.maxAgeDays)
			: DEFAULT_CANDIDATE_RETENTION_CONFIG.maxAgeDays;

	return {
		enabled: raw?.enabled !== false,
		maxEntries: Math.max(1, Math.min(500, maxEntriesRaw)),
		maxAgeDays: Math.max(1, Math.min(365, maxAgeDaysRaw)),
	};
}
export type BaselineProfile = "default" | "phase2";
export type ModelPolicyProfile =
	| "copilot"
	| "codex"
	| "hybrid"
	| "factory-strict"
	| "factory-strict-copilot"
	| "factory-strict-hybrid";

export function resolveBaselineProfile(input?: string): BaselineProfile {
	return input === "phase2" ? "phase2" : "default";
}

export function resolveModelPolicyProfile(input?: string): ModelPolicyProfile {
	return input === "copilot" ||
		input === "hybrid" ||
		input === "factory-strict" ||
		input === "factory-strict-copilot" ||
		input === "factory-strict-hybrid"
		? input
		: "codex";
}

export function buildModelPolicyProfile(
	profile: ModelPolicyProfile,
): ColonyPilotModelPolicyConfig {
	if (profile === "copilot") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: false,
			allowMixedProviders: false,
			allowedProviders: ["github-copilot"],
			roleModels: {
				scout: "github-copilot/claude-haiku-4.5",
				worker: "github-copilot/claude-sonnet-4.6",
				soldier: "github-copilot/claude-sonnet-4.6",
			},
		});
	}

	if (profile === "hybrid") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: false,
			allowMixedProviders: true,
			allowedProviders: ["github-copilot", "openai-codex"],
			roleModels: {
				scout: "openai-codex/gpt-5.4-mini",
				worker: "github-copilot/claude-sonnet-4.6",
				soldier: "openai-codex/gpt-5.2-codex",
			},
		});
	}

	if (profile === "factory-strict-copilot") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: true,
			autoInjectRoleModels: true,
			requireExplicitRoleModels: true,
			requiredRoles: [
				"scout",
				"worker",
				"soldier",
				"design",
				"multimodal",
				"backend",
				"review",
			],
			enforceFullModelRef: true,
			allowMixedProviders: false,
			allowedProviders: ["github-copilot"],
			roleModels: {
				scout: "github-copilot/claude-haiku-4.5",
				worker: "github-copilot/claude-sonnet-4.6",
				soldier: "github-copilot/claude-sonnet-4.6",
				design: "github-copilot/claude-sonnet-4.6",
				multimodal: "github-copilot/claude-haiku-4.5",
				backend: "github-copilot/claude-sonnet-4.6",
				review: "github-copilot/claude-sonnet-4.6",
			},
		});
	}

	if (profile === "factory-strict-hybrid") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: true,
			autoInjectRoleModels: true,
			requireExplicitRoleModels: true,
			requiredRoles: [
				"scout",
				"worker",
				"soldier",
				"design",
				"multimodal",
				"backend",
				"review",
			],
			enforceFullModelRef: true,
			allowMixedProviders: true,
			allowedProviders: ["github-copilot", "openai-codex"],
			allowedProvidersByRole: {
				queen: ["openai-codex", "github-copilot"],
				scout: ["openai-codex"],
				worker: ["github-copilot"],
				soldier: ["openai-codex"],
				design: ["github-copilot"],
				multimodal: ["openai-codex"],
				backend: ["openai-codex"],
				review: ["github-copilot"],
			},
			roleModels: {
				scout: "openai-codex/gpt-5.4-mini",
				worker: "github-copilot/claude-sonnet-4.6",
				soldier: "openai-codex/gpt-5.2-codex",
				design: "github-copilot/claude-sonnet-4.6",
				multimodal: "openai-codex/gpt-5.4-mini",
				backend: "openai-codex/gpt-5.3-codex",
				review: "github-copilot/claude-sonnet-4.6",
			},
		});
	}

	if (profile === "factory-strict") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: true,
			autoInjectRoleModels: true,
			requireExplicitRoleModels: true,
			requiredRoles: [
				"scout",
				"worker",
				"soldier",
				"design",
				"multimodal",
				"backend",
				"review",
			],
			enforceFullModelRef: true,
			allowMixedProviders: false,
			allowedProviders: ["openai-codex"],
			roleModels: {
				scout: "openai-codex/gpt-5.4-mini",
				worker: "openai-codex/gpt-5.3-codex",
				soldier: "openai-codex/gpt-5.2-codex",
				design: "openai-codex/gpt-5.3-codex",
				multimodal: "openai-codex/gpt-5.4-mini",
				backend: "openai-codex/gpt-5.3-codex",
				review: "openai-codex/gpt-5.2-codex",
			},
		});
	}

	return resolveColonyPilotModelPolicy({
		specializedRolesEnabled: false,
		allowMixedProviders: false,
		allowedProviders: ["openai-codex"],
		roleModels: {
			scout: "openai-codex/gpt-5.4-mini",
			worker: "openai-codex/gpt-5.3-codex",
			soldier: "openai-codex/gpt-5.2-codex",
		},
	});
}

export function buildProjectBaselineSettings(
	profile: BaselineProfile = "default",
) {
	const base = {
		piStack: {
			colonyPilot: {
				preflight: {
					enabled: true,
					enforceOnAntColonyTool: true,
					requiredExecutables: ["node", "git", "npm"],
					requireColonyCapabilities: ["colony", "colonyStop"],
				},
				modelPolicy: {
					enabled: true,
					specializedRolesEnabled: false,
					autoInjectRoleModels: true,
					requireHealthyCurrentModel: true,
					requireExplicitRoleModels: false,
					requiredRoles: ["scout", "worker", "soldier"],
					enforceFullModelRef: true,
					allowMixedProviders: true,
					allowedProviders: [],
					allowedProvidersByRole: {},
					roleModels: {},
					sparkGateEnabled: false,
					sparkAllowedGoalTriggers: ["planning recovery", "scout burst"],
					sparkScoutOnlyTrigger: "scout burst",
				},
				budgetPolicy: {
					enabled: true,
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
				},
				projectTaskSync: {
					enabled: false,
					createOnLaunch: true,
					trackProgress: true,
					markTerminalState: true,
					taskIdPrefix: "colony",
					requireHumanClose: true,
					maxNoteLines: 20,
					autoQueueRecoveryOnCandidate: true,
					recoveryTaskSuffix: "promotion",
				},
				deliveryPolicy: {
					enabled: false,
					mode: "report-only",
					requireWorkspaceReport: true,
					requireTaskSummary: true,
					requireFileInventory: false,
					requireValidationCommandLog: false,
					blockOnMissingEvidence: true,
				},
				candidateRetention: {
					enabled: true,
					maxEntries: 40,
					maxAgeDays: 14,
				},
			},
			webSessionGateway: {
				mode: "local",
				port: 3100,
			},
			schedulerGovernance: {
				enabled: true,
				policy: "observe",
				requireTextConfirmation: true,
				allowEnvOverride: true,
				staleAfterMs: 10000,
			},
			guardrailsCore: {
				portConflict: {
					enabled: true,
					suggestedTestPort: 4173,
				},
			},
		},
	};

	if (profile === "default") return base;

	return deepMergeObjects(base, {
		piStack: {
			colonyPilot: {
				preflight: {
					requiredExecutables: ["node", "git", "npm", "npx"],
					requireColonyCapabilities: [
						"colony",
						"colonyStop",
						"monitors",
						"sessionWeb",
					],
				},
				modelPolicy: {
					requireExplicitRoleModels: true,
					allowMixedProviders: false,
				},
				budgetPolicy: {
					defaultMaxCostUsd: 1,
					hardCapUsd: 10,
					enforceProviderBudgetBlock: true,
				},
				candidateRetention: {
					maxEntries: 24,
					maxAgeDays: 10,
				},
				deliveryPolicy: {
					enabled: true,
					mode: "patch-artifact",
					requireFileInventory: true,
					requireValidationCommandLog: true,
				},
			},
			guardrailsCore: {
				portConflict: {
					suggestedTestPort: 4273,
				},
			},
		},
	});
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeObjects<T extends Record<string, unknown>>(
	base: T,
	patch: Record<string, unknown>,
): T {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (isPlainObject(value) && isPlainObject(out[key])) {
			out[key] = deepMergeObjects(out[key] as Record<string, unknown>, value);
		} else {
			out[key] = value;
		}
	}
	return out as T;
}

export function applyProjectBaselineSettings(
	existing: unknown,
	profile: BaselineProfile = "default",
) {
	const current = isPlainObject(existing) ? { ...existing } : {};

	// Migration safety: older versions wrote custom config under `extensions` (reserved by pi).
	// If that happened, move known keys under `piStack` and restore `extensions` as array.
	const ext = current.extensions;
	if (isPlainObject(ext) && !Array.isArray(ext)) {
		const migrated: Record<string, unknown> = isPlainObject(current.piStack)
			? { ...(current.piStack as Record<string, unknown>) }
			: {};
		for (const key of ["colonyPilot", "webSessionGateway", "guardrailsCore"]) {
			if (key in ext) migrated[key] = (ext as Record<string, unknown>)[key];
		}
		current.piStack = migrated;
		current.extensions = [];
	}

	const baseline = buildProjectBaselineSettings(profile);
	return deepMergeObjects(current, baseline as Record<string, unknown>);
}

function readProjectSettings(cwd: string): Record<string, unknown> {
	const p = path.join(cwd, ".pi", "settings.json");
	if (!existsSync(p)) return {};
	try {
		const raw = JSON.parse(readFileSync(p, "utf8"));
		return isPlainObject(raw) ? raw : {};
	} catch {
		return {};
	}
}

function writeProjectSettings(cwd: string, data: Record<string, unknown>) {
	const dir = path.join(cwd, ".pi");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "settings.json"),
		`${JSON.stringify(data, null, 2)}\n`,
	);
}

export function ensureRecoveryTaskForCandidate(
	cwd: string,
	options: {
		sourceTaskId: string;
		colonyId: string;
		goal?: string;
		deliveryMode: ColonyDeliveryMode;
		issues: string[];
		config: ColonyPilotProjectTaskSyncConfig;
	},
): { taskId: string; changed: boolean } {
	return ensureRecoveryTaskForCandidateInternal(cwd, options);
}

function extractText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const msg = message as { content?: unknown };
	const { content } = msg;

	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as { type?: string; text?: string };
		if (p.type === "text" && typeof p.text === "string") {
			parts.push(p.text);
		}
	}
	return parts.join("\n");
}

function inferMonitorModeFromSessionFile(sessionFile?: string): MonitorMode {
	if (!sessionFile || !existsSync(sessionFile)) return "unknown";
	try {
		const text = readFileSync(sessionFile, "utf8");
		const lines = text.split(/\r?\n/);
		const tail = lines.slice(Math.max(0, lines.length - 1200)).reverse();
		for (const line of tail) {
			const mode = parseMonitorModeFromText(line);
			if (mode) return mode;
		}
	} catch {
		// ignore session parse failures
	}
	return "unknown";
}

export function formatToolJsonOutput(
	label: string,
	data: unknown,
	policy: ColonyPilotOutputPolicyConfig,
): string {
	const pretty = JSON.stringify(data, null, 2);
	if (!policy.compactLargeJson || pretty.length <= policy.maxInlineJsonChars) {
		return pretty;
	}

	const maxPreview = Math.max(200, policy.maxInlineJsonChars - 120);
	const preview = pretty.slice(0, maxPreview).trimEnd();
	return [
		`${label}: output compactado (${pretty.length} chars > ${policy.maxInlineJsonChars})`,
		"preview:",
		preview,
		"...",
		"(payload completo disponível em details)",
	].join("\n");
}

function updateStatusUI(ctx: ExtensionContext | undefined, state: PilotState) {
	ctx?.ui?.setStatus?.("colony-pilot", renderPilotStatus(state));
}

function primeManualRunbook(
	ctx: ExtensionContext,
	title: string,
	steps: string[],
	reason = "Auto-dispatch de slash commands entre extensões não é suportado de forma confiável pela API atual do pi.",
) {
	if (steps.length === 0) return;

	const text = [
		title,
		reason,
		"",
		"Execute na ordem:",
		...steps.map((s) => `  - ${s}`),
		"",
		`Primei o editor com: ${steps[0]}`,
	].join("\n");

	ctx.ui.notify(text, "info");
	ctx.ui.setEditorText?.(steps[0]);
}

function getCapabilities(pi: ExtensionAPI): PilotCapabilities {
	const commands = pi.getCommands().map((c) => c.name);
	return detectPilotCapabilities(commands);
}

function requireCapabilities(
	ctx: ExtensionContext,
	caps: PilotCapabilities,
	required: Array<keyof PilotCapabilities>,
	action: string,
): boolean {
	const missing = missingCapabilities(caps, required);
	if (missing.length === 0) return true;

	const lines = [
		`Não posso preparar \`${action}\` porque faltam comandos no runtime atual:`,
		...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
		"",
		"Sem acoplamento ad hoc: valide a composição da stack e só então rode /reload.",
		"Use /colony-pilot check para diagnóstico rápido.",
	];

	ctx.ui.notify(lines.join("\n"), "warning");
	ctx.ui.setEditorText?.("/colony-pilot check");
	return false;
}

async function tryOpenUrl(pi: ExtensionAPI, url: string): Promise<boolean> {
	try {
		if (process.platform === "win32") {
			const r = await pi.exec("cmd", ["/c", "start", "", url], {
				timeout: 5000,
			});
			return r.code === 0;
		}
		if (process.platform === "darwin") {
			const r = await pi.exec("open", [url], { timeout: 5000 });
			return r.code === 0;
		}

		const r = await pi.exec("xdg-open", [url], { timeout: 5000 });
		return r.code === 0;
	} catch {
		return false;
	}
}

interface ProviderBudgetGateSnapshot {
	lookbackDays: number;
	generatedAtIso: string;
	budgets: ProviderBudgetStatus[];
	allocationWarnings: string[];
}

function formatProviderBudgetStatusLine(status: ProviderBudgetStatus): string {
	const capTokens = status.periodTokensCap
		? Math.round(status.periodTokensCap).toLocaleString("en-US")
		: "n/a";
	const usedPct =
		status.usedPctTokens !== undefined
			? `${status.usedPctTokens.toFixed(1)}%`
			: "n/a";
	return `  - ${status.provider} (${status.period}) used=${Math.round(status.observedTokens).toLocaleString("en-US")} tok (${usedPct}) cap=${capTokens}`;
}

export default function (pi: ExtensionAPI) {
	const state: PilotState = createPilotState();

	let currentCtx: ExtensionContext | undefined;
	let preflightConfig = resolveColonyPilotPreflightConfig();
	let modelPolicyConfig = resolveColonyPilotModelPolicy();
	let budgetPolicyConfig = resolveColonyPilotBudgetPolicy();
	let projectTaskSyncConfig = resolveColonyPilotProjectTaskSync();
	let deliveryPolicyConfig = resolveColonyPilotDeliveryPolicy();
	let outputPolicyConfig = resolveColonyPilotOutputPolicy();
	let candidateRetentionConfig = resolveColonyPilotCandidateRetentionConfig();
	const pendingColonyGoals: Array<{
		goal: string;
		source: "ant_colony" | "manual";
		at: number;
	}> = [];
	const colonyTaskMap = new Map<string, string>();
	const colonyGoalMap = new Map<string, string>();
	let preflightCache:
		| { at: number; result: ColonyPilotPreflightResult }
		| undefined;
	let providerBudgetGateCache:
		| { at: number; key: string; snapshot: ProviderBudgetGateSnapshot }
		| undefined;

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		state.colonies.clear();
		state.remoteActive = false;
		state.remoteUrl = undefined;
		state.remoteClients = 0;
		state.monitorMode = "unknown";
		state.lastSessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
		state.monitorMode = inferMonitorModeFromSessionFile(state.lastSessionFile);
		pendingColonyGoals.splice(0, pendingColonyGoals.length);
		colonyTaskMap.clear();
		colonyGoalMap.clear();

		const settings = parseColonyPilotSettings(ctx.cwd);
		preflightConfig = resolveColonyPilotPreflightConfig(settings.preflight);
		modelPolicyConfig = resolveColonyPilotModelPolicy(settings.modelPolicy);
		budgetPolicyConfig = resolveColonyPilotBudgetPolicy(settings.budgetPolicy);
		projectTaskSyncConfig = resolveColonyPilotProjectTaskSync(
			settings.projectTaskSync,
		);
		deliveryPolicyConfig = resolveColonyPilotDeliveryPolicy(
			settings.deliveryPolicy,
		);
		outputPolicyConfig = resolveColonyPilotOutputPolicy(settings.outputPolicy);
		candidateRetentionConfig = resolveColonyPilotCandidateRetentionConfig(
			settings.candidateRetention,
		);
		preflightCache = undefined;
		providerBudgetGateCache = undefined;

		updateStatusUI(ctx, state);
	});

	pi.on("model_select", (_event, ctx) => {
		updateStatusUI(ctx, state);
	});

	pi.on("turn_start", (_event, ctx) => {
		updateStatusUI(ctx, state);
	});

	function maybeSyncProjectTaskFromTelemetry(
		text: string,
		ctx: ExtensionContext,
	) {
		const signalRaw = parseColonySignal(text);
		if (!signalRaw) return;

		const primaryId = normalizeColonySignalId(signalRaw.id);
		if (!primaryId) return;
		const runtimeColonyId = extractRuntimeColonyId(signalRaw.id);
		const signal = { ...signalRaw, id: primaryId };

		const guessedGoal =
			colonyGoalMap.get(signal.id) ??
			pendingColonyGoals.shift()?.goal ??
			extractColonyGoalFromMessageText(text);

		if (guessedGoal) {
			colonyGoalMap.set(signal.id, guessedGoal);
		}

		const taskIdOverride = colonyTaskMap.get(signal.id);

		let syncResult: { taskId: string } | undefined;
		if (projectTaskSyncConfig.enabled) {
			syncResult = upsertProjectTaskFromColonySignal(ctx.cwd, signal, {
				config: projectTaskSyncConfig,
				goal: guessedGoal,
				taskIdOverride,
				source: "ant_colony",
			});

			if (signal.phase === "completed") {
				const deliveryEval = evaluateColonyDeliveryEvidence(
					text,
					signal.phase,
					deliveryPolicyConfig,
				);
				const requiresPromotion =
					deliveryPolicyConfig.mode !== "apply-to-branch" || !deliveryEval.ok;

				if (
					!deliveryEval.ok &&
					deliveryPolicyConfig.enabled &&
					deliveryPolicyConfig.blockOnMissingEvidence
				) {
					const block = readProjectTasksBlock(ctx.cwd);
					const idx = block.tasks.findIndex((t) => t.id === syncResult.taskId);
					if (idx >= 0) {
						const task = block.tasks[idx]!;
						task.status = "blocked";
						const now = new Date().toISOString();
						task.notes = appendNote(
							task.notes,
							`[${now}] delivery-policy blocked completion: ${deliveryEval.issues.join("; ")}`,
							projectTaskSyncConfig.maxNoteLines,
						);
						writeProjectTasksBlock(ctx.cwd, block);
					}
				}

				if (
					projectTaskSyncConfig.autoQueueRecoveryOnCandidate &&
					requiresPromotion
				) {
					const promotionIssues = deliveryEval.ok
						? [
								`delivery mode '${deliveryPolicyConfig.mode}' requires explicit promotion flow`,
							]
						: deliveryEval.issues;
					const recovery = ensureRecoveryTaskForCandidate(ctx.cwd, {
						sourceTaskId: syncResult.taskId,
						colonyId: signal.id,
						goal: guessedGoal,
						deliveryMode: deliveryPolicyConfig.mode,
						issues: promotionIssues,
						config: projectTaskSyncConfig,
					});

					const block = readProjectTasksBlock(ctx.cwd);
					const idx = block.tasks.findIndex((t) => t.id === syncResult.taskId);
					if (idx >= 0) {
						const task = block.tasks[idx]!;
						const now = new Date().toISOString();
						task.notes = appendNote(
							task.notes,
							`[${now}] promotion queued automatically: ${recovery.taskId}`,
							projectTaskSyncConfig.maxNoteLines,
						);
						writeProjectTasksBlock(ctx.cwd, block);
					}
				}
			}

			colonyTaskMap.set(signal.id, syncResult.taskId);
		}

		const isTerminalSignal =
			signal.phase === "completed" ||
			signal.phase === "failed" ||
			signal.phase === "aborted" ||
			signal.phase === "budget_exceeded";

		if (isTerminalSignal && candidateRetentionConfig.enabled) {
			const deliveryEval =
				signal.phase === "completed"
					? evaluateColonyDeliveryEvidence(
							text,
							signal.phase,
							deliveryPolicyConfig,
						)
					: undefined;
			const mirrors = buildAntColonyMirrorCandidates(ctx.cwd).map((p) => ({
				path: p,
				exists: existsSync(p),
			}));
			const runtimeSnapshot =
				signal.phase === "failed" || signal.phase === "budget_exceeded"
					? captureColonyRuntimeSnapshot(ctx.cwd, {
							colonyId: signal.id,
							runtimeColonyId,
							mirrors,
						})
					: undefined;
			const retention = persistColonyRetentionRecord(
				ctx.cwd,
				{
					colonyId: signal.id,
					phase: signal.phase,
					capturedAtIso: new Date().toISOString(),
					goal: guessedGoal,
					sourceTaskId: syncResult?.taskId ?? taskIdOverride,
					deliveryMode:
						signal.phase === "completed"
							? deliveryPolicyConfig.mode
							: undefined,
					deliveryIssues: deliveryEval?.issues,
					messageExcerpt: text,
					mirrors,
					runtimeColonyId,
					runtimeSnapshotPath: runtimeSnapshot?.snapshotPath,
					runtimeSnapshotTaskCount: runtimeSnapshot?.taskCount,
					runtimeSnapshotMissingReason:
						signal.phase === "failed" || signal.phase === "budget_exceeded"
							? runtimeSnapshot
								? undefined
								: "runtime state not found in mirror roots"
							: undefined,
				},
				{
					maxEntries: candidateRetentionConfig.maxEntries,
					maxAgeDays: candidateRetentionConfig.maxAgeDays,
				},
			);

			if (retention.changed || retention.prune.deleted > 0) {
				pi.appendEntry("colony-pilot.candidate-retention", {
					atIso: new Date().toISOString(),
					colonyId: signal.id,
					runtimeColonyId,
					phase: signal.phase,
					goal: guessedGoal,
					path: retention.path,
					runtimeSnapshotPath: runtimeSnapshot?.relativeSnapshotPath,
					runtimeSnapshotTaskCount: runtimeSnapshot?.taskCount,
					sourceTaskId: syncResult?.taskId ?? taskIdOverride,
					prune: retention.prune,
				});
			}
		}
	}

	async function resolveProviderBudgetGateSnapshot(
		ctx: ExtensionContext,
	): Promise<ProviderBudgetGateSnapshot | undefined> {
		const quotaCfg = parseQuotaVisibilityBudgetSettings(ctx.cwd);
		if (Object.keys(quotaCfg.providerBudgets).length === 0) return undefined;

		const cacheKey = JSON.stringify({
			cwd: ctx.cwd,
			days: budgetPolicyConfig.providerBudgetLookbackDays,
			weeklyQuotaTokens: quotaCfg.weeklyQuotaTokens,
			weeklyQuotaCostUsd: quotaCfg.weeklyQuotaCostUsd,
			weeklyQuotaRequests: quotaCfg.weeklyQuotaRequests,
			monthlyQuotaTokens: quotaCfg.monthlyQuotaTokens,
			monthlyQuotaCostUsd: quotaCfg.monthlyQuotaCostUsd,
			monthlyQuotaRequests: quotaCfg.monthlyQuotaRequests,
			providerBudgets: quotaCfg.providerBudgets,
		});

		if (
			providerBudgetGateCache &&
			providerBudgetGateCache.key === cacheKey &&
			Date.now() - providerBudgetGateCache.at < 30_000
		) {
			return providerBudgetGateCache.snapshot;
		}

		const status = await analyzeQuota({
			days: budgetPolicyConfig.providerBudgetLookbackDays,
			weeklyQuotaTokens: quotaCfg.weeklyQuotaTokens,
			weeklyQuotaCostUsd: quotaCfg.weeklyQuotaCostUsd,
			weeklyQuotaRequests: quotaCfg.weeklyQuotaRequests,
			monthlyQuotaTokens: quotaCfg.monthlyQuotaTokens,
			monthlyQuotaCostUsd: quotaCfg.monthlyQuotaCostUsd,
			monthlyQuotaRequests: quotaCfg.monthlyQuotaRequests,
			providerWindowHours: {},
			providerBudgets: quotaCfg.providerBudgets,
		});

		const snapshot: ProviderBudgetGateSnapshot = {
			lookbackDays: budgetPolicyConfig.providerBudgetLookbackDays,
			generatedAtIso: status.source.generatedAtIso,
			budgets: status.providerBudgets,
			allocationWarnings: status.providerBudgetPolicy.allocationWarnings,
		};

		providerBudgetGateCache = { at: Date.now(), key: cacheKey, snapshot };
		return snapshot;
	}

	pi.on("message_end", (event, ctx) => {
		const text = extractText((event as { message?: unknown }).message);
		if (!text) return;
		if (applyTelemetryText(state, text)) updateStatusUI(ctx, state);
		maybeSyncProjectTaskFromTelemetry(text, ctx);
	});

	pi.on("tool_result", (event, ctx) => {
		const text = extractText(event);
		if (!text) return;
		if (applyTelemetryText(state, text)) updateStatusUI(ctx, state);
		maybeSyncProjectTaskFromTelemetry(text, ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("ant_colony", event)) return undefined;

		const toolInput = event.input as AntColonyToolInput;

		if (preflightConfig.enabled && preflightConfig.enforceOnAntColonyTool) {
			const now = Date.now();
			let result = preflightCache?.result;
			if (!result || now - preflightCache!.at > 30_000) {
				result = await runColonyPilotPreflight(
					pi,
					getCapabilities(pi),
					preflightConfig,
				);
				preflightCache = { at: now, result };
			}

			if (!result.ok) {
				const reason = `Blocked by colony-pilot preflight: ${result.failures.join("; ")}`;
				ctx.ui.notify(
					[
						"ant_colony bloqueada por preflight",
						formatPreflightResult(result),
					].join("\n\n"),
					"warning",
				);
				return { block: true, reason };
			}
		}

		const currentModelRef = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: undefined;
		const goal =
			typeof toolInput.goal === "string" ? toolInput.goal.trim() : "";

		if (modelPolicyConfig.enabled) {
			const evaluation = evaluateAntColonyModelPolicy(
				toolInput,
				currentModelRef,
				ctx.modelRegistry,
				modelPolicyConfig,
				goal,
			);

			if (!evaluation.ok) {
				const reason = `Blocked by colony-pilot model-policy: ${evaluation.issues.join("; ")}`;
				const msg = [
					"ant_colony bloqueada por model-policy",
					...formatPolicyEvaluation(modelPolicyConfig, evaluation),
					"",
					"issues:",
					...evaluation.issues.map((i) => `  - ${i}`),
				].join("\n");
				ctx.ui.notify(msg, "warning");
				return { block: true, reason };
			}
		}

		let budgetEval: ColonyPilotBudgetPolicyEvaluation | undefined;
		if (
			budgetPolicyConfig.enabled &&
			budgetPolicyConfig.enforceOnAntColonyTool
		) {
			budgetEval = evaluateAntColonyBudgetPolicy(toolInput, budgetPolicyConfig);
			if (!budgetEval.ok) {
				const reason = `Blocked by colony-pilot budget-policy: ${budgetEval.issues.join("; ")}`;
				const msg = [
					"ant_colony bloqueada por budget-policy",
					...formatBudgetPolicyEvaluation(budgetPolicyConfig, budgetEval),
					"",
					"issues:",
					...budgetEval.issues.map((i) => `  - ${i}`),
				].join("\n");
				ctx.ui.notify(msg, "warning");
				return { block: true, reason };
			}
		}

		if (
			budgetPolicyConfig.enabled &&
			budgetPolicyConfig.enforceOnAntColonyTool &&
			budgetPolicyConfig.enforceProviderBudgetBlock
		) {
			const snapshot = await resolveProviderBudgetGateSnapshot(ctx);
			const providerGateEval = evaluateProviderBudgetGate(
				toolInput,
				currentModelRef,
				goal,
				snapshot?.budgets ?? [],
				snapshot?.allocationWarnings ?? [],
				budgetPolicyConfig,
			);

			if (!providerGateEval.ok) {
				const blockedRows = (snapshot?.budgets ?? [])
					.filter((b) => providerGateEval.blockedProviders.includes(b.provider))
					.map((b) => formatProviderBudgetStatusLine(b));

				const reason = `Blocked by colony-pilot provider-budget gate: ${providerGateEval.issues.join("; ")}`;
				const msg = [
					"ant_colony bloqueada por provider-budget gate",
					...formatBudgetPolicyEvaluation(
						budgetPolicyConfig,
						budgetEval ??
							evaluateAntColonyBudgetPolicy(toolInput, budgetPolicyConfig),
					),
					`  lookbackDays: ${snapshot?.lookbackDays ?? budgetPolicyConfig.providerBudgetLookbackDays}`,
					`  snapshotAt: ${snapshot?.generatedAtIso ?? "(no data)"}`,
					`  consideredProviders: ${providerGateEval.consideredProviders.join(", ") || "(none)"}`,
					`  blockedProviders: ${providerGateEval.blockedProviders.join(", ") || "(none)"}`,
					...(snapshot?.allocationWarnings?.length
						? [
								"",
								"allocationWarnings:",
								...snapshot.allocationWarnings.map((w) => `  - ${w}`),
							]
						: []),
					...(blockedRows.length
						? ["", "blocked status:", ...blockedRows]
						: []),
					"",
					"Ação:",
					"  - Ajuste budgets/uso no provider",
					`  - Ou use override auditável no goal: '${budgetPolicyConfig.providerBudgetOverrideToken}<motivo>'`,
					"  - Inspecione: /quota-visibility budget <provider> <days>",
				].join("\n");
				ctx.ui.notify(msg, "warning");
				return { block: true, reason };
			}

			if (providerGateEval.overrideReason) {
				const audit = {
					atIso: new Date().toISOString(),
					goal,
					overrideReason: providerGateEval.overrideReason,
					blockedProviders: providerGateEval.blockedProviders,
					consideredProviders: providerGateEval.consideredProviders,
					lookbackDays:
						snapshot?.lookbackDays ??
						budgetPolicyConfig.providerBudgetLookbackDays,
					snapshotAtIso: snapshot?.generatedAtIso,
				};
				pi.appendEntry("colony-pilot.provider-budget-override", audit);
				ctx.ui.notify(
					[
						"provider-budget override aceito (auditado)",
						`reason: ${providerGateEval.overrideReason}`,
						`blockedProviders: ${providerGateEval.blockedProviders.join(", ") || "(none)"}`,
					].join("\n"),
					"warning",
				);
			}
		}

		const deliveryModeOverride = parseDeliveryModeOverride(toolInput);
		const effectiveDeliveryMode =
			deliveryModeOverride ?? deliveryPolicyConfig.mode;

		if (
			deliveryModeOverride &&
			deliveryModeOverride !== deliveryPolicyConfig.mode
		) {
			pi.appendEntry("colony-pilot.delivery-mode-override", {
				atIso: new Date().toISOString(),
				goal,
				overrideMode: deliveryModeOverride,
				configuredMode: deliveryPolicyConfig.mode,
			});
			ctx.ui.notify(
				[
					`delivery-mode override aceito (auditado)`,
					`override: ${deliveryModeOverride}  (config: ${deliveryPolicyConfig.mode})`,
				].join("\n"),
				"info",
			);
		}

		if (
			deliveryPolicyConfig.enabled &&
			goal.length > 0 &&
			requiresApplyToBranch(goal) &&
			effectiveDeliveryMode !== "apply-to-branch"
		) {
			const reason = `Blocked by colony-pilot delivery-policy: goal requires apply-to-branch but mode=${effectiveDeliveryMode}`;
			const msg = [
				"ant_colony bloqueada por delivery-policy",
				"Goal indica materialização/promoção no branch principal,",
				`mas delivery mode efetivo é '${effectiveDeliveryMode}'.`,
				"",
				"Ajuste recomendado:",
				"  - passar deliveryMode='apply-to-branch' diretamente na chamada ant_colony",
				"  - ou definir piStack.colonyPilot.deliveryPolicy.mode = 'apply-to-branch'",
				"  - ou usar /colony-promote <goal>",
			].join("\n");
			ctx.ui.notify(msg, "warning");
			return { block: true, reason };
		}

		if (goal.length > 0) {
			pendingColonyGoals.push({ goal, source: "ant_colony", at: Date.now() });
			while (pendingColonyGoals.length > 20) pendingColonyGoals.shift();
		}

		return undefined;
	});

	pi.registerTool({
		name: "colony_pilot_status",
		label: "Colony Pilot Status",
		description:
			"Mostra o estado atual do pilot: monitores, remote web e colonies em background.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const snapshot = snapshotPilotState(state);
			const retentionSnapshot = readColonyRetentionSnapshot(ctx.cwd, 5);
			const capabilities = getCapabilities(pi);
			const currentModelRef = ctx.model
				? `${ctx.model.provider}/${ctx.model.id}`
				: undefined;
			const modelReadiness = resolveColonyModelReadiness(
				ctx.cwd,
				currentModelRef,
				ctx.modelRegistry,
			);
			const modelPolicyEvaluation = evaluateAntColonyModelPolicy(
				{ goal: "status" },
				currentModelRef,
				ctx.modelRegistry,
				modelPolicyConfig,
			);
			const budgetPolicyEvaluation = evaluateAntColonyBudgetPolicy(
				{ goal: "status" },
				budgetPolicyConfig,
			);
			const deliveryPolicyEvaluation = evaluateColonyDeliveryEvidence(
				"",
				"running",
				deliveryPolicyConfig,
			);
			const payload = {
				...snapshot,
				capabilities,
				modelReadiness,
				modelPolicy: modelPolicyConfig,
				modelPolicyEvaluation,
				budgetPolicy: budgetPolicyConfig,
				budgetPolicyEvaluation,
				providerBudgetGateCache: providerBudgetGateCache
					? {
							at: new Date(providerBudgetGateCache.at).toISOString(),
							lookbackDays: providerBudgetGateCache.snapshot.lookbackDays,
							generatedAtIso: providerBudgetGateCache.snapshot.generatedAtIso,
							blockedProviders: providerBudgetGateCache.snapshot.budgets
								.filter((b) => b.state === "blocked")
								.map((b) => b.provider),
							allocationWarnings:
								providerBudgetGateCache.snapshot.allocationWarnings,
						}
					: undefined,
				projectTaskSync: projectTaskSyncConfig,
				deliveryPolicy: deliveryPolicyConfig,
				deliveryPolicyEvaluation,
				retention: {
					config: candidateRetentionConfig,
					root: retentionSnapshot.root,
					exists: retentionSnapshot.exists,
					count: retentionSnapshot.count,
					records: retentionSnapshot.records.map((entry) => ({
						colonyId: entry.record.colonyId,
						runtimeColonyId: entry.record.runtimeColonyId,
						phase: entry.record.phase,
						updatedAtIso: entry.updatedAtIso,
						path: entry.path,
						runtimeSnapshotPath: entry.record.runtimeSnapshotPath,
						runtimeSnapshotTaskCount:
							entry.record.runtimeSnapshotTaskCount,
						runtimeSnapshotMissingReason:
							entry.record.runtimeSnapshotMissingReason,
						goal: entry.record.goal,
					})),
				},
			};

			return {
				content: [
					{
						type: "text",
						text: formatToolJsonOutput(
							"colony_pilot_status",
							payload,
							outputPolicyConfig,
						),
					},
				],
				details: payload,
			};
		},
	});

	pi.registerTool({
		name: "colony_pilot_artifacts",
		label: "Colony Pilot Artifacts",
		description:
			"Inspect colony runtime artifacts (workspace mirrors, state files, worktrees).",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const data = inspectAntColonyRuntime(ctx.cwd);
			return {
				content: [
					{
						type: "text",
						text: formatToolJsonOutput(
							"colony_pilot_artifacts",
							data,
							outputPolicyConfig,
						),
					},
				],
				details: data,
			};
		},
	});

	pi.registerTool({
		name: "colony_pilot_preflight",
		label: "Colony Pilot Preflight",
		description: "Run hard preflight checks used to gate ant_colony execution.",
		parameters: Type.Object({}),
		async execute() {
			const caps = getCapabilities(pi);
			const result = await runColonyPilotPreflight(pi, caps, preflightConfig);
			preflightCache = { at: Date.now(), result };
			return {
				content: [
					{
						type: "text",
						text: formatToolJsonOutput(
							"colony_pilot_preflight",
							result,
							outputPolicyConfig,
						),
					},
				],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "colony_pilot_baseline",
		label: "Colony Pilot Baseline",
		description:
			"Show or apply project baseline settings for colony/web runtime governance.",
		parameters: Type.Object({
			apply: Type.Optional(Type.Boolean()),
			profile: Type.Optional(Type.String({ description: "default | phase2" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { apply?: boolean; profile?: string };
			const apply = Boolean(p?.apply);
			const profile = resolveBaselineProfile(p?.profile);
			const baseline = buildProjectBaselineSettings(profile);
			if (!apply) {
				return {
					content: [
						{
							type: "text",
							text: formatToolJsonOutput(
								"colony_pilot_baseline",
								{ profile, baseline },
								outputPolicyConfig,
							),
						},
					],
					details: { profile, baseline },
				};
			}

			const merged = applyProjectBaselineSettings(
				readProjectSettings(ctx.cwd),
				profile,
			);
			writeProjectSettings(ctx.cwd, merged);
			return {
				content: [
					{
						type: "text",
						text: `Applied project baseline (${profile}) to .pi/settings.json`,
					},
				],
				details: {
					applied: true,
					profile,
					path: path.join(ctx.cwd, ".pi", "settings.json"),
				},
			};
		},
	});

	pi.registerCommand("colony-pilot", {
		description:
			"Orquestra pilot de colony + web inspect + profile de monitores (run/status/stop/web).",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			const input = (args ?? "").trim();
			const { cmd, body } = parseCommandInput(input);
			const caps = getCapabilities(pi);

			if (!cmd || cmd === "help") {
				ctx.ui.notify(
					[
						"Usage: /colony-pilot <command>",
						"",
						"Commands:",
						"  prep                          Mostrar plano recomendado do pilot",
						"  run <goal>                    Prepara sequência manual: /monitors off -> /remote -> /colony <goal> (sem maxCost no /colony)",
						"  stop [--restore-monitors]     Prepara sequência manual: /colony-stop all -> /remote stop [-> /monitors on]",
						"  monitors <on|off>             Prepara comando de profile de monitores",
						"  web <start|stop|open|status>  Controla/inspeciona sessão web",
						"  tui                           Mostra como entrar/retomar sessão no TUI",
						"  status                        Snapshot consolidado",
						"  check                         Diagnóstico de capacidades + readiness de provider/model/budget para ant_colony",
						"  hatch [check|doctor|apply] [default|phase2]  Onboarding guiado para deixar runtime pronto para swarm",
						"  models <status|template|apply> [copilot|codex|hybrid|factory-strict|factory-strict-copilot|factory-strict-hybrid]  Política granular de modelos por classe",
						"  preflight                     Executa gates duros (capabilities + executáveis) antes da colony",
						"  baseline [show|apply] [default|phase2]  Baseline de .pi/settings.json (phase2 = mais estrito)",
						"  artifacts                     Mostra onde colony guarda states/worktrees para recovery",
						"",
						"Nota: o pi não expõe API confiável para uma extensão invocar slash commands de outra",
						"extensão no mesmo runtime. O pilot prepara e guia execução manual assistida.",
					].join("\n"),
					"info",
				);
				return;
			}

			if (cmd === "prep") {
				const base = ["/monitors off", "/remote", "/colony <goal>"];
				primeManualRunbook(
					ctx,
					"Pilot direction:",
					base,
					[
						"- colony run com monitores gerais OFF",
						"- governança principal: mecanismos da colony (inclui soldier)",
						"- inspeção ativa por web remote + TUI status",
						"",
						"Auto-dispatch foi desativado por confiabilidade da API de comandos entre extensões.",
					].join("\n"),
				);
				return;
			}

			if (cmd === "check") {
				const missing = missingCapabilities(caps, [
					"monitors",
					"sessionWeb",
					"remote",
					"colony",
					"colonyStop",
				]);
				const currentModelRef = ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: undefined;
				const readiness = resolveColonyModelReadiness(
					ctx.cwd,
					currentModelRef,
					ctx.modelRegistry,
				);
				const policyEval = evaluateAntColonyModelPolicy(
					{ goal: "check" },
					currentModelRef,
					ctx.modelRegistry,
					modelPolicyConfig,
				);
				const budgetEval = evaluateAntColonyBudgetPolicy(
					{ goal: "check" },
					budgetPolicyConfig,
				);
				const deliveryEval = evaluateColonyDeliveryEvidence(
					"",
					"running",
					deliveryPolicyConfig,
				);

				const lines = [
					"colony-pilot capabilities",
					`  monitors: ${caps.monitors ? "ok" : "missing"}`,
					`  session-web: ${caps.sessionWeb ? "ok" : "missing"}`,
					`  remote: ${caps.remote ? "ok" : "missing"}`,
					`  colony: ${caps.colony ? "ok" : "missing"}`,
					`  colony-stop: ${caps.colonyStop ? "ok" : "missing"}`,
					"",
					...formatModelReadiness(readiness),
					"",
					...formatPolicyEvaluation(modelPolicyConfig, policyEval),
					"",
					...formatBudgetPolicyEvaluation(budgetPolicyConfig, budgetEval),
					"",
					...formatDeliveryPolicyEvaluation(deliveryPolicyConfig, deliveryEval),
					"",
					"project-task-sync:",
					`  enabled: ${projectTaskSyncConfig.enabled ? "yes" : "no"}`,
					`  createOnLaunch: ${projectTaskSyncConfig.createOnLaunch ? "yes" : "no"}`,
					`  trackProgress: ${projectTaskSyncConfig.trackProgress ? "yes" : "no"}`,
					`  markTerminalState: ${projectTaskSyncConfig.markTerminalState ? "yes" : "no"}`,
					`  requireHumanClose: ${projectTaskSyncConfig.requireHumanClose ? "yes" : "no"}`,
					`  taskIdPrefix: ${projectTaskSyncConfig.taskIdPrefix}`,
					`  autoQueueRecoveryOnCandidate: ${projectTaskSyncConfig.autoQueueRecoveryOnCandidate ? "yes" : "no"}`,
					`  recoveryTaskSuffix: ${projectTaskSyncConfig.recoveryTaskSuffix}`,
					"candidate-retention:",
					`  enabled: ${candidateRetentionConfig.enabled ? "yes" : "no"}`,
					`  maxEntries: ${candidateRetentionConfig.maxEntries}`,
					`  maxAgeDays: ${candidateRetentionConfig.maxAgeDays}`,
				];

				if (missing.length > 0) {
					lines.push(
						"",
						"Gaps detectados:",
						...missing.map((m) => `  - ${capabilityGuidance(m)}`),
					);
				}

				const modelIssues: string[] = [];
				if (
					readiness.currentModelStatus !== "ok" &&
					readiness.currentModelStatus !== "unavailable"
				) {
					modelIssues.push(
						"Current session model cannot run ant_colony defaults reliably.",
					);
				}
				if (
					readiness.defaultModelStatus !== "ok" &&
					readiness.defaultModelStatus !== "not-set" &&
					readiness.defaultModelStatus !== "unavailable"
				) {
					modelIssues.push(
						"defaultProvider/defaultModel appears misconfigured or unauthenticated.",
					);
				}
				if (policyEval.issues.length > 0) {
					modelIssues.push(...policyEval.issues);
				}
				if (budgetPolicyConfig.enabled && budgetEval.issues.length > 0) {
					modelIssues.push(...budgetEval.issues);
				}

				if (modelIssues.length > 0) {
					lines.push(
						"",
						"Provider/model issues:",
						...modelIssues.map((m) => `  - ${m}`),
					);
					lines.push(
						"  - Use /model and/or configure piStack.colonyPilot.modelPolicy/budgetPolicy.",
					);
				}

				const warn = missing.length > 0 || modelIssues.length > 0;
				ctx.ui.notify(lines.join("\n"), warn ? "warning" : "info");
				return;
			}

			if (cmd === "hatch") {
				const tokens = body
					.split(/\s+/)
					.map((t) => t.trim())
					.filter(Boolean);
				const action = (tokens[0] ?? "check").toLowerCase();
				const profile = resolveBaselineProfile(tokens[1] ?? "default");

				if (action === "doctor") {
					ctx.ui.notify(
						[
							"hatch doctor foi centralizado no doctor canônico.",
							"Use: /doctor hatch",
						].join("\n"),
						"info",
					);
					ctx.ui.setEditorText?.("/doctor hatch");
					return;
				}

				if (action === "apply") {
					const existing = readProjectSettings(ctx.cwd);
					const merged = applyProjectBaselineSettings(existing, profile);
					writeProjectSettings(ctx.cwd, merged as Record<string, unknown>);

					const settings = parseColonyPilotSettings(ctx.cwd);
					preflightConfig = resolveColonyPilotPreflightConfig(
						settings.preflight,
					);
					modelPolicyConfig = resolveColonyPilotModelPolicy(
						settings.modelPolicy,
					);
					budgetPolicyConfig = resolveColonyPilotBudgetPolicy(
						settings.budgetPolicy,
					);
					projectTaskSyncConfig = resolveColonyPilotProjectTaskSync(
						settings.projectTaskSync,
					);
					deliveryPolicyConfig = resolveColonyPilotDeliveryPolicy(
						settings.deliveryPolicy,
					);
					preflightCache = undefined;
					providerBudgetGateCache = undefined;

					ctx.ui.notify(
						[
							`hatch apply: baseline '${profile}' aplicado em .pi/settings.json`,
							"",
							"Próximos passos (ordem recomendada):",
							"  1) /reload",
							"  2) /monitor-provider apply",
							"  3) /colony-pilot hatch check",
							"  4) /quota-visibility budget 30",
							'  5) /colony-pilot run "<goal>"',
						].join("\n"),
						"info",
					);
					ctx.ui.setEditorText?.("/reload");
					return;
				}

				if (action !== "check") {
					ctx.ui.notify(
						"Usage: /colony-pilot hatch [check|doctor|apply] [default|phase2]",
						"warning",
					);
					return;
				}

				const missing = missingCapabilities(caps, [
					"monitors",
					"colony",
					"colonyStop",
				]);
				const preflight = await runColonyPilotPreflight(
					pi,
					caps,
					preflightConfig,
				);
				preflightCache = { at: Date.now(), result: preflight };

				const currentModelRef = ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: undefined;
				const modelEval = evaluateAntColonyModelPolicy(
					{ goal: "hatch-check" },
					currentModelRef,
					ctx.modelRegistry,
					modelPolicyConfig,
				);
				const budgetEval = evaluateAntColonyBudgetPolicy(
					{ goal: "hatch-check" },
					budgetPolicyConfig,
				);
				const quotaCfg = parseQuotaVisibilityBudgetSettings(ctx.cwd);

				const readiness = evaluateHatchReadiness({
					capabilitiesMissing: missing,
					preflightOk: preflight.ok,
					modelPolicyOk: modelEval.ok,
					budgetPolicyOk: budgetEval.ok,
					budgetPolicy: budgetPolicyConfig,
					providerBudgetsConfigured: Object.keys(quotaCfg.providerBudgets)
						.length,
				});

				const lines = [
					"colony-pilot hatch",
					...formatHatchReadiness(readiness),
					"",
					"rotina mínima de uso:",
					"  - /monitors off",
					"  - /colony <goal>  (ou ant_colony com maxCost)",
					"  - /colony-pilot status",
					"  - /quota-visibility budget 30",
					"  - /colony-pilot stop --restore-monitors",
				];

				if (!readiness.ready) {
					lines.push("", "ação sugerida: /colony-pilot hatch apply default");
				}

				ctx.ui.notify(lines.join("\n"), readiness.ready ? "info" : "warning");
				return;
			}

			if (cmd === "status") {
				const currentModelRef = ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: undefined;
				const readiness = resolveColonyModelReadiness(
					ctx.cwd,
					currentModelRef,
					ctx.modelRegistry,
				);
				const policyEval = evaluateAntColonyModelPolicy(
					{ goal: "status" },
					currentModelRef,
					ctx.modelRegistry,
					modelPolicyConfig,
				);
				const budgetEval = evaluateAntColonyBudgetPolicy(
					{ goal: "status" },
					budgetPolicyConfig,
				);
				const deliveryEval = evaluateColonyDeliveryEvidence(
					"",
					"running",
					deliveryPolicyConfig,
				);
				const lines = [
					formatPilotSnapshot(state),
					"",
					"capabilities:",
					`  monitors=${caps.monitors ? "ok" : "missing"}`,
					`  session-web=${caps.sessionWeb ? "ok" : "missing"}`,
					`  remote=${caps.remote ? "ok" : "missing"}`,
					`  colony=${caps.colony ? "ok" : "missing"}`,
					`  colony-stop=${caps.colonyStop ? "ok" : "missing"}`,
					"",
					...formatModelReadiness(readiness),
					"",
					...formatPolicyEvaluation(modelPolicyConfig, policyEval),
					"",
					...formatBudgetPolicyEvaluation(budgetPolicyConfig, budgetEval),
					"",
					...formatDeliveryPolicyEvaluation(deliveryPolicyConfig, deliveryEval),
					"",
					"project-task-sync:",
					`  enabled: ${projectTaskSyncConfig.enabled ? "yes" : "no"}`,
					`  taskIdPrefix: ${projectTaskSyncConfig.taskIdPrefix}`,
					`  requireHumanClose: ${projectTaskSyncConfig.requireHumanClose ? "yes" : "no"}`,
					`  autoQueueRecoveryOnCandidate: ${projectTaskSyncConfig.autoQueueRecoveryOnCandidate ? "yes" : "no"}`,
					`  recoveryTaskSuffix: ${projectTaskSyncConfig.recoveryTaskSuffix}`,
					"candidate-retention:",
					`  enabled: ${candidateRetentionConfig.enabled ? "yes" : "no"}`,
					`  maxEntries: ${candidateRetentionConfig.maxEntries}`,
					`  maxAgeDays: ${candidateRetentionConfig.maxAgeDays}`,
				];
				const warn =
					!policyEval.ok || (budgetPolicyConfig.enabled && !budgetEval.ok);
				ctx.ui.notify(lines.join("\n"), warn ? "warning" : "info");
				return;
			}

			if (cmd === "models") {
				const parsed = parseCommandInput(body);
				const action = parsed.cmd || "status";
				const profile = resolveModelPolicyProfile(
					parseCommandInput(parsed.body).cmd || parsed.body || "codex",
				);

				if (action === "status") {
					const currentModelRef = ctx.model
						? `${ctx.model.provider}/${ctx.model.id}`
						: undefined;
					const evalResult = evaluateAntColonyModelPolicy(
						{ goal: "models-status" },
						currentModelRef,
						ctx.modelRegistry,
						modelPolicyConfig,
					);

					const lines = [
						"colony-pilot model policy status",
						...formatPolicyEvaluation(modelPolicyConfig, evalResult),
						...(evalResult.issues.length > 0
							? ["", "issues:", ...evalResult.issues.map((i) => `  - ${i}`)]
							: ["", "issues: (none)"]),
					];

					ctx.ui.notify(lines.join("\n"), evalResult.ok ? "info" : "warning");
					return;
				}

				if (action === "template") {
					const template = buildModelPolicyProfile(profile);
					ctx.ui.notify(
						[
							`colony-pilot model policy template (${profile})`,
							"",
							JSON.stringify(
								{ piStack: { colonyPilot: { modelPolicy: template } } },
								null,
								2,
							),
							"",
							"Para aplicar automaticamente:",
							`  /colony-pilot models apply ${profile}`,
						].join("\n"),
						"info",
					);
					return;
				}

				if (action === "apply") {
					const settings = readProjectSettings(ctx.cwd);
					const merged = deepMergeObjects(settings, {
						piStack: {
							colonyPilot: { modelPolicy: buildModelPolicyProfile(profile) },
						},
					});
					writeProjectSettings(ctx.cwd, merged);
					const currentModelRef = ctx.model
						? `${ctx.model.provider}/${ctx.model.id}`
						: undefined;
					modelPolicyConfig = resolveColonyPilotModelPolicy(
						buildModelPolicyProfile(profile),
					);
					const evalResult = evaluateAntColonyModelPolicy(
						{ goal: "models-apply" },
						currentModelRef,
						ctx.modelRegistry,
						modelPolicyConfig,
					);

					ctx.ui.notify(
						[
							`Model policy (${profile}) aplicada em .pi/settings.json`,
							"Recomendado: /reload",
							"",
							...formatPolicyEvaluation(modelPolicyConfig, evalResult),
						].join("\n"),
						evalResult.ok ? "info" : "warning",
					);
					ctx.ui.setEditorText?.("/reload");
					return;
				}

				ctx.ui.notify(
					"Usage: /colony-pilot models <status|template|apply> [copilot|codex|hybrid|factory-strict|factory-strict-copilot|factory-strict-hybrid]",
					"warning",
				);
				return;
			}

			if (cmd === "preflight") {
				const result = await runColonyPilotPreflight(pi, caps, preflightConfig);
				preflightCache = { at: Date.now(), result };
				ctx.ui.notify(
					formatPreflightResult(result),
					result.ok ? "info" : "warning",
				);
				return;
			}

			if (cmd === "baseline") {
				const parsed = parseCommandInput(body);
				const maybeAction = parsed.cmd || "show";
				const isProfileOnly =
					maybeAction === "default" || maybeAction === "phase2";
				const act = isProfileOnly ? "show" : maybeAction;
				const profileSource = isProfileOnly
					? maybeAction
					: parseCommandInput(parsed.body).cmd || parsed.body || "default";
				const profile = resolveBaselineProfile(profileSource);

				if (act === "show") {
					const baseline = buildProjectBaselineSettings(profile);
					ctx.ui.notify(
						[
							`colony-pilot project baseline (${profile}) (.pi/settings.json)`,
							"",
							JSON.stringify(baseline, null, 2),
							"",
							"Para aplicar automaticamente:",
							`  /colony-pilot baseline apply ${profile}`,
						].join("\n"),
						"info",
					);
					return;
				}

				if (act === "apply") {
					const merged = applyProjectBaselineSettings(
						readProjectSettings(ctx.cwd),
						profile,
					);
					writeProjectSettings(ctx.cwd, merged);
					ctx.ui.notify(
						[
							`Baseline (${profile}) aplicada em .pi/settings.json`,
							"Recomendado: /reload",
						].join("\n"),
						"info",
					);
					ctx.ui.setEditorText?.("/reload");
					return;
				}

				ctx.ui.notify(
					"Usage: /colony-pilot baseline [show|apply] [default|phase2]",
					"warning",
				);
				return;
			}

			if (cmd === "artifacts") {
				const data = inspectAntColonyRuntime(ctx.cwd);
				ctx.ui.notify(formatArtifactsReport(data), "info");
				return;
			}

			if (cmd === "run") {
				const goal = normalizeQuotedText(body);
				if (!goal) {
					ctx.ui.notify("Usage: /colony-pilot run <goal>", "warning");
					return;
				}

				if (
					!caps.monitors ||
					!caps.colony ||
					(!caps.remote && !caps.sessionWeb)
				) {
					const missing: Array<keyof PilotCapabilities> = [];
					if (!caps.monitors) missing.push("monitors");
					if (!caps.colony) missing.push("colony");
					if (!caps.remote && !caps.sessionWeb)
						missing.push("sessionWeb", "remote");
					const lines = [
						"Não posso preparar `run` porque faltam comandos no runtime atual:",
						...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
						"",
						"Use /colony-pilot check para diagnóstico rápido.",
					];
					ctx.ui.notify(lines.join("\n"), "warning");
					return;
				}

				const preflight = await runColonyPilotPreflight(
					pi,
					caps,
					preflightConfig,
				);
				preflightCache = { at: Date.now(), result: preflight };
				if (!preflight.ok) {
					ctx.ui.notify(
						[
							"Run bloqueado por preflight.",
							formatPreflightResult(preflight),
							"",
							"Resolva os itens e rode /colony-pilot preflight novamente.",
						].join("\n"),
						"warning",
					);
					ctx.ui.setEditorText?.("/colony-pilot preflight");
					return;
				}

				const sequence = buildRuntimeRunSequence(caps, goal);
				state.monitorMode = "off";
				updateStatusUI(ctx, state);

				pendingColonyGoals.push({ goal, source: "manual", at: Date.now() });
				while (pendingColonyGoals.length > 20) pendingColonyGoals.shift();

				const reason =
					budgetPolicyConfig.enabled && budgetPolicyConfig.requireMaxCost
						? [
								"Auto-dispatch de slash commands entre extensões não é suportado de forma confiável pela API atual do pi.",
								"",
								"Aviso de budget: /colony não aceita maxCost via CLI atualmente.",
								"Se precisar hard-cap de custo, prefira execução via tool ant_colony com { goal, maxCost }.",
							].join("\n")
						: undefined;

				primeManualRunbook(
					ctx,
					"Pilot run pronto (manual assistido)",
					sequence,
					reason,
				);
				return;
			}

			if (cmd === "stop") {
				const restore = body.includes("--restore-monitors");
				if (
					!caps.colonyStop ||
					(!caps.remote && !caps.sessionWeb) ||
					(restore && !caps.monitors)
				) {
					const missing: Array<keyof PilotCapabilities> = [];
					if (!caps.colonyStop) missing.push("colonyStop");
					if (!caps.remote && !caps.sessionWeb)
						missing.push("sessionWeb", "remote");
					if (restore && !caps.monitors) missing.push("monitors");

					const lines = [
						"Não posso preparar `stop` porque faltam comandos no runtime atual:",
						...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
						"",
						"Use /colony-pilot check para diagnóstico rápido.",
					];
					ctx.ui.notify(lines.join("\n"), "warning");
					return;
				}

				const sequence = buildRuntimeStopSequence(caps, {
					restoreMonitors: restore,
				});
				if (restore) state.monitorMode = "on";
				updateStatusUI(ctx, state);

				primeManualRunbook(
					ctx,
					"Pilot stop pronto (manual assistido)",
					sequence,
				);
				return;
			}

			if (cmd === "monitors") {
				const mode = normalizeQuotedText(body).split(/\s+/)[0];
				if (mode !== "on" && mode !== "off") {
					ctx.ui.notify("Usage: /colony-pilot monitors <on|off>", "warning");
					return;
				}

				if (!requireCapabilities(ctx, caps, ["monitors"], "monitors")) {
					return;
				}

				state.monitorMode = mode;
				updateStatusUI(ctx, state);
				primeManualRunbook(
					ctx,
					`Profile de monitores (${mode.toUpperCase()}) pronto`,
					[`/monitors ${mode}`],
					"Execute o comando abaixo para aplicar no runtime atual.",
				);
				return;
			}

			if (cmd === "web") {
				const { cmd: actionCmd } = parseCommandInput(body);
				const action = actionCmd || "status";

				if (action === "start") {
					if (!caps.remote && !caps.sessionWeb) {
						const lines = [
							"Não posso preparar `web start` porque faltam comandos de web no runtime:",
							`  - sessionWeb: ${capabilityGuidance("sessionWeb")}`,
							`  - remote: ${capabilityGuidance("remote")}`,
						];
						ctx.ui.notify(lines.join("\n"), "warning");
						return;
					}

					const cmd = caps.sessionWeb ? "/session-web start" : "/remote";
					primeManualRunbook(
						ctx,
						"Start do web session pronto",
						[cmd],
						"Execute o comando abaixo para iniciar o servidor web da sessão.",
					);
					return;
				}

				if (action === "stop") {
					if (!caps.remote && !caps.sessionWeb) {
						const lines = [
							"Não posso preparar `web stop` porque faltam comandos de web no runtime:",
							`  - sessionWeb: ${capabilityGuidance("sessionWeb")}`,
							`  - remote: ${capabilityGuidance("remote")}`,
						];
						ctx.ui.notify(lines.join("\n"), "warning");
						return;
					}

					state.remoteActive = false;
					state.remoteClients = 0;
					updateStatusUI(ctx, state);
					const cmd = caps.sessionWeb ? "/session-web stop" : "/remote stop";
					primeManualRunbook(
						ctx,
						"Stop do web session pronto",
						[cmd],
						"Execute o comando abaixo para encerrar o servidor web da sessão.",
					);
					return;
				}

				if (action === "open") {
					if (!state.remoteUrl) {
						ctx.ui.notify(
							"Nenhuma URL remote detectada ainda. Rode /colony-pilot web start e depois /colony-pilot status.",
							"warning",
						);
						return;
					}

					const ok = await tryOpenUrl(pi, state.remoteUrl);
					if (ok) {
						ctx.ui.notify(`Abrindo browser: ${state.remoteUrl}`, "info");
					} else {
						ctx.ui.notify(
							`Nao consegui abrir automaticamente. URL: ${state.remoteUrl}`,
							"warning",
						);
					}
					return;
				}

				if (action === "status") {
					const lines = [
						`remote: ${state.remoteActive ? "active" : "inactive"}`,
						`clients: ${state.remoteClients ?? 0}`,
						`url: ${state.remoteUrl ?? "(none)"}`,
					];
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}

				ctx.ui.notify(
					"Usage: /colony-pilot web <start|stop|open|status>",
					"warning",
				);
				return;
			}

			if (cmd === "tui") {
				ctx.ui.notify(
					[
						"TUI session access:",
						"- Nesta instância você já está na sessão ativa.",
						"- Em outro terminal, abra `pi` e use `/resume` para entrar nesta sessão.",
						`- Session file atual: ${state.lastSessionFile ?? "(ephemeral / sem arquivo)"}`,
					].join("\n"),
					"info",
				);
				return;
			}

			ctx.ui.notify(
				`Comando desconhecido: ${cmd}. Use /colony-pilot help`,
				"warning",
			);
		},
	});

	// ---- command: /colony-promote ------------------------------------------

	pi.registerCommand("colony-promote", {
		description: [
			"Convenience shortcut: pre-fills ant_colony call with deliveryMode='apply-to-branch'.",
			"Usage: /colony-promote <goal>",
			"This sets the per-call delivery mode override so the goal passes the delivery-policy gate",
			"without requiring a global settings change. The override is audited in the session log.",
		].join(" "),
		handler: async (args, ctx) => {
			const goal = (args ?? "").trim();
			if (!goal) {
				ctx.ui.notify(
					[
						"colony-promote: nenhum goal fornecido.",
						"Usage: /colony-promote <goal>",
						"",
						"Este comando prepara uma chamada ant_colony com deliveryMode='apply-to-branch'",
						"permitindo materialização/promoção sem editar a configuração global.",
					].join("\n"),
					"warning",
				);
				return;
			}

			const hint = [
				"colony-promote: promote goal pronto para confirmação.",
				"",
				`goal: ${goal}`,
				`deliveryMode: apply-to-branch (override per-call — auditado)`,
				"",
				"Execute a chamada abaixo (confirme antes de rodar):",
				`  ant_colony({ "goal": ${JSON.stringify(goal)}, "deliveryMode": "apply-to-branch" })`,
			].join("\n");

			ctx.ui.notify(hint, "info");
		},
	});

	pi.on("session_shutdown", () => {
		updateStatusUI(currentCtx, {
			...state,
			monitorMode: "unknown",
			remoteActive: false,
			colonies: new Map(),
		});
	});
}
