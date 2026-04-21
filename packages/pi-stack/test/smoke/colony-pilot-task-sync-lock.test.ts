import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	writeProjectTasksBlock,
	type ProjectTasksBlock,
} from "../../extensions/colony-pilot-task-sync";

describe("colony-pilot task-sync lock", () => {
	function sampleBlock(): ProjectTasksBlock {
		return {
			tasks: [
				{
					id: "colony-cx",
					description: "[COLONY] sample",
					status: "in-progress",
				},
			],
		};
	}

	it("writes tasks atomically and releases lock file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-task-sync-"));
		try {
			writeProjectTasksBlock(cwd, sampleBlock());
			const tasksPath = join(cwd, ".project", "tasks.json");
			const lockPath = join(cwd, ".project", "tasks.lock");
			const raw = JSON.parse(readFileSync(tasksPath, "utf8"));
			expect(raw.tasks[0]?.id).toBe("colony-cx");
			expect(existsSync(lockPath)).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("reclaims stale lock deterministically", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-task-sync-stale-"));
		try {
			const projectDir = join(cwd, ".project");
			mkdirSync(projectDir, { recursive: true });
			const lockPath = join(projectDir, "tasks.lock");
			writeFileSync(lockPath, "stale");
			const old = new Date(Date.now() - 10 * 60_000);
			utimesSync(lockPath, old, old);

			writeProjectTasksBlock(cwd, sampleBlock(), {
				staleMs: 100,
				maxWaitMs: 200,
				retryMs: 10,
			});

			expect(existsSync(lockPath)).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails fast on fresh lock timeout", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-task-sync-timeout-"));
		try {
			const projectDir = join(cwd, ".project");
			mkdirSync(projectDir, { recursive: true });
			const lockPath = join(projectDir, "tasks.lock");
			writeFileSync(lockPath, "busy");

			expect(() =>
				writeProjectTasksBlock(cwd, sampleBlock(), {
					staleMs: 60_000,
					maxWaitMs: 50,
					retryMs: 10,
				}),
			).toThrow(/lock timeout/i);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
