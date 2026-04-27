import { describe, expect, it } from "vitest";
import {
	formatStateReconcilePlan,
	resolveStateReconcilePlan,
} from "../../extensions/guardrails-core-state-reconcile";

describe("guardrails-core state reconcile", () => {
	it("returns safe atomic default for single-writer board", () => {
		const plan = resolveStateReconcilePlan({
			artifactKind: "board",
			runtimeMode: "native",
			deliveryChannel: "direct-branch",
			parallelWriters: 1,
		});

		expect(plan.recommendedPolicies).toContain("lock-and-atomic-write");
		expect(plan.concurrencyRisk).toBe("low");
		expect(plan.manualReviewRequired).toBe(false);
	});

	it("requires single-writer policy for multi-writer lane", () => {
		const plan = resolveStateReconcilePlan({
			artifactKind: "settings",
			runtimeMode: "container",
			deliveryChannel: "direct-branch",
			parallelWriters: 3,
		});

		expect(plan.concurrencyRisk).toBe("high");
		expect(plan.recommendedPolicies).toContain("single-writer-branch");
		expect(plan.reasonCodes).toContain("parallel-writers-detected");
	});

	it("adds reviewed-promotion policy for PR/MR channels", () => {
		const plan = resolveStateReconcilePlan({
			artifactKind: "board",
			runtimeMode: "ci",
			deliveryChannel: "pull-request",
			parallelWriters: 2,
		});

		expect(plan.recommendedPolicies).toContain("reviewed-promotion");
		expect(plan.manualReviewRequired).toBe(true);
		expect(plan.reasonCodes).toContain("reviewed-channel");
	});

	it("formats plan consistently", () => {
		const plan = resolveStateReconcilePlan({
			artifactKind: "handoff",
			runtimeMode: "ci",
			deliveryChannel: "merge-request",
			parallelWriters: 2,
			preferGeneratedStep: true,
		});
		const lines = formatStateReconcilePlan(plan).join("\n");

		expect(lines).toContain("state-reconcile");
		expect(lines).toContain("channel: merge-request");
		expect(lines).toContain("manualReviewRequired: yes");
		expect(lines).toContain("generated-apply-step");
	});
});
