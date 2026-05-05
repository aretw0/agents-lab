import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ContextWatchDeterministicStopReason, ContextWatchOperatorActionKind } from "./context-watchdog-operator-signals";

export function readProjectTasksArray(cwd: string): unknown[] {
	const filePath = path.join(cwd, ".project", "tasks.json");
	if (!existsSync(filePath)) return [];
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		const tasks = Array.isArray(parsed) ? parsed : (parsed as { tasks?: unknown[] } | undefined)?.tasks;
		return Array.isArray(tasks) ? tasks : [];
	} catch {
		return [];
	}
}

export function readProjectTaskStatusById(cwd: string): Record<string, string | undefined> {
	const statuses: Record<string, string | undefined> = {};
	for (const task of readProjectTasksArray(cwd)) {
		const id = (task as { id?: unknown } | undefined)?.id;
		const status = (task as { status?: unknown } | undefined)?.status;
		if (typeof id !== "string" || typeof status !== "string") continue;
		statuses[id] = status;
		statuses[id.toUpperCase()] = status;
	}
	return statuses;
}

export type ContextWatchOperatorBriefOption = {
	option: string;
	impact: string;
};

export type ContextWatchOperatorBrief = {
	whyPaused: string;
	focusTaskId?: string;
	focusMnemonic?: string;
	options: ContextWatchOperatorBriefOption[];
	recommendation: string;
};

export function readProjectTaskDescriptionById(cwd: string, taskId?: string): string | undefined {
	if (!taskId) return undefined;
	for (const task of readProjectTasksArray(cwd)) {
		const id = (task as { id?: unknown }).id;
		if (typeof id !== "string" || id.toUpperCase() !== taskId.toUpperCase()) continue;
		const description = (task as { description?: unknown }).description;
		return typeof description === "string" ? description.trim() : undefined;
	}
	return undefined;
}

export function toOperatorTaskMnemonic(taskId?: string, description?: string): string | undefined {
	if (!taskId) return undefined;
	const cleaned = typeof description === "string"
		? description
			.replace(/\[[^\]]+\]\s*/g, "")
			.replace(/\s+/g, " ")
			.trim()
		: "";
	const shortDescription = cleaned.length > 0
		? cleaned.split(/[.;]/)[0].trim().slice(0, 72)
		: "";
	return shortDescription.length > 0 ? `${taskId}:${shortDescription}` : taskId;
}

export function resolvePrimaryHandoffTaskId(handoff: Record<string, unknown>): string | undefined {
	if (!Array.isArray(handoff.current_tasks)) return undefined;
	const first = handoff.current_tasks.find((row): row is string => typeof row === "string" && row.trim().length > 0);
	return first ? first.trim() : undefined;
}


export function buildContextWatchOperatorBrief(input: {
	cwd: string;
	handoff: Record<string, unknown>;
	operatorActionKind: ContextWatchOperatorActionKind;
	deterministicStopReason: ContextWatchDeterministicStopReason;
	timeoutPressureActive?: boolean;
	timeoutPressureCount?: number;
	timeoutPressureThreshold?: number;
}): ContextWatchOperatorBrief {
	const focusTaskId = resolvePrimaryHandoffTaskId(input.handoff);
	const focusMnemonic = toOperatorTaskMnemonic(focusTaskId, readProjectTaskDescriptionById(input.cwd, focusTaskId));

	const timeoutPressureActive = input.timeoutPressureActive === true;
	const timeoutPressureCount = Math.max(0, Math.floor(Number(input.timeoutPressureCount ?? 0)));
	const timeoutPressureThreshold = Math.max(1, Math.floor(Number(input.timeoutPressureThreshold ?? 2)));

	if (input.operatorActionKind === "reload") {
		return {
			whyPaused: timeoutPressureActive
				? `Runtime reload is required and provider timeout pressure was observed (${timeoutPressureCount}/${timeoutPressureThreshold}).`
				: "Runtime reload is required before safe continuation.",
			focusTaskId,
			focusMnemonic,
			options: [
				{ option: "reload", impact: "Load latest runtime and reopen continuation gates." },
				{ option: "defer", impact: "Stay paused; continuation may use stale behavior." },
			],
			recommendation: "reload",
		};
	}

	if (input.operatorActionKind === "checkpoint-compact" || input.operatorActionKind === "compact-final-warning") {
		const timeoutSuffix = timeoutPressureActive
			? ` Timeout pressure observed (${timeoutPressureCount}/${timeoutPressureThreshold}); prefer idle guarded compact path.`
			: "";
		return {
			whyPaused: `Compact boundary reached; checkpoint/compact action is required before next slice.${timeoutSuffix}`,
			focusTaskId,
			focusMnemonic,
			options: [
				{ option: "checkpoint-compact", impact: "Persist progress and clear context pressure safely." },
				{ option: "defer", impact: "Delay compaction and increase context-window risk." },
			],
			recommendation: "checkpoint-compact",
		};
	}

	if (input.operatorActionKind === "timeout-pressure" || input.deterministicStopReason === "timeout-pressure") {
		return {
			whyPaused: `Provider timeout pressure detected near compact boundary (${timeoutPressureCount}/${timeoutPressureThreshold}).`,
			focusTaskId,
			focusMnemonic,
			options: [
				{ option: "keep-idle", impact: "Allow guarded compact/retry path to stabilize without new work." },
				{ option: "checkpoint", impact: "Persist concise handoff evidence before any manual retry." },
			],
			recommendation: "keep-idle",
		};
	}


	if (input.operatorActionKind === "handoff-refresh" || input.deterministicStopReason === "compact-checkpoint-required") {
		return {
			whyPaused: "Handoff freshness/consistency requires refresh before resume.",
			focusTaskId,
			focusMnemonic,
			options: [
				{ option: "refresh-handoff", impact: "Reconcile focus with board and restore deterministic resume." },
				{ option: "defer", impact: "Keep lane paused with stale handoff risk." },
			],
			recommendation: "refresh-handoff",
		};
	}

	return {
		whyPaused: "No blocking operator gate right now.",
		focusTaskId,
		focusMnemonic,
		options: [
			{ option: "continue", impact: "Proceed with bounded local-safe slice." },
			{ option: "checkpoint", impact: "Persist a concise checkpoint before continuing." },
		],
		recommendation: "continue",
	};
}

export function isProtectedAutoResumeTaskPath(value: unknown): boolean {
	const normalized = String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
	return normalized === ".pi/settings.json" || normalized === ".obsidian" || normalized.startsWith(".obsidian/") || normalized.startsWith(".github/");
}

export function taskIdNumericSuffix(id: string): number {
	const match = id.match(/(\d+)(?!.*\d)/);
	return match ? Number(match[1]) : -1;
}

export function readProjectPreferredActiveTaskIds(cwd: string, limit = 3): string[] {
	return readProjectTasksArray(cwd)
		.filter((task): task is { id: string; status: string; files?: unknown[] } => {
			const id = (task as { id?: unknown }).id;
			const status = (task as { status?: unknown }).status;
			if (typeof id !== "string" || typeof status !== "string") return false;
			if (status !== "in-progress" && status !== "planned") return false;
			const files = (task as { files?: unknown }).files;
			return !Array.isArray(files) || !files.some(isProtectedAutoResumeTaskPath);
		})
		.sort((a, b) => {
			const statusRank = (row: { status: string }) => row.status === "in-progress" ? 0 : 1;
			const byStatus = statusRank(a) - statusRank(b);
			if (byStatus !== 0) return byStatus;
			return taskIdNumericSuffix(b.id) - taskIdNumericSuffix(a.id);
		})
		.slice(0, limit)
		.map((task) => task.id);
}

