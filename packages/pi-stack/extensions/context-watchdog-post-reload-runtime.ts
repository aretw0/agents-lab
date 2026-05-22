import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextWatchdogConfig } from "./context-watchdog-config";
import {
	buildAutoResumePromptEnvelopeFromHandoff,
	summarizeAutoResumePromptDiagnostics,
	type AutoResumePromptDiagnostics,
} from "./context-watchdog-handoff";
import {
	latestContextWatchEvent,
	contextWatchEventAgeMs,
} from "./context-watchdog-handoff-events";
import {
	readProjectPreferredActiveTaskIds,
	readProjectProtectedAutoResumeTaskIds,
	readProjectTaskStatusById,
} from "./context-watchdog-operator-brief";
import {
	clearAutoResumeAfterReloadIntent,
	readAutoResumeAfterReloadIntent,
} from "./context-watchdog-reload-intent";
import {
	buildAutoResumeDecisionSnapshot,
	buildPostReloadResumeIncidentPacket,
	resolveAutoResumeDispatchDecision,
	resolvePostReloadPendingNotifyDecision,
	shouldNotifyAutoResumeSuppression,
	type AutoResumeDecisionSnapshot,
	type PostReloadResumeIncidentPacket,
	type PostReloadPendingNotifyMemory,
} from "./context-watchdog-resume";
import {
	resolveHandoffBoardReconciliation,
} from "./context-watchdog-handoff";
import {
	reconcileAutoResumeHandoffFocus,
	resolveCheckpointEvidenceReadyForCalmClose,
} from "./context-watchdog-progress-signals";
import {
	readDeferredLaneQueueCount,
} from "./context-watchdog-runtime-status";
import {
	readHandoffJson,
	writeHandoffJson,
} from "./context-watchdog-storage";
import type { ContextWatchTimeoutPressureState } from "./context-watchdog-runtime-state";
import { readLongRunLoopRuntimeState } from "./guardrails-core-lane-queue-runtime";
import {
	buildToolSchemaValidationPacket,
	type ToolSchemaValidationCache,
	type ToolSchemaValidationPacket,
	type ToolSchemaValidationTool,
} from "./guardrails-core-tool-schema-validation";

export interface ContextWatchPostReloadAutoResumeResult {
	postReloadPendingNotifyMemory: PostReloadPendingNotifyMemory;
	lastAutoResumeAt?: number;
	lastAutoResumeDecision?: AutoResumeDecisionSnapshot & {
		promptDiagnostics?: AutoResumePromptDiagnostics;
	};
	lastPostReloadIncident?: PostReloadResumeIncidentPacket;
	lastToolSchemaValidation?: ToolSchemaValidationPacket;
}

function toolInfoToSchemaValidationTool(tool: unknown): ToolSchemaValidationTool | undefined {
	if (!tool || typeof tool !== "object") return undefined;
	const record = tool as Record<string, unknown>;
	if (typeof record.name !== "string" || !record.name.trim()) return undefined;
	return {
		name: record.name.trim(),
		parameters: record.parameters,
	};
}

export function readToolSchemaValidationCache(cwd: string): ToolSchemaValidationCache | undefined {
	const filePath = join(cwd, ".pi", "cache", "tool-schema-validation.json");
	if (!existsSync(filePath)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		if (!parsed || typeof parsed !== "object") return undefined;
		const record = parsed as Record<string, unknown>;
		if (typeof record.fingerprint !== "string") return undefined;
		if (record.decision !== "valid" && record.decision !== "cached-valid") return undefined;
		return {
			fingerprint: record.fingerprint,
			decision: record.decision,
			validatedAtIso: typeof record.validatedAtIso === "string" ? record.validatedAtIso : undefined,
		};
	} catch {
		return undefined;
	}
}

export function resolvePostReloadToolSchemaValidation(params: {
	cwd: string;
	tools: unknown[];
	nowMs: number;
	cache?: ToolSchemaValidationCache;
}): ToolSchemaValidationPacket {
	return buildToolSchemaValidationPacket({
		tools: params.tools.map(toolInfoToSchemaValidationTool).filter((tool): tool is ToolSchemaValidationTool => Boolean(tool)),
		cache: params.cache ?? readToolSchemaValidationCache(params.cwd),
		nowIso: new Date(params.nowMs).toISOString(),
	});
}

export function handlePostReloadAutoResume(params: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	config: ContextWatchdogConfig;
	nowMs: number;
	reloadRequiredAtRunStart: boolean;
	timeoutPressure: ContextWatchTimeoutPressureState;
	postReloadPendingNotifyMemory: PostReloadPendingNotifyMemory;
	postReloadPendingNotifyMinCooldownMs: number;
}): ContextWatchPostReloadAutoResumeResult {
	const { pi, ctx, config, nowMs, reloadRequiredAtRunStart, timeoutPressure } = params;
	let postReloadPendingNotifyMemory = params.postReloadPendingNotifyMemory;
	const handoffForPostReloadResume = readHandoffJson(ctx.cwd);
	const pendingAutoResumeAfterReload = readAutoResumeAfterReloadIntent(handoffForPostReloadResume);
	if (!pendingAutoResumeAfterReload) {
		return { postReloadPendingNotifyMemory: {} };
	}
	if (reloadRequiredAtRunStart) {
		return { postReloadPendingNotifyMemory };
	}

	const toolSchemaValidation = resolvePostReloadToolSchemaValidation({
		cwd: ctx.cwd,
		tools: (pi as unknown as { getAllTools?: () => unknown[] }).getAllTools?.() ?? [],
		nowMs,
	});
	if (toolSchemaValidation.decision === "invalid") {
		const blockingSchemaFailure = toolSchemaValidation.findings.some((finding) => finding.reason !== "parameters-not-object");
		(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
			"context-watchdog.post-reload-tool-schema-invalid",
			{
				atIso: new Date(nowMs).toISOString(),
				summary: toolSchemaValidation.summary,
				findings: toolSchemaValidation.findings.slice(0, 5),
				rollbackPath: toolSchemaValidation.rollbackPath,
				blocking: blockingSchemaFailure,
			},
		);
		if (config.notify) {
			ctx.ui.notify(
				blockingSchemaFailure
					? "context-watch: post-reload tool schema invalid; keeping auto-resume pending"
					: "context-watch: post-reload tool schema warning recorded",
				"warning",
			);
		}
		if (blockingSchemaFailure) {
			return { postReloadPendingNotifyMemory, lastToolSchemaValidation: toolSchemaValidation };
		}
	}

	const hasPendingMessages = ctx.hasPendingMessages();
	const queuedLaneIntents = readDeferredLaneQueueCount(ctx.cwd);
	const loopRuntimeState = readLongRunLoopRuntimeState(ctx.cwd);
	const loopPaused = loopRuntimeState.mode === "paused" || loopRuntimeState.stopCondition === "manual-pause";
	let handoffForDispatch = handoffForPostReloadResume;
	const taskStatusById = readProjectTaskStatusById(ctx.cwd);
	const preferredTaskIds = readProjectPreferredActiveTaskIds(ctx.cwd, 3);
	const excludedTaskIds = readProjectProtectedAutoResumeTaskIds(ctx.cwd);
	let handoffBoardReconciliation = resolveHandoffBoardReconciliation({
		handoff: handoffForDispatch,
		taskStatusById,
		nowMs,
		maxFreshAgeMs: config.handoffFreshMaxAgeMs,
	});
	if (!handoffBoardReconciliation.ok) {
		const reconcile = reconcileAutoResumeHandoffFocus({
			handoff: handoffForDispatch,
			taskStatusById,
			preferredTaskIds,
			maxTasks: 3,
		});
		if (reconcile.changed) {
			handoffForDispatch = {
				...handoffForDispatch,
				timestamp: new Date(nowMs).toISOString(),
				current_tasks: reconcile.nextFocus,
			};
			writeHandoffJson(ctx.cwd, handoffForDispatch);
			handoffBoardReconciliation = resolveHandoffBoardReconciliation({
				handoff: handoffForDispatch,
				taskStatusById,
				nowMs,
				maxFreshAgeMs: config.handoffFreshMaxAgeMs,
			});
		}
	}
	const handoffEvent = latestContextWatchEvent(handoffForDispatch);
	const checkpointEvidenceReady = resolveCheckpointEvidenceReadyForCalmClose({
		handoffLastEventLevel: handoffEvent?.level,
		handoffLastEventAgeMs: contextWatchEventAgeMs(handoffEvent, nowMs),
		maxCheckpointAgeMs: config.handoffFreshMaxAgeMs,
	});
	const autoResumeDecision = resolveAutoResumeDispatchDecision({
		autoResumeReady: true,
		reloadRequired: false,
		checkpointEvidenceReady,
		handoffBoardReconciled: handoffBoardReconciliation.ok,
		loopPaused,
		hasPendingMessages,
		hasRecentSteerInput: false,
		queuedLaneIntents,
	});
	const autoResumeSnapshot = buildAutoResumeDecisionSnapshot({
		nowMs,
		decision: autoResumeDecision,
		reloadRequired: false,
		checkpointEvidenceReady,
		handoffBoardReconciled: handoffBoardReconciliation.ok,
		handoffBoardReconciliationSummary: handoffBoardReconciliation.summary,
		hasPendingMessages,
		hasRecentSteerInput: false,
		queuedLaneIntents,
		timeoutPressureActive: timeoutPressure.active,
		timeoutPressureCount: timeoutPressure.count,
		timeoutPressureThreshold: timeoutPressure.threshold,
	});
	if (autoResumeDecision.shouldDispatch) {
		postReloadPendingNotifyMemory = {};
		const resumeEnvelope = buildAutoResumePromptEnvelopeFromHandoff(
			handoffForDispatch,
			config.handoffFreshMaxAgeMs,
			nowMs,
			{ taskStatusById, preferredTaskIds: preferredTaskIds.slice(0, 1), excludedTaskIds, reloadRequired: false, contextPressureActive: false },
		);
		autoResumeSnapshot.promptDiagnostics = resumeEnvelope.diagnostics;
		const clearedHandoff = clearAutoResumeAfterReloadIntent(handoffForDispatch);
		writeHandoffJson(ctx.cwd, clearedHandoff);
		(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
			"context-watchdog.auto-resume-post-reload-dispatch",
			{
				atIso: autoResumeSnapshot.atIso,
				reason: pendingAutoResumeAfterReload.reason,
				focusTasks: pendingAutoResumeAfterReload.focusTasks,
				diagnosticsSummary: summarizeAutoResumePromptDiagnostics(resumeEnvelope.diagnostics),
				preview: resumeEnvelope.prompt.slice(0, 240),
			},
		);
		pi.sendUserMessage(resumeEnvelope.prompt, { deliverAs: "followUp" });
		if (config.notify) {
			ctx.ui.notify("context-watch: post-reload auto resume queued", "info");
		}
		return {
			postReloadPendingNotifyMemory,
			lastAutoResumeAt: nowMs,
			lastAutoResumeDecision: autoResumeSnapshot,
		};
	}

	const pendingNotifyDecision = resolvePostReloadPendingNotifyDecision({
		nowMs,
		intentCreatedAtIso: pendingAutoResumeAfterReload.createdAtIso,
		reason: autoResumeSnapshot.reason,
		previous: postReloadPendingNotifyMemory,
		cooldownMs: config.cooldownMs,
		minCooldownMs: params.postReloadPendingNotifyMinCooldownMs,
	});
	if (pendingNotifyDecision.shouldEmit) {
		const incidentPacket = buildPostReloadResumeIncidentPacket({
			nowMs,
			intent: pendingAutoResumeAfterReload,
			decision: autoResumeSnapshot,
		});
		(pi as unknown as { appendEntry?: (type: string, payload: unknown) => void }).appendEntry?.(
			"context-watchdog.auto-resume-post-reload-pending",
			{
				atIso: autoResumeSnapshot.atIso,
				reason: autoResumeSnapshot.reason,
				hint: autoResumeSnapshot.hint,
				hasPendingMessages: autoResumeSnapshot.hasPendingMessages,
				queuedLaneIntents: autoResumeSnapshot.queuedLaneIntents,
				checkpointEvidenceReady: autoResumeSnapshot.checkpointEvidenceReady,
				handoffBoardReconciled: autoResumeSnapshot.handoffBoardReconciled,
				handoffBoardReconciliationSummary: autoResumeSnapshot.handoffBoardReconciliationSummary,
				incidentPacket,
			},
		);
		if (config.notify && shouldNotifyAutoResumeSuppression(autoResumeSnapshot.reason)) {
			ctx.ui.notify(
				`context-watch: post-reload auto resume pending (${autoResumeSnapshot.reason})${autoResumeSnapshot.hint ? ` · ${autoResumeSnapshot.hint}` : ""}`,
				"warning",
			);
		}
		postReloadPendingNotifyMemory = pendingNotifyDecision.next;
	}
	return {
		postReloadPendingNotifyMemory,
		lastAutoResumeDecision: autoResumeSnapshot,
		lastPostReloadIncident: buildPostReloadResumeIncidentPacket({
			nowMs,
			intent: pendingAutoResumeAfterReload,
			decision: autoResumeSnapshot,
		}),
	};
}
