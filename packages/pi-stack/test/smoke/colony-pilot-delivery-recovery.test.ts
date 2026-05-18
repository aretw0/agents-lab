import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ensureRecoveryTaskForCandidate,
	parseDeliveryModeOverride,
	resolveColonyPilotProjectTaskSync,
} from "../../extensions/colony-pilot";

describe("colony-pilot delivery recovery", () => {
	it("ensureRecoveryTaskForCandidate cria task de promoção quando evidência está ausente", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-delivery-recovery-"));
		mkdirSync(join(dir, ".project"), { recursive: true });
		writeFileSync(
			join(dir, ".project", "tasks.json"),
			JSON.stringify({
				tasks: [
					{
						id: "colony-c1",
						status: "in-progress",
						description: "[COLONY] test",
						milestone: "MS-LOCAL",
					},
				],
			}),
		);

		const cfg = resolveColonyPilotProjectTaskSync({
			recoveryTaskSuffix: "promotion",
			maxNoteLines: 5,
		});
		const result = ensureRecoveryTaskForCandidate(dir, {
			sourceTaskId: "colony-c1",
			colonyId: "c1",
			goal: "meu objetivo",
			deliveryMode: "patch-artifact",
			issues: ["delivery evidence missing: file inventory"],
			config: cfg,
		});

		expect(result.changed).toBe(true);
		expect(result.taskId).toBe("colony-c1-promotion");

		const raw = JSON.parse(
			require("node:fs").readFileSync(
				join(dir, ".project", "tasks.json"),
				"utf8",
			),
		);
		const recovery = raw.tasks.find(
			(t: { id: string }) => t.id === "colony-c1-promotion",
		);
		expect(recovery).toBeDefined();
		expect(recovery.status).toBe("planned");
		expect(recovery.milestone).toBe("MS-LOCAL");
		expect(recovery.notes).toMatch(/auto-queued/);
		expect(recovery.notes).toMatch(/file inventory/);

		rmSync(dir, { recursive: true, force: true });
	});

	it("ensureRecoveryTaskForCandidate não duplica task de promoção existente", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-delivery-nodup-"));
		mkdirSync(join(dir, ".project"), { recursive: true });
		writeFileSync(
			join(dir, ".project", "tasks.json"),
			JSON.stringify({
				tasks: [
					{
						id: "colony-c1",
						status: "in-progress",
						description: "[COLONY] test",
						milestone: "MS-LOCAL",
					},
					{
						id: "colony-c1-promotion",
						status: "planned",
						description: "[RECOVERY] existing",
						notes: "nota anterior",
					},
				],
			}),
		);

		const cfg = resolveColonyPilotProjectTaskSync({
			recoveryTaskSuffix: "promotion",
			maxNoteLines: 5,
		});
		const result = ensureRecoveryTaskForCandidate(dir, {
			sourceTaskId: "colony-c1",
			colonyId: "c1",
			goal: "meu objetivo",
			deliveryMode: "patch-artifact",
			issues: [],
			config: cfg,
		});

		expect(result.taskId).toBe("colony-c1-promotion");
		const repeated = ensureRecoveryTaskForCandidate(dir, {
			sourceTaskId: "colony-c1",
			colonyId: "c1",
			goal: "meu objetivo",
			deliveryMode: "patch-artifact",
			issues: [],
			config: cfg,
		});
		expect(repeated.changed).toBe(false);

		const raw = JSON.parse(
			require("node:fs").readFileSync(
				join(dir, ".project", "tasks.json"),
				"utf8",
			),
		);
		const promotions = raw.tasks.filter(
			(t: { id: string }) => t.id === "colony-c1-promotion",
		);
		expect(promotions.length).toBe(1);
		expect(promotions[0]?.milestone).toBe("MS-LOCAL");
		expect(String(promotions[0]?.notes).match(/auto-queued from colony/g)?.length).toBe(1);

		rmSync(dir, { recursive: true, force: true });
	});
});

describe("colony-pilot parsers — parseDeliveryModeOverride", () => {
	it("retorna apply-to-branch quando especificado", () => {
		expect(parseDeliveryModeOverride({ deliveryMode: "apply-to-branch" })).toBe(
			"apply-to-branch",
		);
	});

	it("retorna report-only quando especificado", () => {
		expect(parseDeliveryModeOverride({ deliveryMode: "report-only" })).toBe(
			"report-only",
		);
	});

	it("retorna patch-artifact quando especificado", () => {
		expect(parseDeliveryModeOverride({ deliveryMode: "patch-artifact" })).toBe(
			"patch-artifact",
		);
	});

	it("retorna undefined para valor desconhecido", () => {
		expect(
			parseDeliveryModeOverride({ deliveryMode: "invalid-mode" }),
		).toBeUndefined();
	});

	it("retorna undefined quando deliveryMode ausente", () => {
		expect(parseDeliveryModeOverride({ goal: "do something" })).toBeUndefined();
	});

	it("retorna undefined para input nulo", () => {
		expect(parseDeliveryModeOverride(null)).toBeUndefined();
	});

	it("retorna undefined para input nao-objeto", () => {
		expect(parseDeliveryModeOverride("apply-to-branch")).toBeUndefined();
		expect(parseDeliveryModeOverride(42)).toBeUndefined();
	});
});
