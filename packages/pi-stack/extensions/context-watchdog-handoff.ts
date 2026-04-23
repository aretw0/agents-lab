export type HandoffFreshnessLabel = "fresh" | "stale" | "unknown";
export type HandoffRefreshMode = "none" | "auto-on-compact" | "manual" | "unknown";

type ContextWatchdogLevel = "ok" | "warn" | "checkpoint" | "compact";

const CONTEXT_WATCH_ACTION_PREFIX = "Context-watch action:";

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function truncateForPrompt(value: string, max = 180): string {
	const s = String(value ?? "").trim().replace(/\s+/g, " ");
	if (s.length <= max) return s;
	return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function latestContextWatchLevelFromHandoff(
	handoffInput: Record<string, unknown>,
): ContextWatchdogLevel | undefined {
	const events = handoffInput.context_watch_events;
	if (!Array.isArray(events) || events.length === 0) return undefined;
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const row = events[i];
		if (!row || typeof row !== "object") continue;
		const level = (row as Record<string, unknown>).level;
		if (
			level === "ok" ||
			level === "warn" ||
			level === "checkpoint" ||
			level === "compact"
		) {
			return level;
		}
	}
	return undefined;
}

function buildResumeCadenceGuidanceLine(
	handoffInput: Record<string, unknown>,
): string {
	const lastLevel = latestContextWatchLevelFromHandoff(handoffInput);
	if (lastLevel === "ok") {
		return "Cadence: context already healthy — proceed with standard slices (2-4 files + focused tests), preserving canonical board/verification flow.";
	}
	return "Cadence: adaptive on resume — check `context_watch_status`; if level=ok, use standard slices (2-4 files + focused tests); if warn/checkpoint/compact, keep micro-slice-only until checkpoint/compact stabilizes.";
}

export function resolveHandoffFreshness(
	timestampIso: string | undefined,
	nowMs = Date.now(),
	maxFreshAgeMs = 30 * 60 * 1000,
): { label: HandoffFreshnessLabel; ageMs?: number } {
	if (!timestampIso) return { label: "unknown" };
	const ts = Date.parse(timestampIso);
	if (!Number.isFinite(ts)) return { label: "unknown" };
	const ageMs = Math.max(0, nowMs - ts);
	return {
		label: ageMs <= maxFreshAgeMs ? "fresh" : "stale",
		ageMs,
	};
}

export function handoffRefreshMode(
	freshnessLabel: HandoffFreshnessLabel,
	autoResumeEnabled: boolean,
): HandoffRefreshMode {
	if (freshnessLabel === "fresh") return "none";
	if (freshnessLabel === "unknown") return "unknown";
	return autoResumeEnabled ? "auto-on-compact" : "manual";
}

export function handoffFreshnessAdvice(
	freshnessLabel: HandoffFreshnessLabel,
	autoResumeEnabled: boolean,
): string {
	const mode = handoffRefreshMode(freshnessLabel, autoResumeEnabled);
	if (mode === "none") return "handoff fresh for resume.";
	if (mode === "unknown") return "handoff timestamp unavailable.";
	if (mode === "auto-on-compact") {
		return "handoff stale; auto-refresh runs before auto-compact resume.";
	}
	return "handoff stale; refresh checkpoint before manual resume.";
}

export function toAgeSec(valueMs: number | undefined): number | undefined {
	if (!Number.isFinite(valueMs)) return undefined;
	return Math.ceil(Math.max(0, Number(valueMs)) / 1000);
}

export function buildAutoResumePromptFromHandoff(
	handoffInput: Record<string, unknown> | undefined,
	maxFreshAgeMs = 30 * 60 * 1000,
	nowMs = Date.now(),
): string {
	const handoff = (handoffInput && typeof handoffInput === "object") ? handoffInput : {};
	const timestamp = typeof handoff.timestamp === "string" && handoff.timestamp
		? handoff.timestamp
		: undefined;
	const freshness = resolveHandoffFreshness(timestamp, nowMs, maxFreshAgeMs);
	const freshnessText = freshness.label === "unknown"
		? "unknown"
		: `${freshness.label}${freshness.ageMs !== undefined ? ` ageSec=${Math.ceil(freshness.ageMs / 1000)}` : ""}`;
	const tasks = normalizeStringArray(handoff.current_tasks).slice(0, 3);
	const blockers = normalizeStringArray(handoff.blockers)
		.filter((b) => !b.startsWith("context-watch-"))
		.slice(0, 2)
		.map((b) => truncateForPrompt(b, 80));
	const next = normalizeStringArray(handoff.next_actions)
		.filter((line) => !line.startsWith(CONTEXT_WATCH_ACTION_PREFIX))
		.slice(0, 2)
		.map((line) => truncateForPrompt(line, 120));

	return [
		`context-watch auto-resume: continue from .project/handoff.json (ts=${timestamp ?? "unknown"}, freshness=${freshnessText}).`,
		`focusTasks: ${tasks.length > 0 ? tasks.join(", ") : "none-listed"}`,
		`blockers: ${blockers.length > 0 ? blockers.join(" | ") : "none"}`,
		next.length > 0 ? `next: ${next.join(" | ")}` : "next: keep current lane intent",
		freshness.label === "stale"
			? "note: handoff is stale; refresh checkpoint if resumed context conflicts."
			: "note: handoff freshness acceptable for resume.",
		buildResumeCadenceGuidanceLine(handoff),
	].join("\n");
}
