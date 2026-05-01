export type HandoffFreshnessLabel = "fresh" | "stale" | "unknown";
export type HandoffRefreshMode = "none" | "auto-on-compact" | "manual" | "unknown";

const CONTEXT_WATCH_ACTION_PREFIX = "Context-watch action:";
const DEFAULT_CONTEXT_WATCH_THRESHOLDS = {
	warnPct: 50,
	checkpointPct: 68,
	compactPct: 72,
};
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

function trimSliceMemoryForBudget(checkpoint: Record<string, unknown>): Record<string, unknown> {
	let jsonChars = JSON.stringify(checkpoint).length;
	if (jsonChars <= LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS) return checkpoint;
	const candidate = { ...checkpoint } as Record<string, unknown>;
	const memory = candidate.slice_memory;
	if (!memory || typeof memory !== "object") return candidate;
	const memoryRecord = { ...(memory as Record<string, unknown>) };
	const links = Array.isArray(memoryRecord.canonical_links)
		? memoryRecord.canonical_links.filter((v): v is string => typeof v === "string")
		: [];
	if (links.length > 2) {
		memoryRecord.canonical_links = links.slice(0, 2);
		candidate.slice_memory = memoryRecord;
		jsonChars = JSON.stringify(candidate).length;
	}
	if (jsonChars > LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS && links.length > 0) {
		delete memoryRecord.canonical_links;
		candidate.slice_memory = memoryRecord;
		jsonChars = JSON.stringify(candidate).length;
	}
	if (jsonChars > LOCAL_SLICE_HANDOFF_MAX_JSON_CHARS) {
		delete candidate.slice_memory;
	}
	return candidate;
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
	const canonicalLinks = buildLocalSliceCanonicalLinks({
		taskId: input.taskId,
		context: input.context,
		validation: input.validation,
		commits: input.commits,
		nextActions: input.nextActions,
	});
	const sliceMemory = {
		focus: currentTasks?.[0] ?? "none",
		...(canonicalLinks.length > 0 ? { canonical_links: canonicalLinks } : {}),
	};
	const checkpoint = {
		timestamp,
		context: truncateForPrompt(input.context, 180),
		...(currentTasks ? { current_tasks: currentTasks } : {}),
		...(nextActions ? { next_actions: nextActions } : {}),
		blockers: blockers ?? [],
		...(recentValidation ? { recent_validation: recentValidation } : {}),
		...(recentCommits ? { recent_commits: recentCommits } : {}),
		slice_memory: sliceMemory,
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
			percent: contextPercent ?? 0,
			thresholds: DEFAULT_CONTEXT_WATCH_THRESHOLDS,
			action: "checkpoint-refresh",
			recommendation: truncateForPrompt(input.recommendation ?? "Local slice checkpoint saved.", 120),
		}],
	};
	return trimSliceMemoryForBudget(checkpoint);
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
	staleFocusTasks?: string[];
	globalTruncated: boolean;
	globalTruncatedChars: number;
};

export type AutoResumePromptEnvelope = {
	prompt: string;
	diagnostics: AutoResumePromptDiagnostics;
};

export type AutoResumePromptOptions = {
	taskStatusById?: Record<string, string | undefined>;
	preferredTaskIds?: string[];
};

export type HandoffBoardReconciliationReason = "fresh" | "stale-hand-off" | "missing-task" | "completed-focus" | "board-handoff-divergence";

export type HandoffBoardReconciliationResult = {
	ok: boolean;
	reason: HandoffBoardReconciliationReason;
	blockers: HandoffBoardReconciliationReason[];
	focusTasks: string[];
	missingTasks: string[];
	completedTasks: string[];
	divergentTasks: string[];
	freshness: HandoffFreshnessLabel;
	ageMs?: number;
	summary: string;
};

function lookupTaskStatus(taskStatusById: Record<string, string | undefined>, taskId: string): string | undefined {
	const normalized = normalizePromptSegment(taskId);
	return taskStatusById[normalized] ?? taskStatusById[normalized.toUpperCase()];
}

export function resolveHandoffBoardReconciliation(input: {
	handoff?: Record<string, unknown>;
	taskStatusById?: Record<string, string | undefined>;
	nowMs?: number;
	maxFreshAgeMs?: number;
}): HandoffBoardReconciliationResult {
	const handoff = input.handoff && typeof input.handoff === "object" ? input.handoff : {};
	const freshness = resolveHandoffFreshness(
		typeof handoff.timestamp === "string" ? handoff.timestamp : undefined,
		input.nowMs ?? Date.now(),
		input.maxFreshAgeMs ?? 30 * 60 * 1000,
	);
	const taskStatusById = input.taskStatusById ?? {};
	const focusTasks = normalizeStringArray(handoff.current_tasks).map((task) => normalizePromptSegment(task)).filter(Boolean);
	const missingTasks: string[] = [];
	const completedTasks: string[] = [];
	const divergentTasks: string[] = [];
	for (const task of focusTasks) {
		const status = lookupTaskStatus(taskStatusById, task);
		if (status === undefined) missingTasks.push(task);
		else if (status === "completed") completedTasks.push(`${task}=completed`);
		else if (status !== "in-progress" && status !== "planned") divergentTasks.push(`${task}=${status}`);
	}
	const blockers: HandoffBoardReconciliationReason[] = [];
	if (freshness.label === "stale") blockers.push("stale-hand-off");
	if (missingTasks.length > 0) blockers.push("missing-task");
	if (completedTasks.length > 0) blockers.push("completed-focus");
	if (divergentTasks.length > 0) blockers.push("board-handoff-divergence");
	const reason = blockers[0] ?? "fresh";
	return {
		ok: blockers.length === 0,
		reason,
		blockers,
		focusTasks,
		missingTasks,
		completedTasks,
		divergentTasks,
		freshness: freshness.label,
		...(freshness.ageMs !== undefined ? { ageMs: freshness.ageMs } : {}),
		summary: [
			"handoff-board-reconcile:",
			`ok=${blockers.length === 0 ? "yes" : "no"}`,
			`reason=${reason}`,
			`focus=${focusTasks.length}`,
			blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
		].filter(Boolean).join(" "),
	};
}

export function summarizeAutoResumePromptDiagnostics(
	diagnostics: AutoResumePromptDiagnostics | undefined,
): string {
	if (!diagnostics) return "none";
	const summarizeCollection = (label: string, row: AutoResumePromptCollectionDiagnostics) => (
		`${label}(in=${row.inputCount},listed=${row.listedCount},dedup=${row.dedupedCount},trunc=${row.truncatedCount},drop=${row.droppedByLimitCount})`
	);
	const staleFocusCount = diagnostics.staleFocusTasks?.length ?? 0;
	const global = diagnostics.globalTruncated
		? `global=truncated(+${diagnostics.globalTruncatedChars})`
		: "global=ok";
	return [
		summarizeCollection("tasks", diagnostics.tasks),
		staleFocusCount > 0 ? `staleFocus=${staleFocusCount}` : undefined,
		summarizeCollection("blockers", diagnostics.blockers),
		summarizeCollection("next", diagnostics.nextActions),
		global,
	].filter(Boolean).join(" ");
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
		const matches = String(value ?? "").toUpperCase().match(/TASK-[A-Z0-9-]*\d[A-Z0-9-]*/g) ?? [];
		for (const id of matches) {
			if (seen.has(id)) continue;
			seen.add(id);
			ids.push(id);
			if (ids.length >= limit) return ids;
		}
	}
	return ids;
}

function extractVerificationIdsFromTextLines(values: string[], limit = 3): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const matches = String(value ?? "").toUpperCase().match(/VER-[A-Z0-9-]*\d[A-Z0-9-]*/g) ?? [];
		for (const id of matches) {
			if (seen.has(id)) continue;
			seen.add(id);
			ids.push(id);
			if (ids.length >= limit) return ids;
		}
	}
	return ids;
}

function extractCommitHashesFromTextLines(values: string[], limit = 3): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const matches = String(value ?? "").match(/\b[0-9a-f]{7,40}\b/gi) ?? [];
		for (const match of matches) {
			const normalized = match.toLowerCase();
			if (seen.has(normalized)) continue;
			seen.add(normalized);
			ids.push(normalized);
			if (ids.length >= limit) return ids;
		}
	}
	return ids;
}

function buildLocalSliceCanonicalLinks(input: {
	taskId?: string;
	context: string;
	validation?: string[];
	commits?: string[];
	nextActions?: string[];
}): string[] {
	const sourceLines = [
		input.context,
		...(input.validation ?? []),
		...(input.commits ?? []),
		...(input.nextActions ?? []),
	];
	const links: string[] = [];
	const seen = new Set<string>();
	const add = (value: string) => {
		if (!value || seen.has(value) || links.length >= 4) return;
		seen.add(value);
		links.push(value);
	};
	if (typeof input.taskId === "string" && input.taskId.trim().length > 0) {
		const directTaskId = extractTaskIdsFromTextLines([input.taskId], 1)[0]
			?? truncateForPrompt(input.taskId, 24).toUpperCase();
		add(`task:${directTaskId}`);
	}
	for (const id of extractTaskIdsFromTextLines(sourceLines, 2)) add(`task:${id}`);
	for (const id of extractVerificationIdsFromTextLines(sourceLines, 1)) add(`verification:${id}`);
	for (const hash of extractCommitHashesFromTextLines(sourceLines, 1)) add(`commit:${hash}`);
	return links;
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

function isAutoResumeActiveTaskStatus(status: string | undefined): boolean {
	return status === undefined || status === "in-progress" || status === "planned";
}

function addAutoResumeStaleFocus(stale: string[], staleIds: Set<string>, task: string, status = "completed"): void {
	const normalizedTask = normalizePromptSegment(task);
	if (!normalizedTask) return;
	const normalizedUpper = normalizedTask.toUpperCase();
	if (!staleIds.has(normalizedUpper)) stale.push(`${normalizedTask}=${status}`);
	staleIds.add(normalizedTask);
	staleIds.add(normalizedUpper);
}

function filterAutoResumeFocusTasks(rawTasks: string[], completedTasks: string[] = [], options?: AutoResumePromptOptions): { active: string[]; stale: string[]; staleIds: Set<string> } {
	const statuses = options?.taskStatusById ?? {};
	const active: string[] = [];
	const stale: string[] = [];
	const staleIds = new Set<string>();
	for (const task of completedTasks) {
		addAutoResumeStaleFocus(stale, staleIds, task, "completed");
	}
	for (const task of rawTasks) {
		const normalizedTask = normalizePromptSegment(task);
		const normalizedUpper = normalizedTask.toUpperCase();
		const status = statuses[normalizedTask] ?? statuses[normalizedUpper];
		if (isAutoResumeActiveTaskStatus(status) && !staleIds.has(normalizedUpper)) {
			active.push(task);
		} else {
			addAutoResumeStaleFocus(stale, staleIds, normalizedTask, status ?? "completed");
		}
	}
	return { active, stale, staleIds };
}

export function buildAutoResumePromptEnvelopeFromHandoff(
	handoffInput: Record<string, unknown> | undefined,
	_maxFreshAgeMs = 30 * 60 * 1000,
	_nowMs = Date.now(),
	options?: AutoResumePromptOptions,
): AutoResumePromptEnvelope {
	const handoff = (handoffInput && typeof handoffInput === "object") ? handoffInput : {};
	const timestamp = typeof handoff.timestamp === "string" && handoff.timestamp
		? handoff.timestamp
		: undefined;
	const rawCurrentTasks = normalizeStringArray(handoff.current_tasks);
	const completedTasks = normalizeStringArray(handoff.completed_tasks);
	const filteredCurrentTasks = filterAutoResumeFocusTasks(rawCurrentTasks, completedTasks, options);
	const focusSourceLines = [
		...normalizeStringArray(handoff.next_actions),
		...normalizeStringArray(handoff.blockers),
		typeof handoff.context === "string" ? handoff.context : "",
	];
	const derivedTaskHints = filteredCurrentTasks.active.length > 0
		? []
		: extractTaskIdsFromTextLines(focusSourceLines).filter((id) => !filteredCurrentTasks.staleIds.has(id) && !filteredCurrentTasks.staleIds.has(id.toUpperCase()));
	const preferredTaskHints = filteredCurrentTasks.active.length > 0 || derivedTaskHints.length > 0
		? []
		: normalizeStringArray(options?.preferredTaskIds)
			.filter((id) => !filteredCurrentTasks.staleIds.has(id) && !filteredCurrentTasks.staleIds.has(id.toUpperCase()))
			.slice(0, 3);
	const operationalFocusHints = filteredCurrentTasks.active.length > 0 || derivedTaskHints.length > 0 || preferredTaskHints.length > 0
		? []
		: extractOperationalFocusHints(focusSourceLines);
	const tasksPrepared = preparePromptCollection({
		values: filteredCurrentTasks.active.length > 0 ? filteredCurrentTasks.active : (derivedTaskHints.length > 0 ? derivedTaskHints : (preferredTaskHints.length > 0 ? preferredTaskHints : operationalFocusHints)),
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

	const sliceMemoryLinks = normalizeStringArray(
		handoff.slice_memory && typeof handoff.slice_memory === "object"
			? (handoff.slice_memory as Record<string, unknown>).canonical_links
			: undefined,
	);
	const linksPrepared = preparePromptCollection({
		values: sliceMemoryLinks,
		maxChars: 48,
		limit: 3,
	});
	const lines = [
		`auto-resume: continue from .project/handoff.json${timestamp ? ` (ts=${timestamp})` : ""}.`,
		`focusTasks: ${formatPromptList(tasksPrepared.values, tasksPrepared.diagnostics.droppedByLimitCount, "none-listed", ", ")}`,
	];
	if (filteredCurrentTasks.stale.length > 0) {
		lines.push(`staleFocus: ${formatPromptList(filteredCurrentTasks.stale.slice(0, 2), Math.max(0, filteredCurrentTasks.stale.length - 2), "none", ", ")}`);
	}
	if (blockersPrepared.values.length > 0) {
		lines.push(`blockers: ${formatPromptList(blockersPrepared.values, blockersPrepared.diagnostics.droppedByLimitCount, "none", " | ")}`);
	}
	if (nextPrepared.values.length > 0) {
		lines.push(`next: ${formatPromptList(nextPrepared.values, nextPrepared.diagnostics.droppedByLimitCount, "keep current lane intent", " | ")}`);
	}
	if (linksPrepared.values.length > 0) {
		lines.push(`links: ${formatPromptList(linksPrepared.values, linksPrepared.diagnostics.droppedByLimitCount, "none", ", ")}`);
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
			...(filteredCurrentTasks.stale.length > 0 ? { staleFocusTasks: filteredCurrentTasks.stale } : {}),
			globalTruncated,
			globalTruncatedChars,
		},
	};
}

export function buildAutoResumePromptFromHandoff(
	handoffInput: Record<string, unknown> | undefined,
	maxFreshAgeMs = 30 * 60 * 1000,
	nowMs = Date.now(),
	options?: AutoResumePromptOptions,
): string {
	return buildAutoResumePromptEnvelopeFromHandoff(handoffInput, maxFreshAgeMs, nowMs, options).prompt;
}
