import type { DeliveryChannel, DeliveryRuntimeMode } from "./guardrails-core-delivery-mode";

export type StateArtifactKind = "board" | "settings" | "handoff" | "generic-json";

export type StateReconcilePolicy =
	| "lock-and-atomic-write"
	| "single-writer-branch"
	| "generated-apply-step"
	| "reviewed-promotion";

export interface ResolveStateReconcilePlanInput {
	artifactKind?: StateArtifactKind;
	runtimeMode?: DeliveryRuntimeMode;
	deliveryChannel?: DeliveryChannel;
	parallelWriters?: number;
	preferGeneratedStep?: boolean;
}

export interface StateReconcilePlan {
	artifactKind: StateArtifactKind;
	runtimeMode: DeliveryRuntimeMode;
	deliveryChannel: DeliveryChannel;
	parallelWriters: number;
	concurrencyRisk: "low" | "medium" | "high";
	recommendedPolicies: StateReconcilePolicy[];
	reasonCodes: string[];
	manualReviewRequired: boolean;
}

function normalizeArtifactKind(value: unknown): StateArtifactKind {
	const normalized = String(value ?? "").trim().toLowerCase();
	if (normalized === "board") return "board";
	if (normalized === "settings") return "settings";
	if (normalized === "handoff") return "handoff";
	if (normalized === "generic-json" || normalized === "generic" || normalized === "json") {
		return "generic-json";
	}
	return "board";
}

function normalizeRuntimeMode(value: unknown): DeliveryRuntimeMode {
	const normalized = String(value ?? "").trim().toLowerCase();
	if (normalized === "container") return "container";
	if (normalized === "ci") return "ci";
	return "native";
}

function normalizeDeliveryChannel(value: unknown): DeliveryChannel {
	const normalized = String(value ?? "").trim().toLowerCase();
	if (normalized === "pull-request" || normalized === "pr" || normalized === "pull_request") {
		return "pull-request";
	}
	if (normalized === "merge-request" || normalized === "mr" || normalized === "merge_request") {
		return "merge-request";
	}
	return "direct-branch";
}

function normalizeParallelWriters(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) return 1;
	return Math.max(1, Math.min(20, Math.floor(parsed)));
}

function pushPolicy(list: StateReconcilePolicy[], policy: StateReconcilePolicy) {
	if (!list.includes(policy)) list.push(policy);
}

export function resolveStateReconcilePlan(input?: ResolveStateReconcilePlanInput): StateReconcilePlan {
	const artifactKind = normalizeArtifactKind(input?.artifactKind);
	const runtimeMode = normalizeRuntimeMode(input?.runtimeMode);
	const deliveryChannel = normalizeDeliveryChannel(input?.deliveryChannel);
	const parallelWriters = normalizeParallelWriters(input?.parallelWriters);
	const preferGeneratedStep = input?.preferGeneratedStep === true;

	const recommendedPolicies: StateReconcilePolicy[] = [];
	const reasonCodes: string[] = [];

	if (["board", "settings", "handoff"].includes(artifactKind)) {
		pushPolicy(recommendedPolicies, "lock-and-atomic-write");
		reasonCodes.push("state-artifact-requires-atomicity");
	}

	if (parallelWriters > 1) {
		pushPolicy(recommendedPolicies, "single-writer-branch");
		reasonCodes.push("parallel-writers-detected");
	}

	if (preferGeneratedStep || (runtimeMode === "ci" && artifactKind === "board")) {
		pushPolicy(recommendedPolicies, "generated-apply-step");
		reasonCodes.push(preferGeneratedStep ? "generated-step-preferred" : "ci-board-generated-step");
	}

	const reviewedChannel = deliveryChannel === "pull-request" || deliveryChannel === "merge-request";
	if (reviewedChannel) {
		pushPolicy(recommendedPolicies, "reviewed-promotion");
		reasonCodes.push("reviewed-channel");
	}

	if (recommendedPolicies.length === 0) {
		pushPolicy(recommendedPolicies, "lock-and-atomic-write");
		reasonCodes.push("safe-default");
	}

	const manualReviewRequired = reviewedChannel || recommendedPolicies.includes("generated-apply-step");

	const concurrencyRisk: "low" | "medium" | "high" =
		parallelWriters >= 3
			? "high"
			: parallelWriters === 2 || runtimeMode === "ci"
				? "medium"
				: "low";

	return {
		artifactKind,
		runtimeMode,
		deliveryChannel,
		parallelWriters,
		concurrencyRisk,
		recommendedPolicies,
		reasonCodes,
		manualReviewRequired,
	};
}

export function formatStateReconcilePlan(plan: StateReconcilePlan): string[] {
	return [
		"state-reconcile",
		`artifact: ${plan.artifactKind}`,
		`runtime: ${plan.runtimeMode}`,
		`channel: ${plan.deliveryChannel}`,
		`parallelWriters: ${plan.parallelWriters}`,
		`risk: ${plan.concurrencyRisk}`,
		`manualReviewRequired: ${plan.manualReviewRequired ? "yes" : "no"}`,
		`policies: ${plan.recommendedPolicies.join(", ")}`,
		`reasons: ${plan.reasonCodes.join(", ")}`,
	];
}
