import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function writeProjectTasksBlock(cwd: string, block: ProjectTasksBlock) {
	const dir = path.join(cwd, ".project");
	mkdirSync(dir, { recursive: true });
	const p = path.join(dir, "tasks.json");
	writeFileSync(p, `${JSON.stringify({ tasks: block.tasks }, null, 2)}\n`);
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

function colonyPhaseToProjectTaskStatus(
	phase: ColonyPhase,
	requireHumanClose: boolean,
): ProjectTaskStatus {
	if (phase === "failed" || phase === "aborted" || phase === "budget_exceeded")
		return "blocked";
	if (phase === "completed")
		return requireHumanClose ? "in-progress" : "completed";
	return "in-progress";
}

export function upsertProjectTaskFromColonySignal(
	cwd: string,
	signal: { phase: ColonyPhase; id: string },
	options: {
		config: ColonyTaskSyncConfigShape;
		goal?: string;
		taskIdOverride?: string;
		source?: "ant_colony" | "manual";
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
		});
		writeProjectTasksBlock(cwd, block);
		return { taskId: recoveryTaskId, changed: true };
	}

	const task = block.tasks[idx]!;
	task.notes = appendNote(task.notes, line, options.config.maxNoteLines);
	if (task.status === "completed" || task.status === "cancelled") {
		task.status = "planned";
	}
	if (!Array.isArray(task.depends_on)) task.depends_on = [];
	if (!task.depends_on.includes(options.sourceTaskId))
		task.depends_on.push(options.sourceTaskId);
	if (
		!Array.isArray(task.acceptance_criteria) ||
		task.acceptance_criteria.length === 0
	) {
		task.acceptance_criteria = checklist;
	}
	writeProjectTasksBlock(cwd, block);
	return { taskId: recoveryTaskId, changed: true };
}

export function extractColonyGoalFromMessageText(
	text: string,
): string | undefined {
	const m = text.match(/(?:Colony launched[^:]*:|\/colony\s+)([^\n]+)/i);
	if (!m) return undefined;
	const goal = m[1].trim();
	return goal.length > 0 ? goal : undefined;
}
