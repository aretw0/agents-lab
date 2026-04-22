import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyCanonicalTaskEventToProjectTask,
	buildCanonicalTaskEventFromColonySignal,
	canonicalTaskEventTypeToProjectTaskStatus,
	colonyPhaseToCanonicalTaskEventType,
	normalizeCanonicalEvidenceRefs,
	readProjectTasksBlock,
	upsertProjectTaskFromColonySignal,
	type ColonyTaskSyncConfigShape,
} from "../../extensions/colony-pilot-task-sync";

function cfg(overrides?: Partial<ColonyTaskSyncConfigShape>): ColonyTaskSyncConfigShape {
	return {
		createOnLaunch: true,
		trackProgress: true,
		markTerminalState: true,
		taskIdPrefix: "colony",
		requireHumanClose: true,
		maxNoteLines: 20,
		recoveryTaskSuffix: "promotion",
		...overrides,
	};
}

describe("colony-pilot task-sync behavior", () => {
	it("creates execution task on launched when opt-in createOnLaunch is enabled", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-task-sync-behavior-"));
		try {
			const result = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "launched", id: "c-optin" },
				{ config: cfg({ createOnLaunch: true }), source: "ant_colony" },
			);
			expect(result.changed).toBe(true);
			const block = readProjectTasksBlock(cwd);
			const task = block.tasks.find((t) => t.id === result.taskId);
			expect(task).toBeDefined();
			expect(task?.status).toBe("in-progress");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not create task on launched when createOnLaunch is disabled", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-task-sync-no-launch-"));
		try {
			const result = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "launched", id: "c-skip" },
				{ config: cfg({ createOnLaunch: false }), source: "ant_colony" },
			);
			expect(result.changed).toBe(false);
			const block = readProjectTasksBlock(cwd);
			expect(block.tasks.length).toBe(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("keeps completed colony as candidate (in-progress) when requireHumanClose is true", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-task-sync-candidate-"));
		try {
			const launch = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "launched", id: "c-human" },
				{ config: cfg({ requireHumanClose: true }), source: "ant_colony" },
			);
			expect(launch.changed).toBe(true);

			const done = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "completed", id: "c-human" },
				{
					config: cfg({ requireHumanClose: true }),
					taskIdOverride: launch.taskId,
					source: "ant_colony",
				},
			);
			expect(done.changed).toBe(true);
			const block = readProjectTasksBlock(cwd);
			const task = block.tasks.find((t) => t.id === launch.taskId);
			expect(task?.status).toBe("in-progress");
			expect(task?.notes ?? "").toContain("candidate only");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("maps completed/budget_exceeded through canonical event semantics in task status", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-task-sync-terminal-semantics-"));
		try {
			const launch = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "launched", id: "c-terminal" },
				{ config: cfg({ requireHumanClose: false }), source: "ant_colony" },
			);
			expect(launch.changed).toBe(true);

			const doneVerified = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "completed", id: "c-terminal" },
				{
					config: cfg({ requireHumanClose: false }),
					taskIdOverride: launch.taskId,
					source: "ant_colony",
				},
			);
			expect(doneVerified.status).toBe("completed");

			const recovery = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "budget_exceeded", id: "c-terminal" },
				{
					config: cfg({ requireHumanClose: false }),
					taskIdOverride: launch.taskId,
					source: "ant_colony",
				},
			);
			expect(recovery.status).toBe("blocked");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("updates same board task across start/progress/end without replacing canonical board", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-task-sync-progress-"));
		try {
			const launch = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "launched", id: "c-flow" },
				{ config: cfg(), source: "ant_colony" },
			);
			expect(launch.changed).toBe(true);

			const progress = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "running", id: "c-flow" },
				{ config: cfg(), taskIdOverride: launch.taskId, source: "ant_colony" },
			);
			expect(progress.changed).toBe(true);

			const failed = upsertProjectTaskFromColonySignal(
				cwd,
				{ phase: "failed", id: "c-flow" },
				{ config: cfg(), taskIdOverride: launch.taskId, source: "ant_colony" },
			);
			expect(failed.changed).toBe(true);

			const block = readProjectTasksBlock(cwd);
			expect(block.tasks.length).toBe(1);
			const task = block.tasks[0];
			expect(task?.id).toBe(launch.taskId);
			expect(task?.status).toBe("blocked");
			expect(task?.notes ?? "").toContain("phase=launched");
			expect(task?.notes ?? "").toContain("phase=running");
			expect(task?.notes ?? "").toContain("phase=failed");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("maps colony signals into canonical task_event envelope for adapter portability", () => {
		expect(colonyPhaseToCanonicalTaskEventType("launched", true)).toBe("start");
		expect(colonyPhaseToCanonicalTaskEventType("running", true)).toBe("progress");
		expect(colonyPhaseToCanonicalTaskEventType("task_done", true)).toBe("review");
		expect(colonyPhaseToCanonicalTaskEventType("completed", true)).toBe("done_candidate");
		expect(colonyPhaseToCanonicalTaskEventType("completed", false)).toBe("done_verified");
		expect(colonyPhaseToCanonicalTaskEventType("budget_exceeded", true)).toBe("recovery");
		expect(colonyPhaseToCanonicalTaskEventType("unknown", true)).toBeUndefined();

		expect(canonicalTaskEventTypeToProjectTaskStatus("start")).toBe("in-progress");
		expect(canonicalTaskEventTypeToProjectTaskStatus("progress")).toBe("in-progress");
		expect(canonicalTaskEventTypeToProjectTaskStatus("review")).toBe("in-progress");
		expect(canonicalTaskEventTypeToProjectTaskStatus("done_candidate")).toBe("in-progress");
		expect(canonicalTaskEventTypeToProjectTaskStatus("done_verified")).toBe("completed");
		expect(canonicalTaskEventTypeToProjectTaskStatus("recovery")).toBe("blocked");

		const event = buildCanonicalTaskEventFromColonySignal({
			taskId: "TASK-BUD-018",
			signal: { phase: "running", id: "colony-abc" },
			requireHumanClose: true,
			timestamp: "2026-04-22T02:30:00.000Z",
			source: "colony",
			evidenceRefs: ["docs/research/colony-project-task-bridge.md"],
		});
		expect(event).toBeDefined();
		expect(event?.taskId).toBe("TASK-BUD-018");
		expect(event?.type).toBe("progress");
		expect(event?.timestamp).toBe("2026-04-22T02:30:00.000Z");
		expect(event?.eventId).toContain("task-bud-018-colony-abc-running");
		expect(event?.evidenceRefs).toEqual(["docs/research/colony-project-task-bridge.md"]);

		const projected = applyCanonicalTaskEventToProjectTask(
			{ id: "TASK-BUD-018", description: "adapter ingest", status: "planned" },
			{ type: "done_verified", source: "ci", timestamp: "2026-04-22T02:31:00.000Z" },
			{ maxNoteLines: 5 },
		);
		expect(projected.status).toBe("completed");
		expect(projected.notes ?? "").toContain("task_event type=done_verified source=ci");
	});

	it("normalizes canonical evidence refs deterministically", () => {
		expect(normalizeCanonicalEvidenceRefs(undefined)).toBeUndefined();
		expect(
			normalizeCanonicalEvidenceRefs([
				" docs/research/bridge.md ",
				"",
				"docs/research/bridge.md",
				"docs/research/adapter.md",
			]),
		).toEqual([
			"docs/research/bridge.md",
			"docs/research/adapter.md",
		]);
	});

	it("keeps canonical eventId deterministic when timestamp is invalid", () => {
		const first = buildCanonicalTaskEventFromColonySignal({
			taskId: "TASK-BUD-018",
			signal: { phase: "running", id: "colony-abc" },
			requireHumanClose: true,
			timestamp: "",
			source: "colony",
		});
		const second = buildCanonicalTaskEventFromColonySignal({
			taskId: "TASK-BUD-018",
			signal: { phase: "running", id: "colony-abc" },
			requireHumanClose: true,
			timestamp: "",
			source: "colony",
		});
		expect(first?.eventId).toBe(second?.eventId);
		expect(first?.eventId).toContain("ts-unknown");
	});
});
