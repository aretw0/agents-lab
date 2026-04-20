import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
