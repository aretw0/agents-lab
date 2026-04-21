import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type BoardTaskStatus =
	| "planned"
	| "in-progress"
	| "completed"
	| "blocked"
	| "cancelled"
	| "unknown";

export interface BoardClockSnapshot {
	exists: boolean;
	total: number;
	byStatus: Record<BoardTaskStatus, number>;
	inProgressIds: string[];
	blockedIds: string[];
}

const EMPTY_COUNTS: Record<BoardTaskStatus, number> = {
	planned: 0,
	"in-progress": 0,
	completed: 0,
	blocked: 0,
	cancelled: 0,
	unknown: 0,
};

function normalizeStatus(raw: unknown): BoardTaskStatus {
	if (raw === "planned") return "planned";
	if (raw === "in-progress") return "in-progress";
	if (raw === "completed") return "completed";
	if (raw === "blocked") return "blocked";
	if (raw === "cancelled") return "cancelled";
	return "unknown";
}

export function readBoardClockSnapshot(cwd: string): BoardClockSnapshot {
	const tasksPath = path.join(cwd, ".project", "tasks.json");
	if (!existsSync(tasksPath)) {
		return {
			exists: false,
			total: 0,
			byStatus: { ...EMPTY_COUNTS },
			inProgressIds: [],
			blockedIds: [],
		};
	}

	try {
		const raw = JSON.parse(readFileSync(tasksPath, "utf8")) as {
			tasks?: Array<{ id?: unknown; status?: unknown }>;
		};
		const tasks = Array.isArray(raw?.tasks) ? raw.tasks : [];
		const byStatus = { ...EMPTY_COUNTS };
		const inProgressIds: string[] = [];
		const blockedIds: string[] = [];

		for (const task of tasks) {
			const status = normalizeStatus(task?.status);
			byStatus[status] += 1;
			const id = typeof task?.id === "string" && task.id.trim() ? task.id.trim() : undefined;
			if (!id) continue;
			if (status === "in-progress" && inProgressIds.length < 5) inProgressIds.push(id);
			if (status === "blocked" && blockedIds.length < 5) blockedIds.push(id);
		}

		return {
			exists: true,
			total: tasks.length,
			byStatus,
			inProgressIds,
			blockedIds,
		};
	} catch {
		return {
			exists: false,
			total: 0,
			byStatus: { ...EMPTY_COUNTS },
			inProgressIds: [],
			blockedIds: [],
		};
	}
}

export function formatBoardClockStatus(snapshot: BoardClockSnapshot): string | undefined {
	if (!snapshot.exists) return undefined;
	const ip = snapshot.byStatus["in-progress"];
	const blk = snapshot.byStatus.blocked;
	const planned = snapshot.byStatus.planned;
	return `[board] ip=${ip} blk=${blk} plan=${planned}`;
}
