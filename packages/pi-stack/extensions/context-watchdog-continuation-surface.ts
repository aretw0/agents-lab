import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ContextWatchdogConfig } from "./context-watchdog-config";
import {
	buildTurnBoundaryDecisionPacket,
	consumeContextPreloadPack,
	formatContextWatchContinuationReadinessSummary,
	formatContextWatchOneSliceCanaryPreviewSummary,
	formatContextWatchOneSliceOperatorPacketPreviewSummary,
	resolveContextWatchContinuationRecommendation,
	TURN_BOUNDARY_DIRECTION_PROMPT,
} from "./context-watchdog-continuation";
import { buildAfkMaterialReadinessSnapshot } from "./context-watchdog-afk-material";
import {
	extractAutoResumePromptValue,
	readContextWatchFreshnessSignals,
} from "./context-watchdog-freshness";
import {
	buildAutoResumePromptEnvelopeFromHandoff,
	resolveHandoffFreshness,
	summarizeAutoResumePromptDiagnostics,
} from "./context-watchdog-handoff";
import { resolveHandoffGrowthMaturitySnapshot } from "./context-watchdog-growth-checkpoint";
import {
	readAutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";
import {
	readProjectPreferredActiveTaskIds,
	readProjectTaskStatusById,
} from "./context-watchdog-operator-brief";
import { readHandoffJson } from "./context-watchdog-storage";
import {
	buildOneSliceLocalCanaryDispatchDecisionPacket,
	resolveOneSliceLocalCanaryPlan,
	reviewOneSliceLocalHumanConfirmedContract,
} from "./guardrails-core-unattended-continuation";
import {
	buildLocalContinuityAudit,
	formatLocalContinuityAuditSummary,
	localContinuityAuditReasons,
	localContinuityProtectedPaths,
} from "./guardrails-core-unattended-continuation-surface";

export interface ContextWatchdogContinuationSurfaceRuntime {
	getConfig(): ContextWatchdogConfig;
}

function collectorStatus(
	localAudit: ReturnType<typeof buildLocalContinuityAudit>,
	fact: string,
): string | undefined {
	return localAudit.collectorResults.find((entry) => entry.fact === fact)?.status;
}

function resolveSingleFocusStatus(
	focusTasks: string,
	taskStatusById: Record<string, string>,
): string | undefined {
	if (focusTasks === "none-listed" || focusTasks.includes(",")) return undefined;
	return taskStatusById[focusTasks] ?? taskStatusById[focusTasks.toUpperCase()];
}

export function registerContextWatchdogContinuationSurface(
	pi: ExtensionAPI,
	runtime: ContextWatchdogContinuationSurfaceRuntime,
): void {
	pi.registerTool({
		name: "context_preload_consume",
		label: "Context Preload Consume",
		description:
			"Read-only fresh-context pack consumer with fail-closed fallback to canonical handoff/tasks/verification when stale.",
		parameters: Type.Object({
			profile: Type.Optional(Type.Union([
				Type.Literal("control-plane-core"),
				Type.Literal("agent-worker-lean"),
				Type.Literal("swarm-scout-min"),
			])),
			max_age_hours: Type.Optional(Type.Number()),
			pack_path: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = (params ?? {}) as { profile?: string; max_age_hours?: number; pack_path?: string };
			const report = consumeContextPreloadPack(ctx.cwd, {
				profile: p.profile,
				maxAgeHours: p.max_age_hours,
				packPath: p.pack_path,
			});
			return {
				content: [{ type: "text", text: report.summary }],
				details: report,
			};
		},
	});

	pi.registerTool({
		name: "context_watch_continuation_readiness",
		label: "Context Watch Continuation Readiness",
		description:
			"Read-only continuation readiness packet combining auto-resume primary focus with local continuity audit. Never dispatches resume, compact, scheduler, remote, or automation.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const config = runtime.getConfig();
			const handoff = readHandoffJson(ctx.cwd);
			const postReloadResumeIntent = readAutoResumeAfterReloadIntent(handoff);
			const growthSnapshotBase = resolveHandoffGrowthMaturitySnapshot(handoff);
			const handoffFreshness = resolveHandoffFreshness(
				typeof handoff.timestamp === "string" ? handoff.timestamp : undefined,
				Date.now(),
				config.handoffFreshMaxAgeMs,
			).label;
			const growthSnapshot = growthSnapshotBase
				? {
					...growthSnapshotBase,
					freshness: handoffFreshness,
				}
				: undefined;
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				handoff,
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const diagnosticsSummary = summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics);
			const focusTasks = extractAutoResumePromptValue(resumeEnvelope.prompt, "focusTasks", "none-listed");
			const staleFocus = extractAutoResumePromptValue(resumeEnvelope.prompt, "staleFocus", "none");
			const staleFocusCount = resumeEnvelope.diagnostics.staleFocusTasks?.length ?? 0;
			const localAudit = buildLocalContinuityAudit(ctx.cwd);
			const localAuditReasons = localContinuityAuditReasons(localAudit);
			const protectedPaths = localContinuityProtectedPaths(localAudit);
			const localContinuitySummary = formatLocalContinuityAuditSummary(localAudit, localAuditReasons);
			const localAuditDecision = localAudit.envelope.packet.gate.decision;
			const ready = focusTasks !== "none-listed" && localAudit.envelope.eligibleForAuditedRuntimeSurface;
			const recommendation = resolveContextWatchContinuationRecommendation({
				ready,
				focusTasks,
				staleFocusCount,
				localAuditReasons,
			});
			const materialReadiness = buildAfkMaterialReadinessSnapshot(ctx.cwd, focusTasks);
			const decisionCue = materialReadiness.decision === "continue"
				? {
					humanDecisionNeeded: false,
					reasonCode: "none",
					recommendedAction: ready ? "continue-local-safe" : "stabilize-local-safe",
				}
				: {
					humanDecisionNeeded: true,
					reasonCode: "seed-local-safe-required",
					recommendedAction: "seed-local-safe",
				};
			const freshness = readContextWatchFreshnessSignals(ctx.cwd, "control-plane-core");
			const validationKnown = collectorStatus(localAudit, "validation") === "observed";
			const protectedScopesClear = collectorStatus(localAudit, "protected-scopes") === "observed" && protectedPaths.length === 0;
			const autoAdvanceBlockedReasons = [
				freshness.dirtySignal !== "clean" ? "git-not-clean" : undefined,
				!protectedScopesClear ? "protected-scope" : undefined,
				!validationKnown ? "validation-failed-or-unknown" : undefined,
			].filter((reason): reason is string => Boolean(reason));
			const autoAdvanceDecision = ready && autoAdvanceBlockedReasons.length === 0
				? "eligible"
				: "blocked";
			const readinessSummary = formatContextWatchContinuationReadinessSummary({
				ready,
				focusTasks,
				localAuditDecision,
				localAuditReasons,
				protectedPaths,
				staleFocusCount,
			});
			const summary = [
				readinessSummary,
				`preload=${freshness.preloadDecision}`,
				`dirty=${freshness.dirtySignal}`,
				`autoAdvance=${autoAdvanceDecision}`,
				`material=${materialReadiness.decision}`,
				`decisionCue=${decisionCue.reasonCode}`,
				postReloadResumeIntent ? "postReloadResume=pending" : undefined,
				growthSnapshot?.decision ? `growthDecision=${growthSnapshot.decision}` : undefined,
				growthSnapshot?.score !== undefined ? `growthScore=${growthSnapshot.score}` : undefined,
				growthSnapshot ? `growthSource=${growthSnapshot.source}` : undefined,
				growthSnapshot?.freshness ? `growthFresh=${growthSnapshot.freshness}` : undefined,
			].filter(Boolean).join(" ");
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					ready,
					focusTasks,
					staleFocus,
					staleFocusCount,
					diagnosticsSummary,
					postReloadResumePending: Boolean(postReloadResumeIntent),
					postReloadResumeReason: postReloadResumeIntent?.reason,
					localContinuitySummary,
					localContinuityReasons: localAuditReasons,
					protectedPaths,
					recommendationCode: recommendation.recommendationCode,
					nextAction: recommendation.nextAction,
					materialReadiness: {
						decision: materialReadiness.decision,
						recommendationCode: materialReadiness.recommendationCode,
						nextAction: materialReadiness.nextAction,
						blockedReasons: materialReadiness.blockedReasons,
						stock: materialReadiness.stock,
					},
					decisionCue,
					growthMaturitySnapshot: growthSnapshot,
					autoAdvanceContract: {
						enabled: true,
						intent: "hard-intent",
						mode: "fail-closed",
						decision: autoAdvanceDecision,
						blockedReasons: autoAdvanceBlockedReasons,
						reloadRequired: false,
						validationKnown,
						protectedScopesClear,
						gitDirtySignal: freshness.dirtySignal,
					},
					preload: freshness.preload,
					gitDirty: freshness.gitDirty,
					localContinuity: localAudit,
					autoResumePrompt: resumeEnvelope.prompt,
					effect: "none",
					mode: "read-only-readiness",
					authorization: "none",
				},
			};
		},
	});

	pi.registerTool({
		name: "turn_boundary_decision_packet",
		label: "Turn Boundary Decision Packet",
		description:
			"Report-only packet for turn boundary continuation decisions (continue|checkpoint|pause|ask-human) with explicit humanActionRequired, nextAutoStep, directionPrompt, directionPreview, and optional growth maturity go/hold snapshot.",
		parameters: Type.Object({
			safety_score: Type.Optional(Type.Number({ description: "Optional safety maturity score (0..100)." })),
			calibration_score: Type.Optional(Type.Number({ description: "Optional calibration maturity score (0..100)." })),
			throughput_score: Type.Optional(Type.Number({ description: "Optional throughput maturity score (0..100)." })),
			simplicity_score: Type.Optional(Type.Number({ description: "Optional simplicity maturity score (0..100)." })),
			go_threshold: Type.Optional(Type.Number({ description: "Optional go threshold for growth maturity snapshot." })),
			hold_threshold: Type.Optional(Type.Number({ description: "Optional hold threshold for growth maturity snapshot." })),
			debt_budget_ok: Type.Optional(Type.Boolean({ description: "Optional debt-budget signal for growth maturity snapshot." })),
			critical_blockers: Type.Optional(Type.Number({ description: "Optional critical blocker count." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const config = runtime.getConfig();
			const p = (params ?? {}) as Record<string, unknown>;
			const growthInputProvided = [
				"safety_score",
				"calibration_score",
				"throughput_score",
				"simplicity_score",
				"go_threshold",
				"hold_threshold",
				"debt_budget_ok",
				"critical_blockers",
			].some((key) => p[key] !== undefined);
			const handoff = readHandoffJson(ctx.cwd);
			const fallbackGrowthSnapshotBase = growthInputProvided
				? undefined
				: resolveHandoffGrowthMaturitySnapshot(handoff);
			const handoffFreshness = resolveHandoffFreshness(
				typeof handoff.timestamp === "string" ? handoff.timestamp : undefined,
				Date.now(),
				config.handoffFreshMaxAgeMs,
			).label;
			const fallbackGrowthSnapshot = fallbackGrowthSnapshotBase
				? {
					...fallbackGrowthSnapshotBase,
					freshness: handoffFreshness,
				}
				: undefined;
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				handoff,
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const focusTasks = extractAutoResumePromptValue(resumeEnvelope.prompt, "focusTasks", "none-listed");
			const staleFocusCount = resumeEnvelope.diagnostics.staleFocusTasks?.length ?? 0;
			const localAudit = buildLocalContinuityAudit(ctx.cwd);
			const localAuditReasons = localContinuityAuditReasons(localAudit);
			const ready = focusTasks !== "none-listed" && localAudit.envelope.eligibleForAuditedRuntimeSurface;
			const packet = buildTurnBoundaryDecisionPacket({
				ready,
				focusTasks,
				staleFocusCount,
				localAuditReasons,
				growthMaturity: growthInputProvided
					? {
						safetyScore: typeof p.safety_score === "number" ? p.safety_score : undefined,
						calibrationScore: typeof p.calibration_score === "number" ? p.calibration_score : undefined,
						throughputScore: typeof p.throughput_score === "number" ? p.throughput_score : undefined,
						simplicityScore: typeof p.simplicity_score === "number" ? p.simplicity_score : undefined,
						goThreshold: typeof p.go_threshold === "number" ? p.go_threshold : undefined,
						holdThreshold: typeof p.hold_threshold === "number" ? p.hold_threshold : undefined,
						debtBudgetOk: typeof p.debt_budget_ok === "boolean" ? p.debt_budget_ok : undefined,
						criticalBlockers: typeof p.critical_blockers === "number" ? p.critical_blockers : undefined,
					}
					: undefined,
				growthMaturitySnapshot: fallbackGrowthSnapshot,
			});
			return {
				content: [{ type: "text", text: packet.summary }],
				details: {
					...packet,
					focusTasks,
					staleFocusCount,
					localAuditReasons,
					directionPromptCanonical: TURN_BOUNDARY_DIRECTION_PROMPT,
					mode: "report-only",
					effect: "none",
					authorization: "none",
					dispatchAllowed: false,
					mutationAllowed: false,
				},
			};
		},
	});

	pi.registerTool({
		name: "context_watch_one_slice_canary_preview",
		label: "Context Watch One-Slice Canary Preview",
		description:
			"Read-only preview that composes continuation readiness with the one-slice local canary plan. Never dispatches automation, staging, commits, checkpoints, remote, or scheduler work.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const config = runtime.getConfig();
			const taskStatusById = readProjectTaskStatusById(ctx.cwd);
			const handoff = readHandoffJson(ctx.cwd);
			const postReloadResumeIntent = readAutoResumeAfterReloadIntent(handoff);
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				handoff,
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById, preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const diagnosticsSummary = summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics);
			const focusTasks = extractAutoResumePromptValue(resumeEnvelope.prompt, "focusTasks", "none-listed");
			const localAudit = buildLocalContinuityAudit(ctx.cwd);
			const localAuditReasons = localContinuityAuditReasons(localAudit);
			const protectedPaths = localContinuityProtectedPaths(localAudit);
			const localContinuitySummary = formatLocalContinuityAuditSummary(localAudit, localAuditReasons);
			const focusStatus = resolveSingleFocusStatus(focusTasks, taskStatusById);
			const readinessReady = focusTasks !== "none-listed" && localAudit.envelope.eligibleForAuditedRuntimeSurface;
			const checkpointFresh = collectorStatus(localAudit, "checkpoint") === "observed";
			const handoffBudgetOk = collectorStatus(localAudit, "handoff-budget") === "observed";
			const gitStateExpected = collectorStatus(localAudit, "git-state") === "observed";
			const protectedScopesClear = collectorStatus(localAudit, "protected-scopes") === "observed" && protectedPaths.length === 0;
			const validationKnown = collectorStatus(localAudit, "validation") === "observed";
			const stopConditionsClear = collectorStatus(localAudit, "stop-conditions") === "observed";
			const singleFocus = focusTasks !== "none-listed" && !focusTasks.includes(",");
			const plan = resolveOneSliceLocalCanaryPlan({
				readinessReady,
				authorization: "none",
				checkpointFresh,
				handoffBudgetOk,
				gitStateExpected,
				protectedScopesClear,
				validationKnown,
				stopConditionsClear,
				risk: false,
				ambiguous: false,
				repeatRequested: false,
				sliceAlreadyCompleted: focusStatus === "completed",
			});
			const decisionPacket = buildOneSliceLocalCanaryDispatchDecisionPacket({
				plan,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.oneSliceOnly,
			});
			const summary = [
				formatContextWatchOneSliceCanaryPreviewSummary({
					...plan,
					decisionPacketDecision: decisionPacket.decision,
					dispatchAllowed: decisionPacket.dispatchAllowed,
					decisionPacketReasons: decisionPacket.reasons,
				}),
				postReloadResumeIntent ? "postReloadResume=pending" : undefined,
			].filter(Boolean).join(" ");
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					plan,
					decisionPacket,
					focusTasks,
					focusStatus,
					diagnosticsSummary,
					postReloadResumePending: Boolean(postReloadResumeIntent),
					postReloadResumeReason: postReloadResumeIntent?.reason,
					localContinuitySummary,
					localContinuityReasons: localAuditReasons,
					protectedPaths,
					localContinuity: localAudit,
					autoResumePrompt: resumeEnvelope.prompt,
					effect: "none",
					mode: "read-only-preview",
					activation: "none",
					authorization: "none",
				},
			};
		},
	});

	pi.registerTool({
		name: "context_watch_one_slice_operator_packet_preview",
		label: "Context Watch One-Slice Operator Packet Preview",
		description:
			"Read-only operator packet composing continuation readiness, one-slice preview, decision packet, and human contract review. Never dispatches execution and defaults human confirmation to missing.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const config = runtime.getConfig();
			const taskStatusById = readProjectTaskStatusById(ctx.cwd);
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				readHandoffJson(ctx.cwd),
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById, preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1) },
			);
			const diagnosticsSummary = summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics);
			const focusTasks = extractAutoResumePromptValue(resumeEnvelope.prompt, "focusTasks", "none-listed");
			const localAudit = buildLocalContinuityAudit(ctx.cwd);
			const localAuditReasons = localContinuityAuditReasons(localAudit);
			const protectedPaths = localContinuityProtectedPaths(localAudit);
			const localContinuitySummary = formatLocalContinuityAuditSummary(localAudit, localAuditReasons);
			const focusStatus = resolveSingleFocusStatus(focusTasks, taskStatusById);
			const readinessReady = focusTasks !== "none-listed" && localAudit.envelope.eligibleForAuditedRuntimeSurface;
			const checkpointFresh = collectorStatus(localAudit, "checkpoint") === "observed";
			const handoffBudgetOk = collectorStatus(localAudit, "handoff-budget") === "observed";
			const gitStateExpected = collectorStatus(localAudit, "git-state") === "observed";
			const protectedScopesClear = collectorStatus(localAudit, "protected-scopes") === "observed" && protectedPaths.length === 0;
			const validationKnown = collectorStatus(localAudit, "validation") === "observed";
			const stopConditionsClear = collectorStatus(localAudit, "stop-conditions") === "observed";
			const singleFocus = focusTasks !== "none-listed" && !focusTasks.includes(",");
			const plan = resolveOneSliceLocalCanaryPlan({
				readinessReady,
				authorization: "none",
				checkpointFresh,
				handoffBudgetOk,
				gitStateExpected,
				protectedScopesClear,
				validationKnown,
				stopConditionsClear,
				risk: false,
				ambiguous: false,
				repeatRequested: false,
				sliceAlreadyCompleted: focusStatus === "completed",
			});
			const decisionPacket = buildOneSliceLocalCanaryDispatchDecisionPacket({
				plan,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.oneSliceOnly,
			});
			const declaredFilesKnown = Number(localAudit.packetInput?.candidate?.estimatedFiles ?? 0) > 0;
			const contractReview = reviewOneSliceLocalHumanConfirmedContract({
				decisionPacket,
				humanConfirmation: "missing",
				singleFocus,
				localSafeScope: protectedScopesClear,
				declaredFilesKnown,
				protectedScopesClear,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.oneSliceOnly,
			});
			const summary = formatContextWatchOneSliceOperatorPacketPreviewSummary({
				readinessReady,
				previewDecision: plan.decision,
				packetDecision: decisionPacket.decision,
				contractDecision: contractReview.decision,
				dispatchAllowed: decisionPacket.dispatchAllowed || contractReview.dispatchAllowed,
				executorApproved: contractReview.executorApproved,
				contractReasons: contractReview.reasons,
			});
			return {
				content: [{ type: "text", text: summary }],
				details: {
					summary,
					readinessReady,
					plan,
					decisionPacket,
					contractReview,
					focusTasks,
					focusStatus,
					diagnosticsSummary,
					localContinuitySummary,
					localContinuityReasons: localAuditReasons,
					protectedPaths,
					localContinuity: localAudit,
					autoResumePrompt: resumeEnvelope.prompt,
					effect: "none",
					mode: "read-only-operator-packet",
					activation: "none",
					authorization: "none",
					dispatchAllowed: false,
					executorApproved: false,
				},
			};
		},
	});
}
