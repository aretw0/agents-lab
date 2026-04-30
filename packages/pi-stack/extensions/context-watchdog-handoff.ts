export type HandoffFreshnessLabel = "fresh" | "stale" | "unknown";
export type HandoffRefreshMode = "none" | "auto-on-compact" | "manual" | "unknown";

const CONTEXT_WATCH_ACTION_PREFIX = "Context-watch action:";
export const LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS = 2_700;

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function dropCommonListPrefix(text: string): string {
	return text
		.replace(/^[-*•]+\s+/, "")
		.replace(/^\d+[.)]\s+/, "")
		.replace(/^(next|blockers|focustasks|execution)\s*:\s*/i, "")
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
	const keep = Math.max(24, Math.floor(max));
	if (keep < 48) {
		const omitted = Math.max(0, s.length - keep);
		return `${s.slice(0, keep)} [truncated:+${omitted} chars]`;
	}
	const tailKeep = Math.max(12, Math.floor(keep * 0.22));
	const headKeep = Math.max(16, keep - tailKeep);
	const preserved = Math.min(s.length, headKeep + tailKeep);
	const omitted = Math.max(0, s.length - preserved);
	if (omitted <= 0) return s;
	const head = s.slice(0, headKeep).trimEnd();
	const tail = s.slice(Math.max(0, s.length - tailKeep)).trimStart();
	return `${head} [snip] ${tail} [truncated:+${omitted} chars]`;
}

export type LocalSliceHandoffCheckpointInput = {
	timestampIso: string;
	taskId?: string;
	context: string;
	validation?: string[];
	commits?: string[];
	nextActions?: string[];
	blockers?: string[];
	contextLevel?: "ok" | "warn" | "checkpoint" | "compact";
	contextPercent?: number;
	recommendation?: string;
};

export type LocalSliceHandoffBudgetAssessment = {
	ok: boolean;
	jsonChars: number;
	maxJsonChars: number;
	reason?: "checkpoint-too-large";
};

export function assessLocalSliceHandoffBudget(
	checkpoint: Record<string, unknown>,
	maxJsonChars = LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS,
): LocalSliceHandoffBudgetAssessment {
	const max = Math.max(500, Math.floor(Number(maxJsonChars) || LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS));
	const jsonChars = JSON.stringify(checkpoint).length;
	return jsonChars <= max
		? { ok: true, jsonChars, maxJsonChars: max }
		: { ok: false, jsonChars, maxJsonChars: max, reason: "checkpoint-too-large" };
}

function compactHandoffList(values: string[] | undefined, limit: number, maxChars: number): string[] | undefined {
	const prepared = preparePromptCollection({
		values: Array.isArray(values) ? values : [],
		limit,
		maxChars,
	});
	return prepared.values.length > 0 ? prepared.values : undefined;
}

export function buildLocalSliceHandoffCheckpoint(input: LocalSliceHandoffCheckpointInput): Record<string, unknown> {
	const timestamp = input.timestampIso || new Date().toISOString();
	const contextLevel = input.contextLevel ?? "ok";
	const contextPercent = Number.isFinite(input.contextPercent) ? Math.max(0, Math.floor(Number(input.contextPercent))) : undefined;
	const currentTasks = input.taskId ? [truncateForPrompt(input.taskId, 64)] : undefined;
	const recentValidation = compactHandoffList(input.validation, 3, 120);
	const recentCommits = compactHandoffList(input.commits, 2, 80);
	const nextActions = compactHandoffList(input.nextActions, 3, 120);
	const blockers = compactHandoffList(input.blockers, 3, 100);
	return {
		timestamp,
		context: truncateForPrompt(input.context, 180),
		...(currentTasks ? { current_tasks: currentTasks } : {}),
		...(nextActions ? { next_actions: nextActions } : {}),
		blockers: blockers ?? [],
		...(recentValidation ? { recent_validation: recentValidation } : {}),
		...(recentCommits ? { recent_commits: recentCommits } : {}),
		context_watch: {
			generatedAtIso: timestamp,
			level: contextLevel,
			...(contextPercent !== undefined ? { percent: contextPercent } : {}),
			action: contextLevel === "ok" || contextLevel === "warn" ? "continue" : "checkpoint-refresh",
			recommendation: truncateForPrompt(input.recommendation ?? "Progress saved; continue bounded local hardening.", 120),
		},
		context_watch_events: [{
			atIso: timestamp,
			reason: "manual_checkpoint",
			level: contextLevel,
			...(contextPercent !== undefined ? { percent: contextPercent } : {}),
			action: "checkpoint-refresh",
			recommendation: truncateForPrompt(input.recommendation ?? "Local slice checkpoint saved.", 120),
		}],
	};
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

export function summarizeAutoResumePromptDiagnostics(
	diagnostics: AutoResumePromptDiagnostics | undefined,
): string {
	if (!diagnostics) return "none";
	const summarizeCollection = (label: string, row: AutoResumePromptCollectionDiagnostics) => (
		`${label}(in=${row.inputCount},listed=${row.listedCount},dedup=${row.dedupedCount},trunc=${row.truncatedCount},drop=${row.droppedByLimitCount})`
	);
	const global = diagnostics.globalTruncated
		? `global=truncated(+${diagnostics.globalTruncatedChars})`
		: "global=ok";
	return [
		summarizeCollection("tasks", diagnostics.tasks),
		summarizeCollection("blockers", diagnostics.blockers),
		summarizeCollection("next", diagnostics.nextActions),
		global,
	].join(" ");
}

const AUTO_RESUME_PROMPT_MAX_CHARS = 700;
const TRUNCATION_MARKER_PREFIX = "[truncated:+";

type PromptCollectionConfig = {
	values: string[];
	maxChars: number;
	limit: number;
	maxCharsForValue?: (value: string, defaultMaxChars: number) => number;
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
		const maxChars = config.maxCharsForValue
			? config.maxCharsForValue(raw, config.maxChars)
			: config.maxChars;
		const normalized = truncateForPrompt(raw, maxChars);
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

function shouldPreferLongerCommandWindow(value: string): boolean {
	const normalized = String(value ?? "").toLowerCase();
	if (!normalized) return false;
	return /\bcmd\.exe\s*\/c\b/.test(normalized)
		|| /\bnpx\s+vitest\s+run\b/.test(normalized)
		|| /\bnpm\s+run\b/.test(normalized)
		|| /\bpnpm\s+/.test(normalized)
		|| /\byarn\s+/.test(normalized);
}

function extractTaskIdsFromTextLines(values: string[], limit = 3): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const matches = String(value ?? "").toUpperCase().match(/TASK-[A-Z0-9-]+/g) ?? [];
		for (const id of matches) {
			if (seen.has(id)) continue;
			seen.add(id);
			ids.push(id);
			if (ids.length >= limit) return ids;
		}
	}
	return ids;
}

function extractOperationalFocusHints(values: string[], limit = 3): string[] {
	const hints: string[] = [];
	const add = (hint: string) => {
		if (hints.includes(hint) || hints.length >= limit) return;
		hints.push(hint);
	};
	for (const value of values) {
		const normalized = String(value ?? "").toLowerCase();
		if (!normalized) continue;
		if (/\bautonomy[_ -]?lane[_ -]?status\b/.test(normalized) || /\bautonomy lane\b/.test(normalized)) {
			add("autonomy-lane-status");
		}
		if (/\bboard[-_ ]?(next|task|selection)\b/.test(normalized) || /\btask selection\b/.test(normalized)) {
			add("board-task-selection");
		}
		if (/\blane[-_ ]?queue\b/.test(normalized)) {
			add("lane-queue");
		}
		if (hints.length >= limit) break;
	}
	return hints;
}

function formatPromptList(values: string[], droppedByLimitCount: number, fallback: string, separator: string): string {
	if (values.length <= 0) return fallback;
	const base = values.join(separator);
	return droppedByLimitCount > 0 ? `${base} (+${droppedByLimitCount} more)` : base;
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
	const rawCurrentTasks = normalizeStringArray(handoff.current_tasks);
	const focusSourceLines = [
		...normalizeStringArray(handoff.next_actions),
		...normalizeStringArray(handoff.blockers),
		typeof handoff.context === "string" ? handoff.context : "",
	];
	const derivedTaskHints = rawCurrentTasks.length > 0
		? []
		: extractTaskIdsFromTextLines(focusSourceLines);
	const operationalFocusHints = rawCurrentTasks.length > 0 || derivedTaskHints.length > 0
		? []
		: extractOperationalFocusHints(focusSourceLines);
	const tasksPrepared = preparePromptCollection({
		values: rawCurrentTasks.length > 0 ? rawCurrentTasks : (derivedTaskHints.length > 0 ? derivedTaskHints : operationalFocusHints),
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
		maxChars: 140,
		limit: 2,
		maxCharsForValue: (value, defaultMaxChars) => (
			shouldPreferLongerCommandWindow(value)
				? Math.max(defaultMaxChars, 220)
				: defaultMaxChars
		),
	});

	const lines = [
		`auto-resume: continue from .project/handoff.json${timestamp ? ` (ts=${timestamp})` : ""}.`,
		`focusTasks: ${formatPromptList(tasksPrepared.values, tasksPrepared.diagnostics.droppedByLimitCount, "none-listed", ", ")}`,
	];
	if (blockersPrepared.values.length > 0) {
		lines.push(`blockers: ${formatPromptList(blockersPrepared.values, blockersPrepared.diagnostics.droppedByLimitCount, "none", " | ")}`);
	}
	if (nextPrepared.values.length > 0) {
		lines.push(`next: ${formatPromptList(nextPrepared.values, nextPrepared.diagnostics.droppedByLimitCount, "keep current lane intent", " | ")}`);
	}
	lines.push("policy: latest user steering wins; otherwise continue listed tasks.");
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
