import type { ColonyPhase } from "./colony-pilot-runtime";
import type { ColonyPilotPreflightConfig } from "./colony-pilot-preflight";
import { ensureRecoveryTaskForCandidate as ensureRecoveryTaskForCandidateInternal } from "./colony-pilot-task-sync";
import {
  type ColonyDeliveryMode as ColonyDeliveryModeImpl,
  type ColonyPilotDeliveryEvidence as ColonyPilotDeliveryEvidenceImpl,
  type ColonyPilotDeliveryEvaluation as ColonyPilotDeliveryEvaluationImpl,
  type ColonyPilotDeliveryPolicyConfig as ColonyPilotDeliveryPolicyConfigImpl,
  type SelectivePromotionInventoryEvidence as SelectivePromotionInventoryEvidenceImpl,
  type SelectivePromotionScopeComplianceEvaluation as SelectivePromotionScopeComplianceEvaluationImpl,
  evaluateColonyDeliveryEvidence as evaluateColonyDeliveryEvidenceImpl,
  evaluateSelectivePromotionInventoryEvidence as evaluateSelectivePromotionInventoryEvidenceImpl,
  evaluateSelectivePromotionScope as evaluateSelectivePromotionScopeImpl,
  evaluateSelectivePromotionScopeCompliance as evaluateSelectivePromotionScopeComplianceImpl,
  formatDeliveryPolicyEvaluation as formatDeliveryPolicyEvaluationImpl,
  parseDeliveryModeOverride as parseDeliveryModeOverrideImpl,
  resolveColonyPilotDeliveryPolicy as resolveColonyPilotDeliveryPolicyImpl,
} from "./colony-pilot-delivery-policy";
import {
  type BaselineProfile as BaselineProfileImpl,
  applyProjectBaselineSettings as applyProjectBaselineSettingsImpl,
  buildProjectBaselineSettings as buildProjectBaselineSettingsImpl,
  deepMergeObjects as deepMergeObjectsImpl,
  resolveBaselineProfile as resolveBaselineProfileImpl,
} from "./colony-pilot-baseline";
import {
  type ColonyPilotBudgetPolicyEvaluation as ColonyPilotBudgetPolicyEvaluationImpl,
  type ColonyPilotProviderBudgetGateEvaluation as ColonyPilotProviderBudgetGateEvaluationImpl,
  collectAntColonyProviders as collectAntColonyProvidersImpl,
  evaluateAntColonyBudgetPolicy as evaluateAntColonyBudgetPolicyImpl,
  evaluateProviderBudgetGate as evaluateProviderBudgetGateImpl,
  parseBudgetOverrideReason as parseBudgetOverrideReasonImpl,
} from "./colony-pilot-budget-policy";
import {
  type ColonyAgentRole as ColonyAgentRoleImpl,
  type ColonyModelPolicyEvaluation as ColonyModelPolicyEvaluationImpl,
  type ColonyPilotModelPolicyConfig as ColonyPilotModelPolicyConfigImpl,
  type ColonyRoleModelMap as ColonyRoleModelMapImpl,
  type ModelPolicyProfile as ModelPolicyProfileImpl,
  buildModelPolicyProfile as buildModelPolicyProfileImpl,
  evaluateAntColonyModelPolicy as evaluateAntColonyModelPolicyImpl,
  resolveColonyPilotModelPolicy as resolveColonyPilotModelPolicyImpl,
  resolveModelPolicyProfile as resolveModelPolicyProfileImpl,
} from "./colony-pilot-model-policy";
import {
  type CandidateRetentionConfig as CandidateRetentionConfigImpl,
  type OutputPolicyConfig as OutputPolicyConfigImpl,
  formatToolJsonOutput as formatToolJsonOutputImpl,
  resolveColonyPilotCandidateRetentionConfig as resolveColonyPilotCandidateRetentionConfigImpl,
  resolveColonyPilotOutputPolicy as resolveColonyPilotOutputPolicyImpl,
} from "./colony-pilot-output-policy";
import type {
  ColonyPilotBudgetPolicyConfig,
  ColonyPilotDeliveryPolicyConfig,
  ColonyPilotProjectTaskSyncConfig,
} from "./colony-pilot-policy-defaults";
import type { ProviderBudgetStatus } from "./quota-visibility";

export type ColonyPilotOutputPolicyConfig = OutputPolicyConfigImpl;

export type ColonyPilotCandidateRetentionConfig =
	CandidateRetentionConfigImpl;

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

export function extractRuntimeColonyId(signalId: string): string | undefined {
	const raw = signalId.split("|")[1]?.trim();
	if (!raw) return undefined;
	if (raw.includes("${") || raw.includes("}")) return undefined;
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw)) return undefined;
	return raw;
}

export const resolveColonyPilotModelPolicy =
	resolveColonyPilotModelPolicyImpl;

export const resolveColonyPilotDeliveryPolicy =
	resolveColonyPilotDeliveryPolicyImpl;

export type SelectivePromotionInventoryEvidence =
	SelectivePromotionInventoryEvidenceImpl;

export const evaluateSelectivePromotionInventoryEvidence =
	evaluateSelectivePromotionInventoryEvidenceImpl;

export const evaluateSelectivePromotionScope =
	evaluateSelectivePromotionScopeImpl;

export type SelectivePromotionScopeComplianceEvaluation =
	SelectivePromotionScopeComplianceEvaluationImpl;

export const evaluateSelectivePromotionScopeCompliance =
	evaluateSelectivePromotionScopeComplianceImpl;

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

export type ColonyPilotProviderBudgetGateEvaluation =
	ColonyPilotProviderBudgetGateEvaluationImpl;

export const evaluateProviderBudgetGate: (
	input: AntColonyToolInput,
	currentModelRef: string | undefined,
	goal: string,
	statuses: ProviderBudgetStatus[],
	allocationWarnings: string[],
	policy: ColonyPilotBudgetPolicyConfig,
) => ColonyPilotProviderBudgetGateEvaluation = evaluateProviderBudgetGateImpl;

export const evaluateAntColonyBudgetPolicy: (
	input: AntColonyToolInput,
	policy: ColonyPilotBudgetPolicyConfig,
) => ColonyPilotBudgetPolicyEvaluation = evaluateAntColonyBudgetPolicyImpl;

export type ColonyModelPolicyEvaluation = ColonyModelPolicyEvaluationImpl;

export const evaluateAntColonyModelPolicy: (
	input: AntColonyToolInput,
	currentModelRef: string | undefined,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	modelRegistry: any,
	policy: ColonyPilotModelPolicyConfig,
	goal?: string,
) => ColonyModelPolicyEvaluation = evaluateAntColonyModelPolicyImpl;

export type ColonyAgentRole = ColonyAgentRoleImpl;

export type ColonyRoleModelMap = ColonyRoleModelMapImpl;

export type ColonyPilotModelPolicyConfig = ColonyPilotModelPolicyConfigImpl;

export type ColonyPilotBudgetPolicyEvaluation =
	ColonyPilotBudgetPolicyEvaluationImpl;

export type ColonyDeliveryMode = ColonyDeliveryModeImpl;

export type ColonyPilotDeliveryPolicyConfig =
	ColonyPilotDeliveryPolicyConfigImpl;

export type ColonyPilotDeliveryEvidence = ColonyPilotDeliveryEvidenceImpl;

export type ColonyPilotDeliveryEvaluation = ColonyPilotDeliveryEvaluationImpl;

export interface ColonyPilotSettings {
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
export type BaselineProfile = BaselineProfileImpl;
export type ModelPolicyProfile = ModelPolicyProfileImpl;

export const resolveBaselineProfile = resolveBaselineProfileImpl;

export const resolveModelPolicyProfile = resolveModelPolicyProfileImpl;

export const buildModelPolicyProfile = buildModelPolicyProfileImpl;

export const buildProjectBaselineSettings = buildProjectBaselineSettingsImpl;

export const deepMergeObjects: <T extends Record<string, unknown>>(
	base: T,
	patch: Record<string, unknown>,
) => T = deepMergeObjectsImpl;

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
