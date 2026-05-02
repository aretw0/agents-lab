import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ColonyPhase } from "./colony-pilot-runtime";

export type ProjectTaskStatus =
	| "planned"
	| "in-progress"
	| "completed"
	| "blocked"
	| "cancelled";

export interface ProjectTaskItem {
	id: string;
	description: string;
	status: ProjectTaskStatus;
	files?: string[];
	acceptance_criteria?: string[];
	depends_on?: string[];
	assigned_agent?: string;
	verification?: string;
	notes?: string;
	milestone?: string;
	priority?: string;
}

export interface ProjectTasksBlock {
	tasks: ProjectTaskItem[];
}

export interface ColonyTaskSyncConfigShape {
	createOnLaunch: boolean;
	trackProgress: boolean;
	markTerminalState: boolean;
	taskIdPrefix: string;
	requireHumanClose: boolean;
	maxNoteLines: number;
	recoveryTaskSuffix: string;
}

export type ColonyDeliveryModeShape =
	| "report-only"
	| "patch-artifact"
	| "apply-to-branch";

export interface ProjectTasksLockOptions {
	maxWaitMs?: number;
	retryMs?: number;
	staleMs?: number;
}

const DEFAULT_TASKS_LOCK_OPTIONS: Required<ProjectTasksLockOptions> = {
	maxWaitMs: 1500,
	retryMs: 25,
	staleMs: 2 * 60_000,
};

function resolveLockOptions(
	options?: ProjectTasksLockOptions,
): Required<ProjectTasksLockOptions> {
	const maxWaitMs = Number(options?.maxWaitMs);
	const retryMs = Number(options?.retryMs);
	const staleMs = Number(options?.staleMs);
	return {
		maxWaitMs:
			Number.isFinite(maxWaitMs) && maxWaitMs >= 1
				? Math.floor(maxWaitMs)
				: DEFAULT_TASKS_LOCK_OPTIONS.maxWaitMs,
		retryMs:
			Number.isFinite(retryMs) && retryMs >= 1
				? Math.floor(retryMs)
				: DEFAULT_TASKS_LOCK_OPTIONS.retryMs,
		staleMs:
			Number.isFinite(staleMs) && staleMs >= 1
				? Math.floor(staleMs)
				: DEFAULT_TASKS_LOCK_OPTIONS.staleMs,
	};
}

function isEexistError(error: unknown): boolean {
	const code = (error as { code?: string } | undefined)?.code;
	return code === "EEXIST";
}

function sleepSync(ms: number) {
	const waitMs = Math.max(0, Math.floor(ms));
	if (waitMs <= 0) return;
	const end = Date.now() + waitMs;
	while (Date.now() < end) {
		// deterministic sync backoff
	}
}

function acquireTasksLock(
	lockPath: string,
	options?: ProjectTasksLockOptions,
): { release: () => void } {
	const cfg = resolveLockOptions(options);
	const startedAt = Date.now();
	const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	while (true) {
		try {
			writeFileSync(
				lockPath,
				JSON.stringify({ token, acquiredAt: new Date().toISOString() }),
				{ flag: "wx" },
			);
			return {
				release: () => {
					try {
						unlinkSync(lockPath);
					} catch {
						// best-effort lock release
					}
				},
			};
		} catch (error) {
			if (!isEexistError(error)) throw error;

			try {
				const st = statSync(lockPath);
				if (Date.now() - st.mtimeMs > cfg.staleMs) {
					unlinkSync(lockPath);
					continue;
				}
			} catch {
				// lock vanished between checks, retry immediately
				continue;
			}

			const elapsed = Date.now() - startedAt;
			if (elapsed >= cfg.maxWaitMs) {
				throw new Error(
					`project tasks lock timeout after ${elapsed}ms (${path.basename(lockPath)})`,
				);
			}

			sleepSync(Math.min(cfg.retryMs, cfg.maxWaitMs - elapsed));
		}
	}
}

export function readProjectTasksBlock(cwd: string): ProjectTasksBlock {
	const p = path.join(cwd, ".project", "tasks.json");
	if (!existsSync(p)) return { tasks: [] };

	try {
		const raw = JSON.parse(readFileSync(p, "utf8"));
		if (!raw || typeof raw !== "object") return { tasks: [] };
		const tasks = Array.isArray((raw as { tasks?: unknown }).tasks)
			? ((raw as { tasks: unknown[] }).tasks.filter(
					(t): t is ProjectTaskItem => !!t && typeof t === "object",
				) as ProjectTaskItem[])
			: [];
		return { tasks };
	} catch {
		return { tasks: [] };
	}
}

export function writeProjectTasksBlock(
	cwd: string,
	block: ProjectTasksBlock,
	lockOptions?: ProjectTasksLockOptions,
) {
	const dir = path.join(cwd, ".project");
	mkdirSync(dir, { recursive: true });
	const p = path.join(dir, "tasks.json");
	const lockPath = path.join(dir, "tasks.lock");
	const lock = acquireTasksLock(lockPath, lockOptions);
	const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
	try {
		writeFileSync(tmp, `${JSON.stringify({ tasks: block.tasks }, null, 2)}\n`);
		renameSync(tmp, p);
	} finally {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {
			// ignore tmp cleanup failure
		}
		lock.release();
	}
}

export function sanitizeTaskSlug(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

export function appendNote(
	existing: string | undefined,
	line: string,
	maxLines: number,
): string {
	const lines = (existing ?? "")
		.split(/\r?\n/)
		.filter((l) => l.trim().length > 0);
	lines.push(line);
	const keep = lines.slice(Math.max(0, lines.length - maxLines));
	return keep.join("\n");
}

export function normalizeTaskNoteForDedupe(line: string): string {
	return line.trim().replace(/^\[[^\]]+\]\s*/, "");
}

export function appendNoteOnceByNormalizedMessage(
	existing: string | undefined,
	line: string,
	maxLines: number,
): { notes: string | undefined; appended: boolean } {
	const normalizedLine = normalizeTaskNoteForDedupe(line);
	if (!normalizedLine) return { notes: existing, appended: false };
	const hasSameMessage = (existing ?? "")
		.split(/\r?\n/)
		.map(normalizeTaskNoteForDedupe)
		.some((existingLine) => existingLine === normalizedLine);
	if (hasSameMessage) return { notes: existing, appended: false };
	return { notes: appendNote(existing, line, maxLines), appended: true };
}

function normalizeMilestoneLabel(input: unknown): string | undefined {
	if (typeof input !== "string") return undefined;
	const normalized = input.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119)}…`;
}

function colonyPhaseToProjectTaskStatus(
	phase: ColonyPhase,
	requireHumanClose: boolean,
): ProjectTaskStatus {
	const eventType = colonyPhaseToCanonicalTaskEventType(phase, requireHumanClose);
	if (!eventType) return "in-progress";
	return canonicalTaskEventTypeToProjectTaskStatus(eventType);
}

export type CanonicalTaskEventType =
	| "start"
	| "progress"
	| "review"
	| "done_candidate"
	| "done_verified"
	| "recovery";

export type CanonicalTaskEventSource = "colony" | "scheduler" | "human" | "ci";

export interface CanonicalTaskEvent {
	eventId: string;
	taskId: string;
	type: CanonicalTaskEventType;
	source: CanonicalTaskEventSource;
	timestamp: string;
	evidenceRefs?: string[];
}

export function colonyPhaseToCanonicalTaskEventType(
	phase: ColonyPhase,
	requireHumanClose: boolean,
): CanonicalTaskEventType | undefined {
	if (phase === "launched") return "start";
	if (phase === "running" || phase === "scouting") return "progress";
	if (phase === "task_done") return "review";
	if (phase === "completed") return requireHumanClose ? "done_candidate" : "done_verified";
	if (phase === "failed" || phase === "aborted" || phase === "budget_exceeded") {
		return "recovery";
	}
	return undefined;
}

export function canonicalTaskEventTypeToProjectTaskStatus(
	type: CanonicalTaskEventType,
): ProjectTaskStatus {
	if (type === "recovery") return "blocked";
	if (type === "done_verified") return "completed";
	if (type === "done_candidate") return "in-progress";
	return "in-progress";
}

export function applyCanonicalTaskEventToProjectTask(
	task: ProjectTaskItem,
	event: Pick<CanonicalTaskEvent, "type" | "timestamp" | "source">,
	options?: { maxNoteLines?: number; appendEventNote?: boolean },
): ProjectTaskItem {
	const nextStatus = canonicalTaskEventTypeToProjectTaskStatus(event.type);
	const appendEventNote = options?.appendEventNote !== false;
	const maxNoteLines = Number.isFinite(Number(options?.maxNoteLines))
		? Math.max(1, Math.floor(Number(options?.maxNoteLines)))
		: 20;
	const noteLine = `[${event.timestamp}] task_event type=${event.type} source=${event.source}`;
	const nextNotes = appendEventNote
		? appendNote(task.notes, noteLine, maxNoteLines)
		: task.notes;
	return {
		...task,
		status: nextStatus,
		notes: nextNotes,
	};
}

function canonicalTaskEventId(
	taskId: string,
	signalId: string,
	phase: ColonyPhase,
	timestamp: string,
): string {
	const base = sanitizeTaskSlug(`${taskId}-${signalId}-${phase}`) || "task-event";
	const tsNum = Date.parse(timestamp);
	const tsPart = Number.isFinite(tsNum)
		? Math.floor(tsNum).toString(36)
		: (sanitizeTaskSlug(timestamp).slice(0, 16) || "ts-unknown");
	return `${base}-${tsPart}`;
}

export function normalizeCanonicalEvidenceRefs(input: unknown): string[] | undefined {
	if (!Array.isArray(input)) return undefined;
	const refs = [...new Set(
		input
			.filter((x): x is string => typeof x === "string")
			.map((x) => x.trim())
			.filter((x) => x.length > 0),
	)];
	return refs.length > 0 ? refs : undefined;
}

export function buildCanonicalTaskEventFromColonySignal(options: {
	taskId: string;
	signal: { phase: ColonyPhase; id: string };
	requireHumanClose: boolean;
	timestamp?: string;
	source?: CanonicalTaskEventSource;
	evidenceRefs?: string[];
}): CanonicalTaskEvent | undefined {
	const type = colonyPhaseToCanonicalTaskEventType(
		options.signal.phase,
		options.requireHumanClose,
	);
	if (!type) return undefined;
	const timestamp = options.timestamp ?? new Date().toISOString();
	return {
		eventId: canonicalTaskEventId(
			options.taskId,
			options.signal.id,
			options.signal.phase,
			timestamp,
		),
		taskId: options.taskId,
		type,
		source: options.source ?? "colony",
		timestamp,
		evidenceRefs: normalizeCanonicalEvidenceRefs(options.evidenceRefs),
	};
}

export function upsertProjectTaskFromColonySignal(
	cwd: string,
	signal: { phase: ColonyPhase; id: string },
	options: {
		config: ColonyTaskSyncConfigShape;
		goal?: string;
		taskIdOverride?: string;
		source?: "ant_colony" | "manual";
		milestone?: string;
	},
): { changed: boolean; taskId: string; status: ProjectTaskStatus } {
	const cfg = options.config;
	const block = readProjectTasksBlock(cwd);

	const baseTaskId = options.taskIdOverride
		? options.taskIdOverride
		: `${cfg.taskIdPrefix}-${signal.id}`;
	const taskId =
		sanitizeTaskSlug(baseTaskId) || `${cfg.taskIdPrefix}-${Date.now()}`;
	const now = new Date().toISOString();

	const idx = block.tasks.findIndex((t) => t.id === taskId);
	const nextStatus = colonyPhaseToProjectTaskStatus(
		signal.phase,
		cfg.requireHumanClose,
	);
	const isTerminal =
		signal.phase === "completed" ||
		signal.phase === "failed" ||
		signal.phase === "aborted" ||
		signal.phase === "budget_exceeded";
	const origin = options.source ?? "manual";
	const goalLabel = options.goal?.trim() || `colony ${signal.id}`;
	const milestone = normalizeMilestoneLabel(options.milestone);

	const line =
		signal.phase === "completed" && cfg.requireHumanClose
			? `[${now}] colony ${signal.id} phase=completed (candidate only, aguardando revisão humana)`
			: `[${now}] colony ${signal.id} phase=${signal.phase}`;

	if (idx === -1) {
		if (!cfg.createOnLaunch && signal.phase === "launched") {
			return { changed: false, taskId, status: nextStatus };
		}

		block.tasks.push({
			id: taskId,
			description: `[COLONY:${origin}] ${goalLabel}`,
			status: nextStatus,
			notes: appendNote(undefined, line, cfg.maxNoteLines),
			...(milestone ? { milestone } : {}),
		});
		writeProjectTasksBlock(cwd, block);
		return { changed: true, taskId, status: nextStatus };
	}

	const current = block.tasks[idx]!;
	let changed = false;

	if (cfg.trackProgress && current.status !== nextStatus) {
		if (!isTerminal || cfg.markTerminalState) {
			current.status = nextStatus;
			changed = true;
		}
	}

	if (cfg.trackProgress) {
		current.notes = appendNote(current.notes, line, cfg.maxNoteLines);
		changed = true;
	}

	if (milestone && current.milestone !== milestone) {
		current.milestone = milestone;
		changed = true;
	}

	if (changed) writeProjectTasksBlock(cwd, block);
	return { changed, taskId, status: current.status };
}

export function ensureRecoveryTaskForCandidate(
	cwd: string,
	options: {
		sourceTaskId: string;
		colonyId: string;
		goal?: string;
		deliveryMode: ColonyDeliveryModeShape;
		issues: string[];
		config: ColonyTaskSyncConfigShape;
	},
): { taskId: string; changed: boolean } {
	const block = readProjectTasksBlock(cwd);
	const suffix =
		sanitizeTaskSlug(options.config.recoveryTaskSuffix || "promotion") ||
		"promotion";
	const recoveryTaskId =
		sanitizeTaskSlug(`${options.sourceTaskId}-${suffix}`) ||
		`${options.sourceTaskId}-promotion`;
	const idx = block.tasks.findIndex((t) => t.id === recoveryTaskId);
	const sourceMilestone = normalizeMilestoneLabel(
		block.tasks.find((t) => t.id === options.sourceTaskId)?.milestone,
	);
	const now = new Date().toISOString();
	const issueLine =
		options.issues.length > 0
			? options.issues.join("; ")
			: options.deliveryMode === "apply-to-branch"
				? "completion pending explicit promotion"
				: `delivery mode '${options.deliveryMode}' requires promotion`;
	const line = `[${now}] auto-queued from colony ${options.colonyId}: ${issueLine}`;
	const checklist = [
		"Coletar inventário final de arquivos alterados e validar se aplica ao branch alvo.",
		"Executar/registrar comandos de validação (smoke/regression) e anexar evidências.",
		"Promover candidate para revisão humana (sem auto-close).",
	];

	if (idx === -1) {
		block.tasks.push({
			id: recoveryTaskId,
			description: `[RECOVERY:colony] Promote candidate ${options.sourceTaskId}${options.goal ? ` — ${options.goal}` : ""}`,
			status: "planned",
			depends_on: [options.sourceTaskId],
			acceptance_criteria: checklist,
			notes: appendNote(undefined, line, options.config.maxNoteLines),
			...(sourceMilestone ? { milestone: sourceMilestone } : {}),
		});
		writeProjectTasksBlock(cwd, block);
		return { taskId: recoveryTaskId, changed: true };
	}

	const task = block.tasks[idx]!;
	let changed = false;
	const appendedNote = appendNoteOnceByNormalizedMessage(
		task.notes,
		line,
		options.config.maxNoteLines,
	);
	if (appendedNote.appended) {
		task.notes = appendedNote.notes;
		changed = true;
	}
	if (task.status === "completed" || task.status === "cancelled") {
		task.status = "planned";
		changed = true;
	}
	if (!Array.isArray(task.depends_on)) {
		task.depends_on = [];
		changed = true;
	}
	if (!task.depends_on.includes(options.sourceTaskId)) {
		task.depends_on.push(options.sourceTaskId);
		changed = true;
	}
	if (
		!Array.isArray(task.acceptance_criteria) ||
		task.acceptance_criteria.length === 0
	) {
		task.acceptance_criteria = checklist;
		changed = true;
	}
	if (sourceMilestone && task.milestone !== sourceMilestone) {
		task.milestone = sourceMilestone;
		changed = true;
	}
	if (changed) writeProjectTasksBlock(cwd, block);
	return { taskId: recoveryTaskId, changed };
}

export function extractColonyGoalFromMessageText(
	text: string,
): string | undefined {
	const m = text.match(/(?:Colony launched[^:]*:|\/colony\s+)([^\n]+)/i);
	if (!m) return undefined;
	const goal = m[1].trim();
	return goal.length > 0 ? goal : undefined;
}
