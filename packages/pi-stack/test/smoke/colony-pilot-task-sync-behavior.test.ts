import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
});
