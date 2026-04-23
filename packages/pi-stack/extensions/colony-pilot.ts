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

import { existsSync } from "node:fs";
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
	DEFAULT_COLONY_PILOT_DELIVERY_POLICY,
	evaluateColonyDeliveryEvidence as evaluateColonyDeliveryEvidenceImpl,
	evaluateSelectivePromotionInventoryEvidence as evaluateSelectivePromotionInventoryEvidenceImpl,
	formatDeliveryPolicyEvaluation as formatDeliveryPolicyEvaluationImpl,
	parseDeliveryModeOverride as parseDeliveryModeOverrideImpl,
	resolveColonyPilotDeliveryPolicy as resolveColonyPilotDeliveryPolicyImpl,
} from "./colony-pilot-delivery-policy";
import {
	formatArtifactsReport as formatArtifactsReportImpl,
	inspectAntColonyRuntime as inspectAntColonyRuntimeImpl,
} from "./colony-pilot-artifacts";
import {
	getCapabilities as getCapabilitiesImpl,
	primeManualRunbook as primeManualRunbookImpl,
	requireCapabilities as requireCapabilitiesImpl,
	tryOpenUrl as tryOpenUrlImpl,
	updateStatusUI as updateStatusUIImpl,
} from "./colony-pilot-command-surface";
import {
	applyProjectBaselineSettings as applyProjectBaselineSettingsImpl,
	buildProjectBaselineSettings as buildProjectBaselineSettingsImpl,
	deepMergeObjects as deepMergeObjectsImpl,
	resolveBaselineProfile as resolveBaselineProfileImpl,
} from "./colony-pilot-baseline";
import {
	collectAntColonyProviders as collectAntColonyProvidersImpl,
	evaluateAntColonyBudgetPolicy as evaluateAntColonyBudgetPolicyImpl,
	evaluateProviderBudgetGate as evaluateProviderBudgetGateImpl,
	formatBudgetPolicyEvaluation as formatBudgetPolicyEvaluationImpl,
	parseBudgetOverrideReason as parseBudgetOverrideReasonImpl,
} from "./colony-pilot-budget-policy";
import {
	buildModelPolicyProfile as buildModelPolicyProfileImpl,
	evaluateAntColonyModelPolicy as evaluateAntColonyModelPolicyImpl,
	formatPolicyEvaluation as formatPolicyEvaluationImpl,
	resolveColonyPilotModelPolicy as resolveColonyPilotModelPolicyImpl,
	resolveModelPolicyProfile as resolveModelPolicyProfileImpl,
} from "./colony-pilot-model-policy";
import {
	formatToolJsonOutput as formatToolJsonOutputImpl,
	resolveColonyPilotCandidateRetentionConfig as resolveColonyPilotCandidateRetentionConfigImpl,
	resolveColonyPilotOutputPolicy as resolveColonyPilotOutputPolicyImpl,
} from "./colony-pilot-output-policy";
import {
	type QuotaVisibilityBudgetSettings,
	parseColonyPilotSettings as parseColonyPilotSettingsImpl,
	parseQuotaVisibilityBudgetSettings as parseQuotaVisibilityBudgetSettingsImpl,
	readProjectSettings as readProjectSettingsImpl,
	writeProjectSettings as writeProjectSettingsImpl,
} from "./colony-pilot-settings";
import {
	formatProviderBudgetStatusLine as formatProviderBudgetStatusLineImpl,
	type ProviderBudgetGateCacheEntry,
	type ProviderBudgetGateSnapshot,
	resolveProviderBudgetGateSnapshot as resolveProviderBudgetGateSnapshotImpl,
} from "./colony-pilot-provider-budget-gate";
import {
	extractText as extractTextImpl,
	inferMonitorModeFromSessionFile as inferMonitorModeFromSessionFileImpl,
} from "./colony-pilot-session-utils";
import { type ProviderBudgetStatus } from "./quota-visibility";

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
	...DEFAULT_COLONY_PILOT_DELIVERY_POLICY,
};

export interface ColonyPilotOutputPolicyConfig {
	compactLargeJson: boolean;
	maxInlineJsonChars: number;
}

export interface ColonyPilotCandidateRetentionConfig {
	enabled: boolean;
	maxEntries: number;
	maxAgeDays: number;
}

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
export const parseDeliveryModeOverride = parseDeliveryModeOverrideImpl;

function extractRuntimeColonyId(signalId: string): string | undefined {
	const raw = signalId.split("|")[1]?.trim();
	if (!raw) return undefined;
	if (raw.includes("${") || raw.includes("}")) return undefined;
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw)) return undefined;
	return raw;
}

export const resolveColonyPilotModelPolicy =
	resolveColonyPilotModelPolicyImpl;

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

export const resolveColonyPilotDeliveryPolicy =
	resolveColonyPilotDeliveryPolicyImpl;

export interface SelectivePromotionInventoryEvidence {
	hasPromotedFileInventory: boolean;
	hasSkippedFileInventory: boolean;
	hasSelectivePromotionInventory: boolean;
}

export const evaluateSelectivePromotionInventoryEvidence =
	evaluateSelectivePromotionInventoryEvidenceImpl;

export const evaluateColonyDeliveryEvidence =
	evaluateColonyDeliveryEvidenceImpl;

export const formatDeliveryPolicyEvaluation =
	formatDeliveryPolicyEvaluationImpl;

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

export const parseBudgetOverrideReason = parseBudgetOverrideReasonImpl;

export const collectAntColonyProviders = collectAntColonyProvidersImpl;

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
	return evaluateProviderBudgetGateImpl(
		input,
		currentModelRef,
		goal,
		statuses,
		allocationWarnings,
		policy,
	);
}

export function evaluateAntColonyBudgetPolicy(
	input: AntColonyToolInput,
	policy: ColonyPilotBudgetPolicyConfig,
): ColonyPilotBudgetPolicyEvaluation {
	return evaluateAntColonyBudgetPolicyImpl(input, policy);
}


export interface ColonyModelPolicyEvaluation {
	ok: boolean;
	issues: string[];
	effectiveModels: Record<ColonyAgentRole, string | undefined>;
}

export function evaluateAntColonyModelPolicy(
	input: AntColonyToolInput,
	currentModelRef: string | undefined,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	modelRegistry: any,
	policy: ColonyPilotModelPolicyConfig,
	goal?: string,
): ColonyModelPolicyEvaluation {
	return evaluateAntColonyModelPolicyImpl(
		input,
		currentModelRef,
		modelRegistry,
		policy,
		goal,
	);
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
	hasPromotedFileInventory: boolean;
	hasSkippedFileInventory: boolean;
	hasSelectivePromotionInventory: boolean;
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


export const resolveColonyPilotOutputPolicy =
	resolveColonyPilotOutputPolicyImpl;

export const resolveColonyPilotCandidateRetentionConfig =
	resolveColonyPilotCandidateRetentionConfigImpl;
export type BaselineProfile = "default" | "phase2";
export type ModelPolicyProfile =
	| "copilot"
	| "codex"
	| "hybrid"
	| "factory-strict"
	| "factory-strict-copilot"
	| "factory-strict-hybrid";

export const resolveBaselineProfile = resolveBaselineProfileImpl;

export const resolveModelPolicyProfile = resolveModelPolicyProfileImpl;

export const buildModelPolicyProfile = buildModelPolicyProfileImpl;

export const buildProjectBaselineSettings = buildProjectBaselineSettingsImpl;

export function deepMergeObjects<T extends Record<string, unknown>>(
	base: T,
	patch: Record<string, unknown>,
): T {
	return deepMergeObjectsImpl(base, patch);
}

export const applyProjectBaselineSettings = applyProjectBaselineSettingsImpl;


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

export const formatToolJsonOutput = formatToolJsonOutputImpl;

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
	let providerBudgetGateCache: ProviderBudgetGateCacheEntry | undefined;

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		state.colonies.clear();
		state.remoteActive = false;
		state.remoteUrl = undefined;
		state.remoteClients = 0;
		state.monitorMode = "unknown";
		state.lastSessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
		state.monitorMode = inferMonitorModeFromSessionFileImpl(state.lastSessionFile);
		pendingColonyGoals.splice(0, pendingColonyGoals.length);
		colonyTaskMap.clear();
		colonyGoalMap.clear();

		const settings = parseColonyPilotSettingsImpl<ColonyPilotSettings>(ctx.cwd);
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

		updateStatusUIImpl(ctx, state);
	});

	pi.on("model_select", (_event, ctx) => {
		updateStatusUIImpl(ctx, state);
	});

	pi.on("turn_start", (_event, ctx) => {
		updateStatusUIImpl(ctx, state);
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
		const quotaCfg = parseQuotaVisibilityBudgetSettingsImpl(ctx.cwd);
		const resolved = await resolveProviderBudgetGateSnapshotImpl({
			cwd: ctx.cwd,
			lookbackDays: budgetPolicyConfig.providerBudgetLookbackDays,
			quotaCfg,
			cache: providerBudgetGateCache,
		});
		providerBudgetGateCache = resolved.cache;
		return resolved.snapshot;
	}

	pi.on("message_end", (event, ctx) => {
		const text = extractTextImpl((event as { message?: unknown }).message);
		if (!text) return;
		if (applyTelemetryText(state, text)) updateStatusUIImpl(ctx, state);
		maybeSyncProjectTaskFromTelemetry(text, ctx);
	});

	pi.on("tool_result", (event, ctx) => {
		const text = extractTextImpl(event);
		if (!text) return;
		if (applyTelemetryText(state, text)) updateStatusUIImpl(ctx, state);
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
					getCapabilitiesImpl(pi),
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
					...formatPolicyEvaluationImpl(modelPolicyConfig, evaluation),
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
					...formatBudgetPolicyEvaluationImpl(budgetPolicyConfig, budgetEval),
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
					.map((b) => formatProviderBudgetStatusLineImpl(b));

				const reason = `Blocked by colony-pilot provider-budget gate: ${providerGateEval.issues.join("; ")}`;
				const msg = [
					"ant_colony bloqueada por provider-budget gate",
					...formatBudgetPolicyEvaluationImpl(
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
			const capabilities = getCapabilitiesImpl(pi);
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
			const data = inspectAntColonyRuntimeImpl(ctx.cwd);
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
			const caps = getCapabilitiesImpl(pi);
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
				readProjectSettingsImpl(ctx.cwd),
				profile,
			);
			writeProjectSettingsImpl(ctx.cwd, merged);
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
			const caps = getCapabilitiesImpl(pi);

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
				primeManualRunbookImpl(
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
					...formatPolicyEvaluationImpl(modelPolicyConfig, policyEval),
					"",
					...formatBudgetPolicyEvaluationImpl(budgetPolicyConfig, budgetEval),
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
					const existing = readProjectSettingsImpl(ctx.cwd);
					const merged = applyProjectBaselineSettings(existing, profile);
					writeProjectSettingsImpl(ctx.cwd, merged as Record<string, unknown>);

					const settings = parseColonyPilotSettingsImpl<ColonyPilotSettings>(ctx.cwd);
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
				const quotaCfg = parseQuotaVisibilityBudgetSettingsImpl(ctx.cwd);

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
					...formatPolicyEvaluationImpl(modelPolicyConfig, policyEval),
					"",
					...formatBudgetPolicyEvaluationImpl(budgetPolicyConfig, budgetEval),
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
						...formatPolicyEvaluationImpl(modelPolicyConfig, evalResult),
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
					const settings = readProjectSettingsImpl(ctx.cwd);
					const merged = deepMergeObjects(settings, {
						piStack: {
							colonyPilot: { modelPolicy: buildModelPolicyProfile(profile) },
						},
					});
					writeProjectSettingsImpl(ctx.cwd, merged);
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
							...formatPolicyEvaluationImpl(modelPolicyConfig, evalResult),
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
						readProjectSettingsImpl(ctx.cwd),
						profile,
					);
					writeProjectSettingsImpl(ctx.cwd, merged);
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
				const data = inspectAntColonyRuntimeImpl(ctx.cwd);
				ctx.ui.notify(formatArtifactsReportImpl(data), "info");
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
				updateStatusUIImpl(ctx, state);

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

				primeManualRunbookImpl(
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
				updateStatusUIImpl(ctx, state);

				primeManualRunbookImpl(
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

				if (!requireCapabilitiesImpl(ctx, caps, ["monitors"], "monitors")) {
					return;
				}

				state.monitorMode = mode;
				updateStatusUIImpl(ctx, state);
				primeManualRunbookImpl(
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
					primeManualRunbookImpl(
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
					updateStatusUIImpl(ctx, state);
					const cmd = caps.sessionWeb ? "/session-web stop" : "/remote stop";
					primeManualRunbookImpl(
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

					const ok = await tryOpenUrlImpl(pi, state.remoteUrl);
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
		updateStatusUIImpl(currentCtx, {
			...state,
			monitorMode: "unknown",
			remoteActive: false,
			colonies: new Map(),
		});
	});
}
