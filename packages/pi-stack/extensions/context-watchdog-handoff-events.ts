export type ContextWatchdogLevel = "ok" | "warn" | "checkpoint" | "compact";

export type ContextWatchThresholds = {
	warnPct: number;
	checkpointPct: number;
	compactPct: number;
};

export type ContextWatchAssessmentLike = {
	percent: number;
	level: ContextWatchdogLevel;
	thresholds: ContextWatchThresholds;
	action: string;
	recommendation: string;
};

export type ContextWatchHandoffReason = "session_start" | "message_end" | "auto_compact_prep";

export type ContextWatchHandoffEvent = {
	atIso: string;
	reason: ContextWatchHandoffReason;
	level: ContextWatchdogLevel;
	percent: number;
	thresholds: ContextWatchThresholds;
	action: string;
	recommendation: string;
};

export type CompactCheckpointPersistenceReason =
	| "level-not-compact"
	| "missing-compact-event"
	| "stale-compact-event"
	| "compact-event-fresh";

const CONTEXT_WATCH_ACTION_PREFIX = "Context-watch action:";
const CONTEXT_WATCH_BLOCKER_PREFIX = "context-watch-";
const CONTEXT_WATCH_EVENTS_KEY = "context_watch_events";
const CONTEXT_WATCH_EVENTS_MAX = 12;

function contextWatchActionForLevel(level: ContextWatchdogLevel): string {
	switch (level) {
		case "compact":
			return "compact-now";
		case "checkpoint":
			return "write-checkpoint";
		case "warn":
			return "micro-slice-only";
		default:
			return "continue";
	}
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function normalizeContextWatchEventList(value: unknown): ContextWatchHandoffEvent[] {
	if (!Array.isArray(value)) return [];
	const out: ContextWatchHandoffEvent[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		const level = row.level;
		if (level !== "ok" && level !== "warn" && level !== "checkpoint" && level !== "compact") {
			continue;
		}
		const percent = Number(row.percent);
		const thresholdsRaw = row.thresholds as Record<string, unknown> | undefined;
		const warnPct = Number(thresholdsRaw?.warnPct);
		const checkpointPct = Number(thresholdsRaw?.checkpointPct);
		const compactPct = Number(thresholdsRaw?.compactPct);
		if (!Number.isFinite(percent) || !Number.isFinite(warnPct) || !Number.isFinite(checkpointPct) || !Number.isFinite(compactPct)) {
			continue;
		}
		const reason = row.reason === "session_start"
			? "session_start"
			: row.reason === "auto_compact_prep"
				? "auto_compact_prep"
				: "message_end";
		out.push({
			atIso: typeof row.atIso === "string" && row.atIso ? row.atIso : new Date().toISOString(),
			reason,
			level,
			percent: Math.max(0, Math.min(100, Math.floor(percent))),
			thresholds: {
				warnPct: Math.max(1, Math.min(99, Math.floor(warnPct))),
				checkpointPct: Math.max(1, Math.min(99, Math.floor(checkpointPct))),
				compactPct: Math.max(1, Math.min(100, Math.floor(compactPct))),
			},
			action: typeof row.action === "string" ? row.action : contextWatchActionForLevel(level),
			recommendation:
				typeof row.recommendation === "string" ? row.recommendation : "",
		});
	}
	return out.slice(-CONTEXT_WATCH_EVENTS_MAX);
}

function contextWatchActionLine(assessment: ContextWatchAssessmentLike): string {
	return `${CONTEXT_WATCH_ACTION_PREFIX} level=${assessment.level} ${assessment.percent}% (${assessment.action}) · ${assessment.recommendation}`;
}

function contextWatchBlockersForLevel(level: ContextWatchdogLevel): string[] {
	if (level === "compact") return ["context-watch-compact-required"];
	if (level === "checkpoint") return ["context-watch-checkpoint-required"];
	if (level === "warn") return ["context-watch-warn-active"];
	return [];
}

export function resolveCompactCheckpointPersistence(input: {
	assessmentLevel: ContextWatchdogLevel;
	handoffLastEventLevel?: ContextWatchdogLevel;
	handoffLastEventAgeMs?: number;
	maxCheckpointAgeMs?: number;
}): { shouldPersist: boolean; reason: CompactCheckpointPersistenceReason } {
	if (input.assessmentLevel !== "compact") {
		return { shouldPersist: false, reason: "level-not-compact" };
	}
	if (input.handoffLastEventLevel !== "compact") {
		return { shouldPersist: true, reason: "missing-compact-event" };
	}
	const ageMs = Number(input.handoffLastEventAgeMs);
	const maxAgeMs = Math.max(1_000, Math.floor(Number(input.maxCheckpointAgeMs ?? 60_000)));
	if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
		return { shouldPersist: true, reason: "stale-compact-event" };
	}
	return { shouldPersist: false, reason: "compact-event-fresh" };
}

export function applyContextWatchToHandoff(
	handoffInput: Record<string, unknown> | undefined,
	assessment: ContextWatchAssessmentLike,
	reason: ContextWatchHandoffReason,
	atIso: string,
): Record<string, unknown> {
	const base = (handoffInput && typeof handoffInput === "object")
		? { ...handoffInput }
		: {};
	const actionLine = contextWatchActionLine(assessment);

	const nextActions = normalizeStringArray(base.next_actions)
		.filter((entry) => !entry.startsWith(CONTEXT_WATCH_ACTION_PREFIX));
	if (assessment.level !== "ok") nextActions.unshift(actionLine);
	if (nextActions.length > 0) {
		base.next_actions = nextActions.slice(0, 20);
	} else {
		delete base.next_actions;
	}

	const blockers = normalizeStringArray(base.blockers)
		.filter((entry) => !entry.startsWith(CONTEXT_WATCH_BLOCKER_PREFIX));
	const contextBlockers = contextWatchBlockersForLevel(assessment.level);
	if (contextBlockers.length > 0) blockers.unshift(...contextBlockers);
	if (blockers.length > 0) {
		base.blockers = Array.from(new Set(blockers)).slice(0, 20);
	} else {
		delete base.blockers;
	}

	const event: ContextWatchHandoffEvent = {
		atIso,
		reason,
		level: assessment.level,
		percent: assessment.percent,
		thresholds: assessment.thresholds,
		action: assessment.action,
		recommendation: assessment.recommendation,
	};
	const events = normalizeContextWatchEventList(base[CONTEXT_WATCH_EVENTS_KEY]);
	events.push(event);
	base[CONTEXT_WATCH_EVENTS_KEY] = events.slice(-CONTEXT_WATCH_EVENTS_MAX);

	base.timestamp = atIso;
	if (typeof base.context !== "string" || base.context.trim().length === 0) {
		base.context = "Context-watch tracking active: maintain continuity under context pressure.";
	}
	return base;
}

export function latestContextWatchEvent(
	handoffInput: Record<string, unknown> | undefined,
): Pick<ContextWatchHandoffEvent, "atIso" | "reason" | "level" | "action"> | undefined {
	const handoff = (handoffInput && typeof handoffInput === "object") ? handoffInput : {};
	const events = normalizeContextWatchEventList(handoff[CONTEXT_WATCH_EVENTS_KEY]);
	const last = events.at(-1);
	if (!last) return undefined;
	return {
		atIso: last.atIso,
		reason: last.reason,
		level: last.level,
		action: last.action,
	};
}

export function summarizeContextWatchEvent(
	event: Pick<ContextWatchHandoffEvent, "atIso" | "reason" | "level" | "action"> | undefined,
): string {
	if (!event) return "none";
	return `${event.reason} level=${event.level} action=${event.action} at=${event.atIso}`;
}

export function contextWatchEventAgeMs(
	event: Pick<ContextWatchHandoffEvent, "atIso"> | undefined,
	nowMs = Date.now(),
): number | undefined {
	if (!event?.atIso) return undefined;
	const ts = Date.parse(event.atIso);
	if (!Number.isFinite(ts)) return undefined;
	return Math.max(0, nowMs - ts);
}
