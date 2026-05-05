import { readProjectTaskStatusById } from "./context-watchdog-operator-brief";

export type HandoffGrowthMaturitySnapshot = {
	source: "handoff";
	decision?: "go" | "hold" | "needs-evidence";
	score?: number;
	recommendationCode?: string;
	freshness?: "fresh" | "stale" | "unknown";
};

export function resolveHandoffGrowthMaturitySnapshot(handoff: Record<string, unknown>): HandoffGrowthMaturitySnapshot | undefined {
	const contextWatch = handoff.context_watch && typeof handoff.context_watch === "object"
		? handoff.context_watch as Record<string, unknown>
		: undefined;
	const direct = contextWatch?.growth_maturity && typeof contextWatch.growth_maturity === "object"
		? contextWatch.growth_maturity as Record<string, unknown>
		: undefined;
	const events = Array.isArray(handoff.context_watch_events)
		? handoff.context_watch_events
		: [];
	const eventSnapshot = events
		.slice()
		.reverse()
		.find((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).growth_maturity === "object");
	const eventGrowth = eventSnapshot && typeof eventSnapshot === "object"
		? (eventSnapshot as Record<string, unknown>).growth_maturity as Record<string, unknown>
		: undefined;
	const source = direct ?? eventGrowth;
	if (!source) return undefined;

	const decisionRaw = source.decision;
	const decision = decisionRaw === "go" || decisionRaw === "hold" || decisionRaw === "needs-evidence"
		? decisionRaw
		: undefined;
	const scoreRaw = source.score;
	const score = typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
		? Math.max(0, Math.min(100, Math.round(scoreRaw)))
		: undefined;
	const recommendationCode = typeof source.recommendationCode === "string" && source.recommendationCode.trim().length > 0
		? source.recommendationCode.trim()
		: undefined;
	if (!decision && score === undefined && !recommendationCode) return undefined;
	return {
		source: "handoff",
		decision,
		score,
		recommendationCode,
	};
}

export function applyCheckpointTaskStatusFocus(
	cwd: string,
	checkpoint: Record<string, unknown>,
	taskId: string,
): void {
	if (!taskId || taskId === "n/a") return;
	const taskStatusById = readProjectTaskStatusById(cwd);
	const status = taskStatusById[taskId] ?? taskStatusById[taskId.toUpperCase()];
	if (status !== "completed") return;
	delete checkpoint.current_tasks;
	checkpoint.completed_tasks = [taskId];
	const contextWatch = checkpoint.context_watch;
	if (contextWatch && typeof contextWatch === "object") {
		(contextWatch as Record<string, unknown>).focus_task_status = "completed";
	}
}
