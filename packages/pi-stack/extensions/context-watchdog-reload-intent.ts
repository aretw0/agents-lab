export type AutoResumeAfterReloadIntentReason = "reload-required-after-compact";

export type AutoResumeAfterReloadIntent = {
	pending: true;
	createdAtIso: string;
	reason: AutoResumeAfterReloadIntentReason;
	focusTasks: string[];
};

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
