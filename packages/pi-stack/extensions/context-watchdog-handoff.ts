export type HandoffFreshnessLabel = "fresh" | "stale" | "unknown";
export type HandoffRefreshMode = "none" | "auto-on-compact" | "manual" | "unknown";

const CONTEXT_WATCH_ACTION_PREFIX = "Context-watch action:";

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function normalizePromptSegment(value: string): string {
	const raw = String(value ?? "");
	const withoutMarkdown = raw
		.replace(/`([^`]+)`/g, "$1")
		.replace(/[\u0000-\u001f\u007f]+/g, " ");
	const singleLine = withoutMarkdown.replace(/\s+/g, " ").trim();
	const normalizedPipes = singleLine.replace(/\|/g, " / ").replace(/\s+\/\s+/g, " / ");
	return normalizedPipes
		.replace(/\.\.\.+/g, "[ellipsis]")
		.replace(/…+/g, "[ellipsis]");
}

function truncateForPrompt(value: string, max = 180): string {
	const s = normalizePromptSegment(value);
	if (s.length <= max) return s;
	const keep = Math.max(1, Math.floor(max));
	const omitted = Math.max(0, s.length - keep);
	return `${s.slice(0, keep)} [truncated:+${omitted} chars]`;
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
	_maxFreshAgeMs = 30 * 60 * 1000,
	_nowMs = Date.now(),
): string {
	const handoff = (handoffInput && typeof handoffInput === "object") ? handoffInput : {};
	const timestamp = typeof handoff.timestamp === "string" && handoff.timestamp
		? handoff.timestamp
		: undefined;
	const tasks = normalizeStringArray(handoff.current_tasks)
		.slice(0, 3)
		.map((task) => truncateForPrompt(task, 48));
	const blockers = normalizeStringArray(handoff.blockers)
		.filter((b) => !b.startsWith("context-watch-"))
		.slice(0, 2)
		.map((b) => truncateForPrompt(b, 80));
	const next = normalizeStringArray(handoff.next_actions)
		.filter((line) => !line.startsWith(CONTEXT_WATCH_ACTION_PREFIX))
		.slice(0, 2)
		.map((line) => truncateForPrompt(line, 120));

	return [
		`auto-resume: continue from .project/handoff.json${timestamp ? ` (ts=${timestamp})` : ""}.`,
		`focusTasks: ${tasks.length > 0 ? tasks.join(", ") : "none-listed"}`,
		`blockers: ${blockers.length > 0 ? blockers.join(" | ") : "none"}`,
		next.length > 0 ? `next: ${next.join(" | ")}` : "next: keep current lane intent",
		"execution: prioritize latest user steering/follow-up; if none, proceed with listed tasks.",
	].join("\n");
}
