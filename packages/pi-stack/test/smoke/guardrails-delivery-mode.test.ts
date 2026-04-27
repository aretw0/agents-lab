import { describe, expect, it } from "vitest";
import {
	formatDeliveryModePlan,
	resolveDeliveryModePlan,
} from "../../extensions/guardrails-core-delivery-mode";

describe("guardrails-core delivery mode", () => {
	it("resolves github actions pull request mode deterministically", () => {
		const plan = resolveDeliveryModePlan({
			env: {
				GITHUB_ACTIONS: "true",
				GITHUB_EVENT_NAME: "pull_request",
			},
		});
		expect(plan.runtimeMode).toBe("ci");
		expect(plan.ciProvider).toBe("github-actions");
		expect(plan.deliveryChannel).toBe("pull-request");
		expect(plan.confidence).toBe("high");
		expect(plan.signals).toContain("GITHUB_ACTIONS=true");
	});

	it("resolves gitlab merge-request mode deterministically", () => {
		const plan = resolveDeliveryModePlan({
			env: {
				GITLAB_CI: "true",
				CI_MERGE_REQUEST_IID: "42",
			},
		});
		expect(plan.runtimeMode).toBe("ci");
		expect(plan.ciProvider).toBe("gitlab-ci");
		expect(plan.deliveryChannel).toBe("merge-request");
		expect(plan.signals).toContain("CI_MERGE_REQUEST_IID=42");
	});

	it("detects container runtime and keeps direct-branch default", () => {
		const plan = resolveDeliveryModePlan({
			env: {
				DEVCONTAINER: "1",
			},
		});
		expect(plan.runtimeMode).toBe("container");
		expect(plan.deliveryChannel).toBe("direct-branch");
		expect(plan.confidence).toBe("medium");
		expect(plan.signals).toContain("DEVCONTAINER=true");
	});

	it("honors explicit PI_DELIVERY_CHANNEL override", () => {
		const plan = resolveDeliveryModePlan({
			env: {
				PI_DELIVERY_CHANNEL: "mr",
			},
		});
		expect(plan.runtimeMode).toBe("native");
		expect(plan.deliveryChannel).toBe("merge-request");
		expect(plan.confidence).toBe("high");

		const formatted = formatDeliveryModePlan(plan).join("\n");
		expect(formatted).toContain("channel: merge-request");
		expect(formatted).toContain("confidence: high");
	});
});
