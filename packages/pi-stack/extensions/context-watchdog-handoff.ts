export type HandoffFreshnessLabel = "fresh" | "stale" | "unknown";
export type HandoffRefreshMode = "none" | "auto-on-compact" | "manual" | "unknown";

const CONTEXT_WATCH_ACTION_PREFIX = "Context-watch action:";

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function dropCommonListPrefix(text: string): string {
	return text
		.replace(/^[-*•]+\s+/, "")
		.replace(/^\d+[.)]\s+/, "")
		.trim();
}

function normalizePromptSegment(value: string): string {
	const raw = String(value ?? "");
	const withoutMarkdown = raw
		.replace(/`([^`]+)`/g, "$1")
		.replace(/[\u0000-\u001f\u007f]+/g, " ");
	const deListed = dropCommonListPrefix(withoutMarkdown);
	const singleLine = deListed.replace(/\s+/g, " ").trim();
	const normalizedPipes = singleLine.replace(/\|/g, " / ").replace(/\s+\/\s+/g, " / ");
	const withoutWrappingQuotes = normalizedPipes.replace(/^(["'])(.*)\1$/, "$2");
	return withoutWrappingQuotes
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

export type AutoResumePromptCollectionDiagnostics = {
	inputCount: number;
	listedCount: number;
	dedupedCount: number;
	truncatedCount: number;
	droppedByLimitCount: number;
};

export type AutoResumePromptDiagnostics = {
	tasks: AutoResumePromptCollectionDiagnostics;
	blockers: AutoResumePromptCollectionDiagnostics;
	nextActions: AutoResumePromptCollectionDiagnostics;
	globalTruncated: boolean;
	globalTruncatedChars: number;
};

export type AutoResumePromptEnvelope = {
	prompt: string;
	diagnostics: AutoResumePromptDiagnostics;
};

const AUTO_RESUME_PROMPT_MAX_CHARS = 700;
const TRUNCATION_MARKER_PREFIX = "[truncated:+";

type PromptCollectionConfig = {
	values: string[];
	maxChars: number;
	limit: number;
};

function preparePromptCollection(config: PromptCollectionConfig): {
	values: string[];
	diagnostics: AutoResumePromptCollectionDiagnostics;
} {
	const prepared: string[] = [];
	const seen = new Set<string>();
	let dedupedCount = 0;
	let truncatedCount = 0;
	for (const raw of config.values) {
		const normalized = truncateForPrompt(raw, config.maxChars);
		if (normalized.includes(TRUNCATION_MARKER_PREFIX)) {
			truncatedCount += 1;
		}
		if (seen.has(normalized)) {
			dedupedCount += 1;
			continue;
		}
		seen.add(normalized);
		prepared.push(normalized);
	}
	const droppedByLimitCount = Math.max(0, prepared.length - config.limit);
	const listed = prepared.slice(0, config.limit);
	return {
		values: listed,
		diagnostics: {
			inputCount: config.values.length,
			listedCount: listed.length,
			dedupedCount,
			truncatedCount,
			droppedByLimitCount,
		},
	};
}

export function buildAutoResumePromptEnvelopeFromHandoff(
	handoffInput: Record<string, unknown> | undefined,
	_maxFreshAgeMs = 30 * 60 * 1000,
	_nowMs = Date.now(),
): AutoResumePromptEnvelope {
	const handoff = (handoffInput && typeof handoffInput === "object") ? handoffInput : {};
	const timestamp = typeof handoff.timestamp === "string" && handoff.timestamp
		? handoff.timestamp
		: undefined;
	const tasksPrepared = preparePromptCollection({
		values: normalizeStringArray(handoff.current_tasks),
		maxChars: 48,
		limit: 3,
	});
	const blockersPrepared = preparePromptCollection({
		values: normalizeStringArray(handoff.blockers).filter((b) => !b.startsWith("context-watch-")),
		maxChars: 80,
		limit: 2,
	});
	const nextPrepared = preparePromptCollection({
		values: normalizeStringArray(handoff.next_actions)
			.filter((line) => !line.startsWith(CONTEXT_WATCH_ACTION_PREFIX)),
		maxChars: 120,
		limit: 2,
	});

	const lines = [
		`auto-resume: continue from .project/handoff.json${timestamp ? ` (ts=${timestamp})` : ""}.`,
		`focusTasks: ${tasksPrepared.values.length > 0 ? tasksPrepared.values.join(", ") : "none-listed"}`,
		`blockers: ${blockersPrepared.values.length > 0 ? blockersPrepared.values.join(" | ") : "none"}`,
		nextPrepared.values.length > 0
			? `next: ${nextPrepared.values.join(" | ")}`
			: "next: keep current lane intent",
		"execution: prioritize latest user steering/follow-up; if none, proceed with listed tasks.",
	];
	const promptRaw = lines.join("\n");
	const globalTruncated = promptRaw.length > AUTO_RESUME_PROMPT_MAX_CHARS;
	const globalTruncatedChars = globalTruncated
		? promptRaw.length - AUTO_RESUME_PROMPT_MAX_CHARS
		: 0;
	const prompt = globalTruncated
		? `${promptRaw.slice(0, AUTO_RESUME_PROMPT_MAX_CHARS)}\n[auto-resume-prompt-truncated:+${globalTruncatedChars} chars]`
		: promptRaw;
	return {
		prompt,
		diagnostics: {
			tasks: tasksPrepared.diagnostics,
			blockers: blockersPrepared.diagnostics,
			nextActions: nextPrepared.diagnostics,
			globalTruncated,
			globalTruncatedChars,
		},
	};
}

export function buildAutoResumePromptFromHandoff(
	handoffInput: Record<string, unknown> | undefined,
	maxFreshAgeMs = 30 * 60 * 1000,
	nowMs = Date.now(),
): string {
	return buildAutoResumePromptEnvelopeFromHandoff(handoffInput, maxFreshAgeMs, nowMs).prompt;
}
