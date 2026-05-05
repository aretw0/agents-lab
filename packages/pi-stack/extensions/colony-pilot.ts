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
import {
	captureColonyRuntimeSnapshot,
	persistColonyRetentionRecord,
	readColonyRetentionSnapshot,
} from "./colony-pilot-candidate-retention";
import type {
	HatchCheckStatus,
	HatchDoctorIssue,
	HatchDoctorSnapshot,
	HatchExperienceMode,
	HatchReadiness,
} from "./colony-pilot-hatch";
import {
	buildHatchDoctorSnapshot,
	capabilityGuidance,
	evaluateHatchReadiness,
	formatHatchDoctorSnapshot,
	formatHatchReadiness,
	formatHatchRunbook,
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
	appendNoteOnceByNormalizedMessage,
	extractColonyGoalFromMessageText,
	readProjectTasksBlock,
	upsertProjectTaskFromColonySignal,
	writeProjectTasksBlock,
} from "./colony-pilot-task-sync";
import {
	evaluateSelectivePromotionScope as evaluateSelectivePromotionScopeImpl,
	evaluateSelectivePromotionScopeCompliance as evaluateSelectivePromotionScopeComplianceImpl,
	hasSelectivePromotionInventoryMissingIssue as hasSelectivePromotionInventoryMissingIssueImpl,
	removeSelectivePromotionInventoryMissingIssue as removeSelectivePromotionInventoryMissingIssueImpl,
} from "./colony-pilot-delivery-policy";
import {
	getCapabilities as getCapabilitiesImpl,
	updateStatusUI as updateStatusUIImpl,
} from "./colony-pilot-command-surface";
import {
	formatBudgetPolicyEvaluation as formatBudgetPolicyEvaluationImpl,
} from "./colony-pilot-budget-policy";
import {
	formatPolicyEvaluation as formatPolicyEvaluationImpl,
} from "./colony-pilot-model-policy";
import { registerColonyPilotCommandShortcuts } from "./colony-pilot-command-shortcuts";
import { registerColonyPilotToolSurface } from "./colony-pilot-tool-surface";
import { registerColonyPilotMainCommand } from "./colony-pilot-main-command";
import {
	parseColonyPilotSettings as parseColonyPilotSettingsImpl,
	parseQuotaVisibilityBudgetSettings as parseQuotaVisibilityBudgetSettingsImpl,
	readProjectSettings as readProjectSettingsImpl,
	writeProjectSettings as writeProjectSettingsImpl,
} from "./colony-pilot-settings";
import {
	resolveColonyPilotBudgetPolicy,
	resolveColonyPilotProjectTaskSync,
} from "./colony-pilot-policy-defaults";
export {
	DEFAULT_BUDGET_POLICY,
	DEFAULT_DELIVERY_POLICY,
	DEFAULT_PROJECT_TASK_SYNC,
	resolveColonyPilotBudgetPolicy,
	resolveColonyPilotProjectTaskSync,
} from "./colony-pilot-policy-defaults";
export type {
	ColonyPilotBudgetPolicyConfig,
	ColonyPilotDeliveryPolicyConfig,
	ColonyPilotProjectTaskSyncConfig,
} from "./colony-pilot-policy-defaults";
import {
	buildColonyPilotCheckLines,
	buildColonyPilotHatchLines,
	buildColonyPilotStatusLines,
	collectColonyPilotCheckModelIssues,
	formatColonyPilotHelp,
} from "./colony-pilot-summary";
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
export type {
	ColonyModelReadiness,
	ColonyPhase,
	ColonyPilotPreflightConfig,
	ColonyPilotPreflightResult,
	HatchCheckStatus,
	HatchDoctorIssue,
	HatchDoctorSnapshot,
	HatchExperienceMode,
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
	formatHatchRunbook,
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

import {
  ensureRecoveryTaskForCandidate,
  evaluateAntColonyBudgetPolicy,
  evaluateAntColonyModelPolicy,
  evaluateColonyDeliveryEvidence,
  evaluateProviderBudgetGate,
  extractRuntimeColonyId,
  parseDeliveryModeOverride,
  resolveColonyPilotCandidateRetentionConfig,
  resolveColonyPilotDeliveryPolicy,
  resolveColonyPilotModelPolicy,
  resolveColonyPilotOutputPolicy,
  type AntColonyToolInput,
  type ColonyModelPolicyEvaluation,
  type ColonyPilotBudgetPolicyEvaluation,
  type ColonyPilotCandidateRetentionConfig,
  type ColonyPilotDeliveryPolicyConfig,
  type ColonyPilotModelPolicyConfig,
  type ColonyPilotOutputPolicyConfig,
  type ColonyPilotSettings,
} from "./colony-pilot-public-api";
export * from "./colony-pilot-public-api";

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

		const resolveCompletedDeliveryEvaluation = () => {
			let deliveryEval = evaluateColonyDeliveryEvidence(
				text,
				signal.phase,
				deliveryPolicyConfig,
			);
			const selectiveScope = guessedGoal
				? evaluateSelectivePromotionScopeImpl(guessedGoal, text)
				: undefined;
			const selectiveScopeCompliance = guessedGoal
				? evaluateSelectivePromotionScopeComplianceImpl(guessedGoal, text, {
					enforceDerivedScopeDiffApplyEvidence:
						deliveryPolicyConfig.enforceDerivedScopeDiffApplyEvidence,
				})
				: undefined;

			if (
				deliveryPolicyConfig.mode === "apply-to-branch" &&
				selectiveScope &&
				selectiveScope.candidateFiles.length > 0 &&
				hasSelectivePromotionInventoryMissingIssueImpl(deliveryEval.issues)
			) {
				const nextIssues = removeSelectivePromotionInventoryMissingIssueImpl(
					deliveryEval.issues,
				);

				deliveryEval = {
					...deliveryEval,
					ok: nextIssues.length === 0,
					issues: nextIssues,
					evidence: {
						...deliveryEval.evidence,
						hasPromotedFileInventory: true,
						hasSkippedFileInventory: true,
						hasSelectivePromotionInventory: true,
					},
				};

				pi.appendEntry("colony-pilot.selective-promotion-inventory", {
					atIso: new Date().toISOString(),
					colonyId: signal.id,
					goal: guessedGoal,
					policy: selectiveScope.policy,
					candidateFiles: selectiveScope.candidateFiles,
					promotedFiles: selectiveScope.promotedFiles,
					skippedFiles: selectiveScope.skippedFiles,
					autoComputed: true,
				});
			}

			if (
				deliveryPolicyConfig.mode === "apply-to-branch" &&
				selectiveScopeCompliance &&
				selectiveScopeCompliance.issues.length > 0
			) {
				const mergedIssues = Array.from(
					new Set([...deliveryEval.issues, ...selectiveScopeCompliance.issues]),
				);
				deliveryEval = {
					...deliveryEval,
					ok: mergedIssues.length === 0,
					issues: mergedIssues,
				};

				pi.appendEntry("colony-pilot.selective-promotion-scope-compliance", {
					atIso: new Date().toISOString(),
					colonyId: signal.id,
					goal: guessedGoal,
					policy: selectiveScopeCompliance.policy,
					source: selectiveScopeCompliance.source,
					hasDiffApplyEvidence:
						selectiveScopeCompliance.hasDiffApplyEvidence,
					requiresDiffApplyEvidence:
						selectiveScopeCompliance.requiresDiffApplyEvidence,
					enforceDerivedScopeDiffApplyEvidence:
						deliveryPolicyConfig.enforceDerivedScopeDiffApplyEvidence,
					candidateFiles: selectiveScopeCompliance.candidateFiles,
					promotedFiles: selectiveScopeCompliance.promotedFiles,
					skippedFiles: selectiveScopeCompliance.skippedFiles,
					issues: selectiveScopeCompliance.issues,
				});
			} else if (
				deliveryPolicyConfig.mode === "apply-to-branch" &&
				selectiveScopeCompliance
			) {
				pi.appendEntry("colony-pilot.selective-promotion-scope-approved", {
					atIso: new Date().toISOString(),
					colonyId: signal.id,
					goal: guessedGoal,
					policy: selectiveScopeCompliance.policy,
					source: selectiveScopeCompliance.source,
					hasDiffApplyEvidence:
						selectiveScopeCompliance.hasDiffApplyEvidence,
					requiresDiffApplyEvidence:
						selectiveScopeCompliance.requiresDiffApplyEvidence,
					enforceDerivedScopeDiffApplyEvidence:
						deliveryPolicyConfig.enforceDerivedScopeDiffApplyEvidence,
					candidateFiles: selectiveScopeCompliance.candidateFiles,
					promotedFiles: selectiveScopeCompliance.promotedFiles,
					skippedFiles: selectiveScopeCompliance.skippedFiles,
				});

				if (
					!selectiveScopeCompliance.requiresDiffApplyEvidence &&
					!selectiveScopeCompliance.hasDiffApplyEvidence &&
					selectiveScopeCompliance.promotedFiles.length > 0
				) {
					pi.appendEntry("colony-pilot.selective-promotion-apply-evidence-advisory", {
						atIso: new Date().toISOString(),
						colonyId: signal.id,
						goal: guessedGoal,
						policy: selectiveScopeCompliance.policy,
						source: selectiveScopeCompliance.source,
						promotedFiles: selectiveScopeCompliance.promotedFiles,
						reason:
							"derived scope promotion approved without explicit diff/apply evidence (advisory)",
					});
				}
			}

			return { deliveryEval, selectiveScope, selectiveScopeCompliance };
		};

		const completedDelivery =
			signal.phase === "completed"
				? resolveCompletedDeliveryEvaluation()
				: undefined;

		let syncResult: { taskId: string } | undefined;
		if (projectTaskSyncConfig.enabled) {
			syncResult = upsertProjectTaskFromColonySignal(ctx.cwd, signal, {
				config: projectTaskSyncConfig,
				goal: guessedGoal,
				taskIdOverride,
				source: "ant_colony",
			});

			if (signal.phase === "completed") {
				const deliveryEval = completedDelivery!.deliveryEval;
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
						let changed = false;
						if (task.status !== "blocked") {
							task.status = "blocked";
							changed = true;
						}
						const now = new Date().toISOString();
						const dedupedNote = appendNoteOnceByNormalizedMessage(
							task.notes,
							`[${now}] delivery-policy blocked completion: ${deliveryEval.issues.join("; ")}`,
							projectTaskSyncConfig.maxNoteLines,
						);
						if (dedupedNote.appended) {
							task.notes = dedupedNote.notes;
							changed = true;
						}
						if (changed) writeProjectTasksBlock(ctx.cwd, block);
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
						const dedupedNote = appendNoteOnceByNormalizedMessage(
							task.notes,
							`[${now}] promotion queued automatically: ${recovery.taskId}`,
							projectTaskSyncConfig.maxNoteLines,
						);
						if (dedupedNote.appended) {
							task.notes = dedupedNote.notes;
							writeProjectTasksBlock(ctx.cwd, block);
						}
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
			const deliveryEval = completedDelivery?.deliveryEval;
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
					ctx.cwd,
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

	registerColonyPilotToolSurface(pi, {
		state,
		getModelPolicyConfig: () => modelPolicyConfig,
		getBudgetPolicyConfig: () => budgetPolicyConfig,
		getDeliveryPolicyConfig: () => deliveryPolicyConfig,
		getProviderBudgetGateCache: () => providerBudgetGateCache,
		getProjectTaskSyncConfig: () => projectTaskSyncConfig,
		getCandidateRetentionConfig: () => candidateRetentionConfig,
		getOutputPolicyConfig: () => outputPolicyConfig,
		getPreflightConfig: () => preflightConfig,
		setPreflightCache: (entry) => {
			preflightCache = entry;
		},
	});

	registerColonyPilotMainCommand(pi, {
		state,
		pendingColonyGoals,
		setCurrentCtx: (ctx) => {
			currentCtx = ctx;
		},
		getPreflightConfig: () => preflightConfig,
		getModelPolicyConfig: () => modelPolicyConfig,
		setModelPolicyConfig: (config) => {
			modelPolicyConfig = config;
		},
		getBudgetPolicyConfig: () => budgetPolicyConfig,
		getProjectTaskSyncConfig: () => projectTaskSyncConfig,
		getDeliveryPolicyConfig: () => deliveryPolicyConfig,
		getCandidateRetentionConfig: () => candidateRetentionConfig,
		setPreflightCache: (entry) => {
			preflightCache = entry;
		},
		setProviderBudgetGateCache: (entry) => {
			providerBudgetGateCache = entry;
		},
		reloadSettingsFromProject: (cwd) => {
			const settings = parseColonyPilotSettingsImpl<ColonyPilotSettings>(cwd);
			preflightConfig = resolveColonyPilotPreflightConfig(settings.preflight);
			modelPolicyConfig = resolveColonyPilotModelPolicy(settings.modelPolicy);
			budgetPolicyConfig = resolveColonyPilotBudgetPolicy(settings.budgetPolicy);
			projectTaskSyncConfig = resolveColonyPilotProjectTaskSync(settings.projectTaskSync);
			deliveryPolicyConfig = resolveColonyPilotDeliveryPolicy(settings.deliveryPolicy);
			preflightCache = undefined;
			providerBudgetGateCache = undefined;
			return { preflightConfig, modelPolicyConfig, budgetPolicyConfig, projectTaskSyncConfig, deliveryPolicyConfig };
		},
	});

	registerColonyPilotCommandShortcuts(pi);

	pi.on("session_shutdown", () => {
		updateStatusUIImpl(currentCtx, {
			...state,
			monitorMode: "unknown",
			remoteActive: false,
			colonies: new Map(),
		});
	});
}
