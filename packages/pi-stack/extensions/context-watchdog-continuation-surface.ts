/**
 * @capability-id context-watchdog
 * @capability-criticality medium
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ContextWatchdogConfig } from "./context-watchdog-config";
import {
	buildTurnBoundaryDecisionPacket,
	consumeContextPreloadPack,
	formatContextWatchContinuationReadinessSummary,
	formatContextWatchLocalSlicePreviewSummary,
	formatContextWatchLocalSliceOperatorPacketPreviewSummary,
	resolveContextWatchContinuationRecommendation,
	TURN_BOUNDARY_DIRECTION_PROMPT,
} from "./context-watchdog-continuation";
import { buildPostReloadResumeIncidentPacket } from "./context-watchdog-resume";
import {
	runContextPreloadPack,
	summarizeContextPreloadPack,
} from "./context-watchdog-preload-pack.mjs";
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
	buildReloadBeforeCompactPacket,
	readAutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";
import {
	readProjectPreferredActiveTaskIds,
	readProjectProtectedAutoResumeTaskIds,
	readProjectTaskStatusById,
} from "./context-watchdog-operator-brief";
import { readHandoffJson } from "./context-watchdog-storage";
import {
	buildLocalSliceCanaryDispatchDecisionPacket,
	resolveLocalSliceCanaryPlan,
	reviewLocalSliceOperatorApprovedContract,
} from "./guardrails-core-unattended-continuation";
import {
	buildLocalContinuityAudit,
	formatLocalContinuityAuditSummary,
	localContinuityAuditReasons,
	localContinuityProtectedPaths,
} from "./guardrails-core-unattended-continuation-surface";
import {
	GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR,
	GUARDRAILS_AUTHORIZATION_NONE,
} from "./guardrails-core-authorization";

export interface ContextWatchdogContinuationSurfaceRuntime {
	getConfig(): ContextWatchdogConfig;
	isReloadRequiredForSourceUpdate?: () => boolean;
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

function currentReloadRequired(runtime: ContextWatchdogContinuationSurfaceRuntime): boolean | undefined {
	return runtime.isReloadRequiredForSourceUpdate?.();
}

export function registerContextWatchdogContinuationSurface(
	pi: ExtensionAPI,
	runtime: ContextWatchdogContinuationSurfaceRuntime,
): void {
	pi.registerTool({
		name: "context_watch_post_reload_incident_packet",
		label: "Context Watch Post Reload Incident Packet",
		description:
			"Read-only post-reload auto-resume incident packet. Captures pending reload-resume intent and optional manual-nudge evidence without dispatching resume, scheduler, remote, or mutation.",
		parameters: Type.Object({
			manual_nudge_observed: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = (params ?? {}) as Record<string, unknown>;
			const intent = readAutoResumeAfterReloadIntent(readHandoffJson(ctx.cwd));
			const packet = buildPostReloadResumeIncidentPacket({
				nowMs: Date.now(),
				intent,
				manualNudgeObserved: p.manual_nudge_observed === true,
			});
			return {
				content: [{ type: "text", text: packet.summary }],
				details: packet,
			};
		},
	});

	pi.registerTool({
		name: "context_watch_reload_before_compact_packet",
		label: "Context Watch Reload Before Compact Packet",
		description:
			"Report-only reload-before-compact decision packet. Composes runtime reload need, context pressure, handoff freshness, checkpoint freshness, and source/tool changes without dispatching reload, compact, resume, or mutation.",
		parameters: Type.Object({
			context_level: Type.Optional(Type.Union([
				Type.Literal("ok"),
				Type.Literal("warn"),
				Type.Literal("checkpoint"),
				Type.Literal("compact"),
			])),
			context_percent: Type.Optional(Type.Number()),
			handoff_freshness: Type.Optional(Type.String()),
			checkpoint_fresh: Type.Optional(Type.Boolean()),
			pending_source_or_tool_changes: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const p = (params ?? {}) as Record<string, unknown>;
			const packet = buildReloadBeforeCompactPacket({
				contextLevel: typeof p.context_level === "string" ? p.context_level : undefined,
				contextPercent: typeof p.context_percent === "number" ? p.context_percent : undefined,
				reloadRequired: currentReloadRequired(runtime) === true,
				handoffFreshness: typeof p.handoff_freshness === "string" ? p.handoff_freshness : undefined,
				checkpointFresh: p.checkpoint_fresh === true,
				pendingSourceOrToolChanges: p.pending_source_or_tool_changes === true,
			});
			return {
				content: [{ type: "text", text: packet.summary }],
				details: packet,
			};
		},
	});

	pi.registerTool({
		name: "context_preload_pack",
		label: "Context Preload Pack",
		description:
			"Generate a context warm pack from recent read telemetry. Read-only by default; write=true stores the generated cache under .sandbox/pi-agent/preload or a provided output path.",
		parameters: Type.Object({
			days: Type.Optional(Type.Number()),
			limit: Type.Optional(Type.Number()),
			top: Type.Optional(Type.Number()),
			write: Type.Optional(Type.Boolean()),
			out: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = (params ?? {}) as Record<string, unknown>;
			const write = p.write === true;
			const report = runContextPreloadPack({
				workspace: ctx.cwd,
				days: p.days,
				limit: p.limit,
				top: p.top,
				write,
				out: typeof p.out === "string" ? p.out : undefined,
			});
			const summary = summarizeContextPreloadPack(report);
			return {
				content: [{ type: "text", text: summary }],
				details: {
					...report,
					summary,
					effect: write ? "write-cache" : "none",
					mode: write ? "operator-requested-cache-write" : "read-only-preview",
					authorization: write ? GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR : GUARDRAILS_AUTHORIZATION_NONE,
				},
			};
		},
	});

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
				{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1), excludedTaskIds: readProjectProtectedAutoResumeTaskIds(ctx.cwd), reloadRequired: currentReloadRequired(runtime) },
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
					operatorDecisionNeeded: false,
					reasonCode: "none",
					recommendedAction: ready ? "continue-local-safe" : "stabilize-local-safe",
				}
				: {
					operatorDecisionNeeded: true,
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
						nextActionCode: materialReadiness.nextActionCode,
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
					authorization: GUARDRAILS_AUTHORIZATION_NONE,
				},
			};
		},
	});

	pi.registerTool({
		name: "turn_boundary_decision_packet",
		label: "Turn Boundary Decision Packet",
		description:
			"Report-only packet for turn boundary continuation decisions (continue|checkpoint|pause|ask-operator) with explicit operatorActionRequired, nextAutoStep, directionPrompt, directionPreview, and optional growth maturity go/hold snapshot.",
		parameters: Type.Object({
			safety_score: Type.Optional(Type.Number({ description: "Optional safety maturity score (0..100)." })),
			calibration_score: Type.Optional(Type.Number({ description: "Optional calibration maturity score (0..100)." })),
			throughput_score: Type.Optional(Type.Number({ description: "Optional throughput maturity score (0..100)." })),
			simplicity_score: Type.Optional(Type.Number({ description: "Optional simplicity maturity score (0..100)." })),
			go_threshold: Type.Optional(Type.Number({ description: "Optional go threshold for growth maturity snapshot." })),
			hold_threshold: Type.Optional(Type.Number({ description: "Optional hold threshold for growth maturity snapshot." })),
			debt_budget_ok: Type.Optional(Type.Boolean({ description: "Optional debt-budget signal for growth maturity snapshot." })),
			critical_blockers: Type.Optional(Type.Number({ description: "Optional critical blocker count." })),
			runtime_changed: Type.Optional(Type.Boolean({ description: "Whether the just-closed slice changed runtime/extension code." })),
			docs_only: Type.Optional(Type.Boolean({ description: "Whether the just-closed slice changed only docs/board narrative." })),
			git_clean: Type.Optional(Type.Boolean({ description: "Whether the slice was committed and the relevant working tree is clean." })),
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
				{ taskStatusById: readProjectTaskStatusById(ctx.cwd), preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1), excludedTaskIds: readProjectProtectedAutoResumeTaskIds(ctx.cwd), reloadRequired: currentReloadRequired(runtime) },
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
				recentChange: {
					runtimeChanged: p.runtime_changed === true,
					docsOnly: p.docs_only === true,
					gitClean: p.git_clean === true,
				},
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
					authorization: GUARDRAILS_AUTHORIZATION_NONE,
					dispatchAllowed: false,
					mutationAllowed: false,
				},
			};
		},
	});

	pi.registerTool({
		name: "context_watch_local_slice_preview",
		label: "Context Watch Local Slice Preview",
		description:
			"Read-only preview that composes continuation readiness with the local-slice local canary plan. Never dispatches automation, staging, commits, checkpoints, remote, or scheduler work.",
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
				{ taskStatusById, preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1), excludedTaskIds: readProjectProtectedAutoResumeTaskIds(ctx.cwd), reloadRequired: currentReloadRequired(runtime) },
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
			const plan = resolveLocalSliceCanaryPlan({
				readinessReady,
				authorization: GUARDRAILS_AUTHORIZATION_NONE,
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
			const decisionPacket = buildLocalSliceCanaryDispatchDecisionPacket({
				plan,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.singleSliceOnly,
			});
			const summary = [
				formatContextWatchLocalSlicePreviewSummary({
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
					authorization: GUARDRAILS_AUTHORIZATION_NONE,
				},
			};
		},
	});

	pi.registerTool({
		name: "context_watch_local_slice_operator_packet_preview",
		label: "Context Watch Local Slice Operator Packet Preview",
		description:
			"Read-only operator packet composing continuation readiness, local-slice preview, decision packet, and operator contract review. Never dispatches execution and defaults operator decision to missing.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const config = runtime.getConfig();
			const taskStatusById = readProjectTaskStatusById(ctx.cwd);
			const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
				readHandoffJson(ctx.cwd),
				config.handoffFreshMaxAgeMs,
				Date.now(),
				{ taskStatusById, preferredTaskIds: readProjectPreferredActiveTaskIds(ctx.cwd, 1), excludedTaskIds: readProjectProtectedAutoResumeTaskIds(ctx.cwd), reloadRequired: currentReloadRequired(runtime) },
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
			const plan = resolveLocalSliceCanaryPlan({
				readinessReady,
				authorization: GUARDRAILS_AUTHORIZATION_NONE,
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
			const decisionPacket = buildLocalSliceCanaryDispatchDecisionPacket({
				plan,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.singleSliceOnly,
			});
			const declaredFilesKnown = Number(localAudit.packetInput?.candidate?.estimatedFiles ?? 0) > 0;
			const contractReview = reviewLocalSliceOperatorApprovedContract({
				decisionPacket,
				operatorDecision: "missing",
				singleFocus,
				localSafeScope: protectedScopesClear,
				declaredFilesKnown,
				protectedScopesClear,
				rollbackPlanKnown: gitStateExpected,
				validationGateKnown: validationKnown,
				stagingScopeKnown: singleFocus && protectedScopesClear,
				commitScopeKnown: singleFocus && gitStateExpected,
				checkpointPlanned: checkpointFresh && handoffBudgetOk,
				stopContractKnown: plan.mustStopAfterSlice && plan.singleSliceOnly,
			});
			const summary = formatContextWatchLocalSliceOperatorPacketPreviewSummary({
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
					authorization: GUARDRAILS_AUTHORIZATION_NONE,
					dispatchAllowed: false,
					executorApproved: false,
				},
			};
		},
	});
}
