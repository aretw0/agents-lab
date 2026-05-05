import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parseBudgetOverrideReason } from "./colony-pilot";
import { appendAuditEntry } from "./guardrails-core-confirmation-audit";
import { buildBoardExecuteNextIntent, buildGuardrailsIntentSystemPrompt, encodeGuardrailsIntent, parseGuardrailsIntent, summarizeGuardrailsIntent } from "./guardrails-core-intent-bus";
import { resolveGuardrailsIntentRuntimeDecision } from "./guardrails-core-intent-runtime";
import { buildBehaviorRouteSystemPrompt, classifyBehaviorRoute } from "./guardrails-core-behavior-routing";
import { buildShellRoutingSystemPrompt, type CommandRoutingProfile } from "./guardrails-core-shell-routing";
import { buildI18nIntentSystemPrompt, summarizeI18nIntentConfig, type I18nIntentConfig } from "./guardrails-core-i18n-intents";
import { buildPragmaticAutonomySystemPrompt, type PragmaticAutonomyConfig } from "./guardrails-core-runtime-config";
import { buildBoardReadinessStatusLabel, evaluateBoardLongRunReadiness } from "./guardrails-core-board-readiness";
import {
	buildCodeBloatStatusLabel,
	buildTextBloatStatusLabel,
	buildWideSingleFileSliceStatusLabel,
	estimateCodeBloatFromEditInput,
	estimateCodeBloatFromWriteInput,
	evaluateCodeBloatSmell,
	evaluateTextBloatSmell,
	evaluateWideSingleFileSlice,
	extractAssistantTextFromTurnMessage,
	shouldEmitBloatSmellSignal,
	summarizeAssumptionText,
	type BloatSmellConfig,
} from "./guardrails-core-bloat";
import { normalizeCmdName, shouldAnnounceStrictInteractiveMode } from "./guardrails-core-command-utils";
import {
	enqueueDeferredIntent,
	extractForceNowText,
	shouldQueueInputForLongRun,
	type LongRunIntentQueueConfig,
	type LongRunLoopRuntimeState,
} from "./guardrails-core-lane-queue";
import { providerBudgetGovernorMisconfigReason, type ProviderBudgetGovernorConfig, type ProviderBudgetGovernorMisconfig, type ProviderBudgetGovernorSnapshot } from "./guardrails-core-provider-budget-governor";

export interface GuardrailsCoreEventSurfaceRuntime {
	getStrictInteractiveMode(): boolean;
	setStrictInteractiveMode(value: boolean): void;
	getStrictInteractiveAnnounced(): boolean;
	setStrictInteractiveAnnounced(value: boolean): void;
	getShellRoutingProfile(): CommandRoutingProfile;
	getLongRunIntentQueueConfig(): LongRunIntentQueueConfig;
	getPragmaticAutonomyConfig(): PragmaticAutonomyConfig;
	getI18nIntentConfig(): I18nIntentConfig;
	getBloatSmellConfig(): BloatSmellConfig;
	getProviderBudgetGovernorConfig(): ProviderBudgetGovernorConfig;
	getProviderBudgetGovernorMisconfig(): ProviderBudgetGovernorMisconfig | undefined;
	getLongRunLoopRuntimeState(): LongRunLoopRuntimeState;
	resolveProviderBudgetSnapshot(ctx: ExtensionContext): Promise<ProviderBudgetGovernorSnapshot | undefined>;
	setLastLongRunBusyAt(value: number): void;
	setLastForceNowAt(value: number): void;
	setLastForceNowTextPreview(value: string | undefined): void;
	getTextBloatSignal(): { at: number; key?: string };
	setTextBloatSignal(value: { at: number; key?: string }): void;
	getCodeBloatSignal(): { at: number; key?: string };
	setCodeBloatSignal(value: { at: number; key?: string }): void;
	getWideSliceSignal(): { at: number; key?: string };
	setWideSliceSignal(value: { at: number; key?: string }): void;
	clearAutoDrainTimer(): void;
	refreshLoopLeaseOnActivity(ctx: ExtensionContext, reason: string, minIntervalMs?: number): void;
	updateLongRunLaneStatus(ctx: ExtensionContext, activeLongRun: boolean, runtimeState?: LongRunLoopRuntimeState): void;
	scheduleAutoDrainDeferredIntent(ctx: ExtensionContext, reason: "agent_end" | "lane_pop" | "idle_timer", delayOverrideMs?: number): void;
}

export function registerGuardrailsCoreEventSurface(pi: ExtensionAPI, runtime: GuardrailsCoreEventSurfaceRuntime): void {
	pi.on("before_agent_start", async (event, ctx) => {
		runtime.setLastLongRunBusyAt(Date.now());
		runtime.clearAutoDrainTimer();
		runtime.refreshLoopLeaseOnActivity(ctx, "agent-start-lease-heartbeat", 5_000);
		const decision = classifyRouting(event.prompt ?? "");
		runtime.setStrictInteractiveMode(decision.strictMode);
		const strictInteractiveMode = runtime.getStrictInteractiveMode();

		const systemPromptParts: string[] = [event.systemPrompt ?? ""];
		const pragmaticAutonomyConfig = runtime.getPragmaticAutonomyConfig();
		const autonomyPrompt = buildPragmaticAutonomySystemPrompt(pragmaticAutonomyConfig);
		if (autonomyPrompt) {
			systemPromptParts.push("", autonomyPrompt);
			if (pragmaticAutonomyConfig.auditAssumptions) {
				appendAuditEntry(ctx, "guardrails-core.pragmatic-autonomy-policy", {
					atIso: new Date().toISOString(),
					noObviousQuestions: pragmaticAutonomyConfig.noObviousQuestions,
					strictInteractiveMode,
				});
			}
		}

		const i18nIntentConfig = runtime.getI18nIntentConfig();
		const i18nPrompt = buildI18nIntentSystemPrompt(i18nIntentConfig);
		if (i18nPrompt.length > 0) {
			systemPromptParts.push("", ...i18nPrompt);
			appendAuditEntry(ctx, "guardrails-core.i18n-intent-policy", {
				atIso: new Date().toISOString(),
				summary: summarizeI18nIntentConfig(i18nIntentConfig),
			});
		}

		const parsedIntent = parseGuardrailsIntent(event.prompt ?? "");
		if (parsedIntent.ok && parsedIntent.intent) {
			systemPromptParts.push("", ...buildGuardrailsIntentSystemPrompt(parsedIntent.intent));
			appendAuditEntry(ctx, "guardrails-core.intent-envelope-detected", {
				atIso: new Date().toISOString(),
				intentType: parsedIntent.intent.type,
				intentSummary: summarizeGuardrailsIntent(parsedIntent.intent),
			});
		}

		const behaviorRoute = parsedIntent.ok ? { kind: "none" as const } : classifyBehaviorRoute(event.prompt ?? "");
		const shellRoutingPrompt = buildShellRoutingSystemPrompt(runtime.getShellRoutingProfile());
		if (behaviorRoute.kind === "matched" && behaviorRoute.match) {
			systemPromptParts.push("", ...buildBehaviorRouteSystemPrompt(behaviorRoute.match));
			ctx.ui?.setStatus?.("guardrails-core-behavior", `[behavior] ${behaviorRoute.match.skill} (${behaviorRoute.match.confidence})`);
			appendAuditEntry(ctx, "guardrails-core.behavior-route-selected", {
				atIso: new Date().toISOString(),
				skill: behaviorRoute.match.skill,
				confidence: behaviorRoute.match.confidence,
				score: behaviorRoute.match.score,
				reasons: behaviorRoute.match.reasons,
			});
		} else {
			ctx.ui?.setStatus?.("guardrails-core-behavior", undefined);
		}

		if (shellRoutingPrompt.length > 0) systemPromptParts.push("", ...shellRoutingPrompt);
		if (!strictInteractiveMode) {
			ctx.ui?.setStatus?.("guardrails-core", undefined);
			if (!autonomyPrompt && i18nPrompt.length === 0 && !parsedIntent.ok && shellRoutingPrompt.length === 0) return undefined;
			return { systemPrompt: systemPromptParts.join("\n") };
		}

		const domains = decision.domains.length > 0 ? decision.domains.join(", ") : "(none)";
		ctx.ui?.setStatus?.("guardrails-core", "[guardrails] strict_interactive=on");
		if (shouldAnnounceStrictInteractiveMode(runtime.getStrictInteractiveAnnounced(), strictInteractiveMode)) {
			runtime.setStrictInteractiveAnnounced(true);
			ctx.ui?.notify?.(`guardrails-core: strict web mode ativo (interactive+sensitive). domains=${domains}`, "info");
		}
		systemPromptParts.push(
			"",
			"Scoped hard routing guard (deterministic) is active for this turn.",
			"- For this task, start with web-browser CDP scripts only.",
			"- Do not use curl/wget/python-requests/r.jina.ai/npm view/registry.npmjs.org as primary path.",
			"- If CDP path fails, explain failure explicitly before proposing fallback.",
		);
		return { systemPrompt: systemPromptParts.join("\n") };
	});

	pi.on("input", async (event, ctx) => {
		const inputText = event.text ?? "";
		const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
		if (activeLongRun) {
			runtime.setLastLongRunBusyAt(Date.now());
			runtime.clearAutoDrainTimer();
			runtime.refreshLoopLeaseOnActivity(ctx, "input-activity-lease-heartbeat", 10_000);
		}
		if (event.source === "interactive" && inputText.trim().length > 0) {
			runtime.refreshLoopLeaseOnActivity(ctx, "interactive-input-lease-heartbeat", 10_000);
		}
		runtime.updateLongRunLaneStatus(ctx, activeLongRun, runtime.getLongRunLoopRuntimeState());
		const maybeIntentEnvelope = inputText.trim().toLowerCase().startsWith("[intent:");
		const parsedInputIntent = parseGuardrailsIntent(inputText);
		const intentMilestone = parsedInputIntent.ok && parsedInputIntent.intent?.type === "board.execute-next" ? parsedInputIntent.intent.milestone : undefined;
		const boardReadinessForIntent = maybeIntentEnvelope ? evaluateBoardLongRunReadiness(ctx.cwd, { sampleLimit: 1, milestone: intentMilestone }) : undefined;
		const intentRuntimeDecision = resolveGuardrailsIntentRuntimeDecision({
			text: inputText,
			parsed: parsedInputIntent,
			boardReady: boardReadinessForIntent?.ready,
			nextTaskId: boardReadinessForIntent?.nextTaskId,
		});
		if (intentRuntimeDecision.kind === "non-intent") {
			ctx.ui?.setStatus?.("guardrails-core-intent", undefined);
		} else if (intentRuntimeDecision.action === "reject") {
			ctx.ui?.setStatus?.("guardrails-core-intent", undefined);
			appendAuditEntry(ctx, "guardrails-core.intent-envelope-runtime-rejected", { atIso: new Date().toISOString(), reason: intentRuntimeDecision.reason, rawType: intentRuntimeDecision.rawType });
			ctx.ui.notify([`guardrails-core: intent envelope rejected (${intentRuntimeDecision.reason ?? "invalid-envelope"}).`, "Use /lane-queue board-next para emitir um envelope canônico válido."].join("\n"), "warning");
			return { action: "handled" as const };
		} else if (parsedInputIntent.ok && parsedInputIntent.intent) {
			const intentSummary = summarizeGuardrailsIntent(parsedInputIntent.intent);
			const runtimeTaskId = intentRuntimeDecision.taskId;
			const expectedTaskId = intentRuntimeDecision.expectedTaskId;
			const scopedMilestone = intentRuntimeDecision.milestone ?? intentMilestone;
			const statusSuffix = scopedMilestone ? ` milestone=${scopedMilestone}` : "";
			const statusLine = expectedTaskId && runtimeTaskId && expectedTaskId !== runtimeTaskId
				? `[intent] ${parsedInputIntent.intent.type} task=${runtimeTaskId} expected=${expectedTaskId}${statusSuffix}`
				: runtimeTaskId ? `[intent] ${parsedInputIntent.intent.type} task=${runtimeTaskId}${statusSuffix}`
					: expectedTaskId ? `[intent] ${parsedInputIntent.intent.type} expected=${expectedTaskId}${statusSuffix}`
						: `[intent] ${parsedInputIntent.intent.type}${statusSuffix}`;
			ctx.ui?.setStatus?.("guardrails-core-intent", statusLine);
			appendAuditEntry(ctx, "guardrails-core.intent-envelope-runtime-consumed", {
				atIso: new Date().toISOString(),
				decision: intentRuntimeDecision.kind,
				intentType: parsedInputIntent.intent.type,
				intentSummary,
				boardReady: boardReadinessForIntent?.ready,
				boardNextTaskId: boardReadinessForIntent?.nextTaskId,
				milestone: scopedMilestone,
			});
			if (intentRuntimeDecision.kind === "board-execute-board-not-ready") {
				ctx.ui.notify(["guardrails-core: board.execute-task recebido com board não pronto.", `boardHint: ${boardReadinessForIntent?.recommendation ?? "decompose planned work into executable slices."}`].join("\n"), "warning");
			} else if (intentRuntimeDecision.kind === "board-execute-next-mismatch") {
				ctx.ui.notify(`guardrails-core: board.execute-task task=${runtimeTaskId ?? "n/a"} difere do next=${expectedTaskId ?? "n/a"}; seguindo por override explícito.`, "info");
			} else if (intentRuntimeDecision.kind === "board-execute-next-board-not-ready") {
				ctx.ui.notify([`guardrails-core: board.execute-next recebido com board não pronto${scopedMilestone ? ` (milestone=${scopedMilestone})` : ""}.`, `boardHint: ${boardReadinessForIntent?.recommendation ?? "decompose planned work into executable slices."}`].join("\n"), "warning");
			} else if (intentRuntimeDecision.kind === "board-execute-next-ready") {
				ctx.ui.notify(`guardrails-core: board.execute-next resolvido para next=${expectedTaskId ?? runtimeTaskId ?? "n/a"}${scopedMilestone ? ` (milestone=${scopedMilestone})` : ""}.`, "info");
			}
		}
		const longRunIntentQueueConfig = runtime.getLongRunIntentQueueConfig();
		const pragmaticAutonomyConfig = runtime.getPragmaticAutonomyConfig();
		if (event.source === "interactive") {
			const forceNowText = extractForceNowText(inputText, longRunIntentQueueConfig);
			if (forceNowText !== undefined) {
				if (!forceNowText) {
					ctx.ui.notify(`lane-now override vazio; use '${longRunIntentQueueConfig.forceNowPrefix}<mensagem>' para forçar processamento imediato.`, "warning");
					return { action: "handled" as const };
				}
				const nowIso = new Date().toISOString();
				runtime.setLastForceNowAt(Date.parse(nowIso));
				runtime.setLastForceNowTextPreview(summarizeAssumptionText(forceNowText, pragmaticAutonomyConfig.maxAuditTextChars));
				appendAuditEntry(ctx, "guardrails-core.long-run-intent-force-now", { atIso: nowIso, activeLongRun, textPreview: summarizeAssumptionText(forceNowText, pragmaticAutonomyConfig.maxAuditTextChars) });
				pi.sendUserMessage(forceNowText, { deliverAs: "followUp" });
				ctx.ui.notify(activeLongRun ? "lane-now: override aplicado; mensagem enviada como follow-up imediato." : "lane-now: override aplicado; mensagem enviada para processamento imediato.", "info");
				return { action: "handled" as const };
			}
		}

		if (event.source === "interactive" && shouldQueueInputForLongRun(inputText, activeLongRun, longRunIntentQueueConfig)) {
			const queueSource = parsedInputIntent.ok && parsedInputIntent.intent ? `intent:${parsedInputIntent.intent.type}` : event.source ?? "interactive";
			const queued = enqueueDeferredIntent(ctx.cwd, inputText, queueSource, longRunIntentQueueConfig.maxItems);
			appendAuditEntry(ctx, "guardrails-core.long-run-intent-queued", {
				atIso: new Date().toISOString(),
				itemId: queued.itemId,
				queuedCount: queued.queuedCount,
				queuePath: queued.queuePath,
				activeLongRun,
				intentType: parsedInputIntent.ok ? parsedInputIntent.intent?.type : undefined,
				intentSummary: parsedInputIntent.ok && parsedInputIntent.intent ? summarizeGuardrailsIntent(parsedInputIntent.intent) : undefined,
			});
			if (pragmaticAutonomyConfig.enabled && pragmaticAutonomyConfig.auditAssumptions) {
				appendAuditEntry(ctx, "guardrails-core.pragmatic-assumption-applied", { atIso: new Date().toISOString(), assumption: "defer-noncritical-interrupt", itemId: queued.itemId, queuedCount: queued.queuedCount, activeLongRun, textPreview: summarizeAssumptionText(inputText, pragmaticAutonomyConfig.maxAuditTextChars) });
			}
			runtime.updateLongRunLaneStatus(ctx, activeLongRun, runtime.getLongRunLoopRuntimeState());
			ctx.ui.notify(["Long-run ativo: solicitação registrada na fila sem trocar de foco.", "Assunção automática: ambiguidades de baixo risco foram deferidas sem interromper o lane atual.", `queued=${queued.queuedCount}`, `use '${longRunIntentQueueConfig.forceNowPrefix}<mensagem>' para forçar processamento imediato.`].join("\n"), "info");
			return { action: "handled" as const };
		}

		const providerBudgetGovernorConfig = runtime.getProviderBudgetGovernorConfig();
		if (!providerBudgetGovernorConfig.enabled || runtime.getProviderBudgetGovernorMisconfig()) return { action: "continue" as const };
		const cmd = normalizeCmdName(event.text ?? "");
		if (cmd && providerBudgetGovernorConfig.recoveryCommands.includes(cmd)) return { action: "continue" as const };
		const currentProvider = ctx.model?.provider;
		if (!currentProvider) return { action: "continue" as const };
		const snapshot = await runtime.resolveProviderBudgetSnapshot(ctx);
		const blocked = snapshot?.budgets.find((b) => b.provider === currentProvider && b.state === "blocked");
		if (!blocked) return { action: "continue" as const };
		if (providerBudgetGovernorConfig.allowOverride) {
			const reason = parseBudgetOverrideReason(event.text ?? "", providerBudgetGovernorConfig.overrideToken);
			if (reason) {
				appendAuditEntry(ctx, "guardrails-core.provider-budget-override", { atIso: new Date().toISOString(), provider: currentProvider, reason, snapshotAtIso: snapshot?.atIso });
				ctx.ui.notify(`provider-budget override aceito para ${currentProvider}: ${reason}`, "warning");
				return { action: "continue" as const };
			}
		}
		appendAuditEntry(ctx, "guardrails-core.provider-budget-block", { atIso: new Date().toISOString(), provider: currentProvider, snapshotAtIso: snapshot?.atIso });
		ctx.ui.notify([
			`Bloqueado por provider-budget governor: ${currentProvider} está em BLOCK.`,
			`Use /quota-visibility budget ${currentProvider} ${providerBudgetGovernorConfig.lookbackDays}`,
			`Comandos de recovery permitidos: ${providerBudgetGovernorConfig.recoveryCommands.map((x) => `/${x}`).join(", ")}`,
			providerBudgetGovernorConfig.allowOverride ? `Override auditável: inclua '${providerBudgetGovernorConfig.overrideToken}<motivo>' na mensagem.` : "Override desativado pela policy.",
		].join("\n"), "warning");
		return { action: "handled" as const };
	});

	pi.on("turn_end", (event, ctx) => {
		const config = runtime.getBloatSmellConfig();
		if (!config.enabled || !config.text.enabled) return;
		const assistantText = extractAssistantTextFromTurnMessage((event as { message?: unknown })?.message);
		if (!assistantText) return;
		const assessment = evaluateTextBloatSmell(assistantText, { chars: config.text.chars, lines: config.text.lines, repeatedLineRatio: config.text.repeatedLineRatio });
		if (!assessment.triggered) {
			ctx.ui?.setStatus?.("guardrails-core-bloat", undefined);
			return;
		}
		const statusLabel = buildTextBloatStatusLabel(assessment);
		ctx.ui?.setStatus?.("guardrails-core-bloat", statusLabel);
		const nowMs = Date.now();
		const signalKey = assessment.reasons.join("|");
		const previous = runtime.getTextBloatSignal();
		if (!shouldEmitBloatSmellSignal(previous.at, previous.key, signalKey, nowMs, config.cooldownMs)) return;
		appendAuditEntry(ctx, "guardrails-core.bloat-smell-text", { atIso: new Date(nowMs).toISOString(), reasons: assessment.reasons, metrics: assessment.metrics, recommendation: assessment.recommendation, statusLabel });
		if (config.notifyOnTrigger) ctx.ui.notify([statusLabel, assessment.recommendation].join("\n"), "info");
		runtime.setTextBloatSignal({ at: nowMs, key: signalKey });
	});

	pi.on("before_provider_request", async (_event, ctx) => {
		const providerBudgetGovernorConfig = runtime.getProviderBudgetGovernorConfig();
		if (!providerBudgetGovernorConfig.enabled) return undefined;
		if (runtime.getProviderBudgetGovernorMisconfig()) {
			ctx.ui?.setStatus?.("guardrails-core-budget", "[budget] governor-misconfig");
			return undefined;
		}
		const currentProvider = ctx.model?.provider;
		if (!currentProvider) return undefined;
		const snapshot = await runtime.resolveProviderBudgetSnapshot(ctx);
		const blocked = snapshot?.budgets.find((b) => b.provider === currentProvider && b.state === "blocked");
		ctx.ui?.setStatus?.("guardrails-core-budget", blocked ? `[budget] ${currentProvider}=BLOCK` : undefined);
		return undefined;
	});
}

export function guardrailsCoreHandleStructuredMutationBloat(
	event: { input?: unknown },
	ctx: ExtensionContext,
	config: BloatSmellConfig,
	runtime: Pick<GuardrailsCoreEventSurfaceRuntime, "getCodeBloatSignal" | "setCodeBloatSignal" | "getWideSliceSignal" | "setWideSliceSignal">,
	toolType: "edit" | "write" | undefined,
): void {
	if (!config.enabled || !config.code.enabled || !toolType) return;
	const metrics = toolType === "edit" ? estimateCodeBloatFromEditInput(event.input) : estimateCodeBloatFromWriteInput(event.input);
	if (!metrics) return;
	const wideSliceAssessment = evaluateWideSingleFileSlice(metrics, { changedLines: Math.max(20, Math.floor(config.code.changedLines * 0.4)), hunks: Math.max(2, Math.floor(config.code.hunks * 0.5)) });
	if (!wideSliceAssessment.triggered) {
		ctx.ui?.setStatus?.("guardrails-core-slice-width", undefined);
	} else {
		const statusLabel = buildWideSingleFileSliceStatusLabel(wideSliceAssessment);
		ctx.ui?.setStatus?.("guardrails-core-slice-width", statusLabel);
		const nowMs = Date.now();
		const signalKey = `${toolType}:${wideSliceAssessment.reasons.join("|")}`;
		const previous = runtime.getWideSliceSignal();
		if (shouldEmitBloatSmellSignal(previous.at, previous.key, signalKey, nowMs, config.cooldownMs)) {
			appendAuditEntry(ctx, "guardrails-core.slice-wide-single-file", { atIso: new Date(nowMs).toISOString(), toolType, reasons: wideSliceAssessment.reasons, metrics: wideSliceAssessment.metrics, recommendation: wideSliceAssessment.recommendation, statusLabel });
			if (config.notifyOnTrigger) ctx.ui.notify([statusLabel, wideSliceAssessment.recommendation].join("\n"), "info");
			runtime.setWideSliceSignal({ at: nowMs, key: signalKey });
		}
	}

	const assessment = evaluateCodeBloatSmell(metrics, { changedLines: config.code.changedLines, hunks: config.code.hunks, filesTouched: config.code.filesTouched });
	if (!assessment.triggered) {
		ctx.ui?.setStatus?.("guardrails-core-bloat-code", undefined);
		return;
	}
	const statusLabel = buildCodeBloatStatusLabel(assessment);
	ctx.ui?.setStatus?.("guardrails-core-bloat-code", statusLabel);
	const nowMs = Date.now();
	const signalKey = `${toolType}:${assessment.reasons.join("|")}`;
	const previous = runtime.getCodeBloatSignal();
	if (!shouldEmitBloatSmellSignal(previous.at, previous.key, signalKey, nowMs, config.cooldownMs)) return;
	appendAuditEntry(ctx, "guardrails-core.bloat-smell-code", { atIso: new Date(nowMs).toISOString(), toolType, reasons: assessment.reasons, metrics: assessment.metrics, recommendation: assessment.recommendation, statusLabel });
	if (config.notifyOnTrigger) ctx.ui.notify([statusLabel, assessment.recommendation].join("\n"), "info");
	runtime.setCodeBloatSignal({ at: nowMs, key: signalKey });
}
