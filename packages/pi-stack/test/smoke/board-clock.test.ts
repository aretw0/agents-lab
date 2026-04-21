import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	formatBoardClockStatus,
	readBoardClockSnapshot,
} from "../../extensions/board-clock";

describe("board-clock snapshot", () => {
	it("returns missing snapshot when .project/tasks.json is absent", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-board-clock-missing-"));
		try {
			const snap = readBoardClockSnapshot(cwd);
			expect(snap.exists).toBe(false);
			expect(formatBoardClockStatus(snap)).toBeUndefined();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("computes deterministic counts and compact footer status", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-board-clock-counts-"));
		try {
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(
				join(cwd, ".project", "tasks.json"),
				JSON.stringify({
					tasks: [
						{ id: "t-1", status: "planned", description: "a" },
						{ id: "t-2", status: "in-progress", description: "b" },
						{ id: "t-3", status: "blocked", description: "c" },
						{ id: "t-4", status: "completed", description: "d" },
					],
				}),
			);

			const snap = readBoardClockSnapshot(cwd);
			expect(snap.exists).toBe(true);
			expect(snap.total).toBe(4);
			expect(snap.byStatus["in-progress"]).toBe(1);
			expect(snap.byStatus.blocked).toBe(1);
			expect(snap.byStatus.planned).toBe(1);
			expect(snap.inProgressIds).toEqual(["t-2"]);
			expect(snap.blockedIds).toEqual(["t-3"]);
			expect(formatBoardClockStatus(snap)).toBe("[board] ip=1 blk=1 plan=1");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
