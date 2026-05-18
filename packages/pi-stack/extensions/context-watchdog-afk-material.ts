import { readProjectTasksArray } from "./context-watchdog-operator-brief";
import {
	taskHasLocalProtectedSignal,
	taskHasLocalRiskSignal,
	taskValidationGateKnown,
} from "./guardrails-core-task-contracts";

export type AfkMaterialReadinessDecision = "continue" | "seed-backlog" | "blocked";

export interface AfkMaterialReadinessSnapshot {
	decision: AfkMaterialReadinessDecision;
	recommendationCode:
		| "afk-material-continue-stock-healthy"
		| "afk-material-seed-backlog-low-stock"
		| "afk-material-blocked-focus-invalid";
	nextAction: string;
	blockedReasons: string[];
	stock: {
		minReadySlices: number;
		targetSlices: number;
		localSafeCount: number;
		validationKnownCount: number;
	};
}

export function buildAfkMaterialReadinessSnapshot(cwd: string, focusTasks: string, minReadySlices = 3, targetSlices = 7): AfkMaterialReadinessSnapshot {
	const tasks = readProjectTasksArray(cwd)
		.filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === "object");
	const candidates = tasks.filter((task) => {
		const status = typeof task.status === "string" ? task.status : "";
		if (status !== "in-progress" && status !== "planned") return false;
		if (taskHasLocalProtectedSignal(task)) return false;
		if (taskHasLocalRiskSignal(task)) return false;
		return true;
	});
	const validationKnown = candidates.filter((task) => taskValidationGateKnown(task));

	const focusIds = focusTasks === "none-listed"
		? []
		: focusTasks
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	const focusMap = new Map(
		tasks
			.map((task) => {
				const id = typeof task.id === "string" ? task.id.trim() : "";
				return id ? [id, task] as const : undefined;
			})
			.filter((item): item is readonly [string, Record<string, unknown>] => Boolean(item)),
	);
	const blockedReasons: string[] = [];
	if (focusIds.length <= 0) blockedReasons.push("focus-missing");
	for (const id of focusIds) {
		const task = focusMap.get(id) ?? focusMap.get(id.toUpperCase());
		if (!task) {
			blockedReasons.push("focus-task-not-found");
			continue;
		}
		if (!taskValidationGateKnown(task)) blockedReasons.push("focus-validation-unknown");
	}

	const minReady = Math.max(1, Math.min(20, Math.floor(minReadySlices)));
	const targetReady = Math.max(minReady, Math.min(20, Math.floor(targetSlices)));

	if (blockedReasons.length > 0) {
		return {
			decision: "blocked",
			recommendationCode: "afk-material-blocked-focus-invalid",
			nextAction: "fix focus/validation before AFK continuation.",
			blockedReasons: [...new Set(blockedReasons)],
			stock: {
				minReadySlices: minReady,
				targetSlices: targetReady,
				localSafeCount: candidates.length,
				validationKnownCount: validationKnown.length,
			},
		};
	}

	if (validationKnown.length < minReady) {
		return {
			decision: "seed-backlog",
			recommendationCode: "afk-material-seed-backlog-low-stock",
			nextAction: "seed backlog now (brainstorm packet + seed preview + operator decision).",
			blockedReasons: [],
			stock: {
				minReadySlices: minReady,
				targetSlices: targetReady,
				localSafeCount: candidates.length,
				validationKnownCount: validationKnown.length,
			},
		};
	}

	return {
		decision: "continue",
		recommendationCode: "afk-material-continue-stock-healthy",
		nextAction: "continue bounded AFK slice; stock is healthy.",
		blockedReasons: [],
		stock: {
			minReadySlices: minReady,
			targetSlices: targetReady,
			localSafeCount: candidates.length,
			validationKnownCount: validationKnown.length,
		},
	};
}
