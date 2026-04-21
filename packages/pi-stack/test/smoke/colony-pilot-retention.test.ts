import {
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
	captureColonyRuntimeSnapshot,
	persistColonyRetentionRecord,
	pruneColonyRetention,
	readColonyRetentionSnapshot,
} from "../../extensions/colony-pilot-candidate-retention";

describe("colony-pilot candidate retention", () => {
	it("persiste e lista snapshot de retenção", () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-retention-"));
		try {
			const first = persistColonyRetentionRecord(cwd, {
				colonyId: "c-123",
				phase: "completed",
				capturedAtIso: "2026-04-19T00:00:00.000Z",
				goal: "Promover candidate para revisão",
				deliveryMode: "patch-artifact",
				deliveryIssues: ["delivery evidence missing: validation command log"],
				messageExcerpt: "[COLONY_SIGNAL:COMPLETE] [c-123]",
				mirrors: [{ path: "x", exists: false }],
			});

			expect(first.changed).toBe(true);

			const second = persistColonyRetentionRecord(cwd, {
				colonyId: "c-123",
				phase: "completed",
				capturedAtIso: "2026-04-19T00:00:00.000Z",
				goal: "Promover candidate para revisão",
				deliveryMode: "patch-artifact",
				deliveryIssues: ["delivery evidence missing: validation command log"],
				messageExcerpt: "[COLONY_SIGNAL:COMPLETE] [c-123]",
				mirrors: [{ path: "x", exists: false }],
			});

			expect(second.changed).toBe(false);

			const snapshot = readColonyRetentionSnapshot(cwd, 5);
			expect(snapshot.exists).toBe(true);
			expect(snapshot.count).toBe(1);
			expect(snapshot.records[0]?.record.colonyId).toBe("c-123");
			expect(snapshot.records[0]?.record.phase).toBe("completed");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("trunca messageExcerpt e limita fields auxiliares", () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-retention-trunc-"));
		try {
			const huge = "x".repeat(8000);
			const res = persistColonyRetentionRecord(cwd, {
				colonyId: "c-huge",
				phase: "failed",
				capturedAtIso: "2026-04-19T00:00:00.000Z",
				messageExcerpt: huge,
				deliveryIssues: Array.from({ length: 50 }, (_, i) => `issue-${i}`),
				mirrors: Array.from({ length: 20 }, (_, i) => ({
					path: `m-${i}`,
					exists: i % 2 === 0,
				})),
			});

			expect(res.changed).toBe(true);
			const raw = JSON.parse(readFileSync(res.path, "utf8"));
			expect(String(raw.messageExcerpt).length).toBeLessThanOrEqual(4000);
			expect(Array.isArray(raw.deliveryIssues)).toBe(true);
			expect(raw.deliveryIssues.length).toBeLessThanOrEqual(20);
			expect(Array.isArray(raw.mirrors)).toBe(true);
			expect(raw.mirrors.length).toBeLessThanOrEqual(8);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("captura runtime snapshot em failed/budget e registra caminho de recovery", () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-retention-runtime-"));
		try {
			const mirror = join(cwd, ".sandbox", "pi-agent", "ant-colony", "x");
			const colonyRoot = join(mirror, "colonies", "colony-abc123");
			const tasksRoot = join(colonyRoot, "tasks");
			mkdirSync(tasksRoot, { recursive: true });

			writeFileSync(
				join(colonyRoot, "state.json"),
				JSON.stringify(
					{
						id: "colony-abc123",
						status: "budget_exceeded",
						goal: "demo",
						workspace: {
							branch: "ant-colony/c1-xyz",
							worktreeRoot: "C:/tmp/worktree/c1-xyz",
						},
					},
					null,
					2,
				),
			);

			writeFileSync(
				join(tasksRoot, "t-1.json"),
				JSON.stringify(
					{
						id: "t-1",
						title: "worker task",
						status: "done",
						result: "final patch summary",
					},
					null,
					2,
				),
			);

			const snap = captureColonyRuntimeSnapshot(cwd, {
				colonyId: "c1",
				runtimeColonyId: "colony-abc123",
				mirrors: [{ path: mirror, exists: true }],
			});

			expect(snap).toBeDefined();
			expect(snap?.colonyRuntimeId).toBe("colony-abc123");
			expect(snap?.relativeSnapshotPath).toContain(
				".pi/colony-retention/runtime-artifacts/c1.runtime-snapshot.json",
			);

			const payload = JSON.parse(readFileSync(snap!.snapshotPath, "utf8"));
			expect(payload.runtimeColonyId).toBe("colony-abc123");
			expect(payload.tasksCaptured).toBe(1);

			persistColonyRetentionRecord(cwd, {
				colonyId: "c1",
				phase: "budget_exceeded",
				capturedAtIso: "2026-04-21T00:00:00.000Z",
				runtimeColonyId: "colony-abc123",
				runtimeSnapshotPath: snap?.snapshotPath,
				runtimeSnapshotTaskCount: snap?.taskCount,
			});

			const retention = readColonyRetentionSnapshot(cwd, 1);
			expect(retention.records[0]?.record.runtimeSnapshotPath).toContain(
				".pi/colony-retention/runtime-artifacts/c1.runtime-snapshot.json",
			);
			expect(retention.records[0]?.record.runtimeSnapshotTaskCount).toBe(1);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("aplica prune determinístico por idade e quantidade", () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-retention-prune-"));
		try {
			const r1 = persistColonyRetentionRecord(cwd, {
				colonyId: "c-old",
				phase: "failed",
				capturedAtIso: "2026-04-18T00:00:00.000Z",
			});
			persistColonyRetentionRecord(cwd, {
				colonyId: "c-mid",
				phase: "completed",
				capturedAtIso: "2026-04-19T00:00:00.000Z",
			});
			persistColonyRetentionRecord(cwd, {
				colonyId: "c-new",
				phase: "completed",
				capturedAtIso: "2026-04-19T01:00:00.000Z",
			});

			const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
			utimesSync(r1.path, old, old);

			const prune = pruneColonyRetention(cwd, { maxEntries: 1, maxAgeDays: 2 });
			expect(prune.deleted).toBeGreaterThanOrEqual(2);
			expect(prune.deletedByAge).toBeGreaterThanOrEqual(1);

			const snapshot = readColonyRetentionSnapshot(cwd, 10);
			expect(snapshot.count).toBe(1);
			expect(["c-mid", "c-new"]).toContain(
				snapshot.records[0]?.record.colonyId,
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
