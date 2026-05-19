import { resolvePreCompactReloadSignal, type ContextWatchdogLevel, type PreCompactReloadSignalReason } from "./context-watchdog-resume";
import { GUARDRAILS_AUTHORIZATION_NONE } from "./guardrails-core-authorization";

export type AutoResumeAfterReloadIntentReason = "reload-required-after-compact";

export type AutoResumeAfterReloadIntent = {
	pending: true;
	createdAtIso: string;
	reason: AutoResumeAfterReloadIntentReason;
	focusTasks: string[];
};

export type ReloadBeforeCompactDecision =
	| "not-needed"
	| "continue-local-safe-short"
	| "checkpoint-and-request-reload";

export type ReloadBeforeCompactPacket = {
	mode: "report-only";
	effect: "none";
	authorization: typeof GUARDRAILS_AUTHORIZATION_NONE;
	dispatchAllowed: false;
	mutationAllowed: false;
	reloadRequired: boolean;
	reloadGate: PreCompactReloadSignalReason;
	contextLevel: ContextWatchdogLevel;
	contextPercent: number;
	handoffFreshness: string;
	checkpointFresh: boolean;
	pendingSourceOrToolChanges: boolean;
	operatorActionRequired: boolean;
	checkpointRequired: boolean;
	reloadRequestRequired: boolean;
	decision: ReloadBeforeCompactDecision;
	nextAction: string;
	summary: string;
};

function normalizeLevel(value: unknown): ContextWatchdogLevel {
	return value === "warn" || value === "checkpoint" || value === "compact" ? value : "ok";
}

function normalizePercent(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 0;
	return Math.max(0, Math.min(100, Number(parsed.toFixed(1))));
}

function normalizeHandoffFreshness(value: unknown): string {
	const text = typeof value === "string" ? value.trim() : "";
	return text.length > 0 ? text : "unknown";
}

export function buildReloadBeforeCompactPacket(input: {
	contextLevel?: ContextWatchdogLevel | string;
	contextPercent?: number;
	reloadRequired?: boolean;
	handoffFreshness?: string;
	checkpointFresh?: boolean;
	pendingSourceOrToolChanges?: boolean;
}): ReloadBeforeCompactPacket {
	const contextLevel = normalizeLevel(input.contextLevel);
	const contextPercent = normalizePercent(input.contextPercent);
	const reloadRequired = input.reloadRequired === true;
	const checkpointFresh = input.checkpointFresh === true;
	const handoffFreshness = normalizeHandoffFreshness(input.handoffFreshness);
	const pendingSourceOrToolChanges = input.pendingSourceOrToolChanges === true || reloadRequired;
	const reloadSignal = resolvePreCompactReloadSignal({
		assessmentLevel: contextLevel,
		reloadRequired,
	});
	let decision: ReloadBeforeCompactDecision = "not-needed";
	let nextAction = "continue; runtime reload is not required.";
	let checkpointRequired = false;
	let reloadRequestRequired = false;

	if (reloadRequired && !reloadSignal.active) {
		decision = "continue-local-safe-short";
		nextAction = "continue one short local-safe slice; request /reload before starting long-run or compact-bound work.";
		reloadRequestRequired = true;
	} else if (reloadSignal.active) {
		decision = "checkpoint-and-request-reload";
		checkpointRequired = !checkpointFresh || handoffFreshness !== "fresh";
		reloadRequestRequired = true;
		nextAction = checkpointRequired
			? "write a compact checkpoint, ask the operator for /reload, then resume from handoff."
			: "ask the operator for /reload before compact/auto-resume; checkpoint evidence is already fresh.";
	}

	const operatorActionRequired = checkpointRequired || reloadRequestRequired;
	const summary = [
		"reload-before-compact:",
		`decision=${decision}`,
		`reloadGate=${reloadSignal.reason}`,
		`level=${contextLevel}`,
		`percent=${contextPercent}`,
		`handoff=${handoffFreshness}`,
		`checkpointFresh=${checkpointFresh ? "yes" : "no"}`,
		`sourceChanges=${pendingSourceOrToolChanges ? "yes" : "no"}`,
		"dispatch=no",
		`authorization=${GUARDRAILS_AUTHORIZATION_NONE}`,
	].join(" ");

	return {
		mode: "report-only",
		effect: "none",
		authorization: GUARDRAILS_AUTHORIZATION_NONE,
		dispatchAllowed: false,
		mutationAllowed: false,
		reloadRequired,
		reloadGate: reloadSignal.reason,
		contextLevel,
		contextPercent,
		handoffFreshness,
		checkpointFresh,
		pendingSourceOrToolChanges,
		operatorActionRequired,
		checkpointRequired,
		reloadRequestRequired,
		decision,
		nextAction,
		summary,
	};
}

export function readAutoResumeAfterReloadIntent(
	handoffInput: Record<string, unknown> | undefined,
): AutoResumeAfterReloadIntent | undefined {
	const handoff = handoffInput && typeof handoffInput === "object" ? handoffInput : {};
	const contextWatch = handoff.context_watch && typeof handoff.context_watch === "object"
		? handoff.context_watch as Record<string, unknown>
		: undefined;
	const intent = contextWatch?.auto_resume_after_reload && typeof contextWatch.auto_resume_after_reload === "object"
		? contextWatch.auto_resume_after_reload as Record<string, unknown>
		: undefined;
	if (!intent || intent.pending !== true) return undefined;
	const createdAtIso = typeof intent.createdAtIso === "string" && intent.createdAtIso.trim().length > 0
		? intent.createdAtIso
		: new Date(0).toISOString();
	const reason = intent.reason === "reload-required-after-compact"
		? intent.reason
		: "reload-required-after-compact";
	const focusTasks = Array.isArray(intent.focusTasks)
		? intent.focusTasks
			.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			.slice(0, 3)
		: [];
	return {
		pending: true,
		createdAtIso,
		reason,
		focusTasks,
	};
}

export function withAutoResumeAfterReloadIntent(
	handoffInput: Record<string, unknown> | undefined,
	intent: AutoResumeAfterReloadIntent,
): Record<string, unknown> {
	const next = handoffInput && typeof handoffInput === "object"
		? { ...handoffInput }
		: {};
	const contextWatch = next.context_watch && typeof next.context_watch === "object"
		? { ...(next.context_watch as Record<string, unknown>) }
		: {};
	contextWatch.auto_resume_after_reload = {
		pending: true,
		createdAtIso: intent.createdAtIso,
		reason: intent.reason,
		...(intent.focusTasks.length > 0 ? { focusTasks: intent.focusTasks.slice(0, 3) } : {}),
	};
	next.context_watch = contextWatch;
	return next;
}

export function clearAutoResumeAfterReloadIntent(
	handoffInput: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const next = handoffInput && typeof handoffInput === "object"
		? { ...handoffInput }
		: {};
	if (!next.context_watch || typeof next.context_watch !== "object") return next;
	const contextWatch = { ...(next.context_watch as Record<string, unknown>) };
	if (!("auto_resume_after_reload" in contextWatch)) return next;
	delete contextWatch.auto_resume_after_reload;
	if (Object.keys(contextWatch).length > 0) {
		next.context_watch = contextWatch;
	} else {
		delete next.context_watch;
	}
	return next;
}
