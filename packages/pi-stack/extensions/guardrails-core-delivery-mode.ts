export type DeliveryRuntimeMode = "native" | "container" | "ci";
export type DeliveryChannel = "direct-branch" | "pull-request" | "merge-request";
export type DeliveryCiProvider = "none" | "github-actions" | "gitlab-ci";

export interface DeliveryModePlan {
	runtimeMode: DeliveryRuntimeMode;
	deliveryChannel: DeliveryChannel;
	ciProvider: DeliveryCiProvider;
	confidence: "high" | "medium";
	signals: string[];
	recommendation: string[];
}

export interface ResolveDeliveryModePlanInput {
	env?: Record<string, unknown>;
	preferChannel?: DeliveryChannel;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function normalizeEnvValue(value: unknown): string {
	return String(value ?? "").trim();
}

function isTruthyFlag(value: unknown): boolean {
	return TRUE_VALUES.has(normalizeEnvValue(value).toLowerCase());
}

function readEnv(input?: Record<string, unknown>): Record<string, string> {
	const source = input ?? (process.env as Record<string, unknown>);
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(source)) {
		out[key.toUpperCase()] = normalizeEnvValue(value);
	}
	return out;
}

function parseDeliveryChannel(value: string | undefined): DeliveryChannel | undefined {
	const normalized = normalizeEnvValue(value).toLowerCase();
	if (!normalized) return undefined;
	if (["direct", "direct-branch", "branch", "none"].includes(normalized)) {
		return "direct-branch";
	}
	if (["pr", "pull-request", "pull_request"].includes(normalized)) {
		return "pull-request";
	}
	if (["mr", "merge-request", "merge_request"].includes(normalized)) {
		return "merge-request";
	}
	return undefined;
}

function detectContainerSignals(env: Record<string, string>): string[] {
	const hits: string[] = [];
	const candidates = [
		"DEVCONTAINER",
		"CODESPACES",
		"RUNNING_IN_CONTAINER",
		"DOTNET_RUNNING_IN_CONTAINER",
		"CONTAINER",
		"PI_RUNTIME_CONTAINER",
		"PI_CONTAINERIZED",
	];
	for (const key of candidates) {
		if (isTruthyFlag(env[key])) hits.push(`${key}=true`);
	}
	return hits;
}

export function resolveDeliveryModePlan(input?: ResolveDeliveryModePlanInput): DeliveryModePlan {
	const env = readEnv(input?.env);
	const signals: string[] = [];

	const githubActions = isTruthyFlag(env.GITHUB_ACTIONS);
	const gitlabCi = isTruthyFlag(env.GITLAB_CI);
	const genericCi = isTruthyFlag(env.CI);
	const containerSignals = detectContainerSignals(env);

	let ciProvider: DeliveryCiProvider = "none";
	let runtimeMode: DeliveryRuntimeMode = "native";

	if (githubActions) {
		ciProvider = "github-actions";
		runtimeMode = "ci";
		signals.push("GITHUB_ACTIONS=true");
	} else if (gitlabCi) {
		ciProvider = "gitlab-ci";
		runtimeMode = "ci";
		signals.push("GITLAB_CI=true");
	} else if (genericCi) {
		runtimeMode = "ci";
		signals.push("CI=true");
	} else if (containerSignals.length > 0) {
		runtimeMode = "container";
		signals.push(...containerSignals);
	} else {
		signals.push("local-runtime");
	}

	const explicitChannel = parseDeliveryChannel(env.PI_DELIVERY_CHANNEL);
	if (explicitChannel) {
		signals.push(`PI_DELIVERY_CHANNEL=${explicitChannel}`);
	}

	let deliveryChannel: DeliveryChannel =
		explicitChannel
			?? input?.preferChannel
			?? (ciProvider === "github-actions" && /^pull_request/.test(env.GITHUB_EVENT_NAME)
				? "pull-request"
				: ciProvider === "gitlab-ci" && normalizeEnvValue(env.CI_MERGE_REQUEST_IID).length > 0
					? "merge-request"
					: "direct-branch");

	if (!explicitChannel && input?.preferChannel) {
		signals.push(`preferChannel=${input.preferChannel}`);
	}

	if (ciProvider === "github-actions") {
		signals.push(`GITHUB_EVENT_NAME=${normalizeEnvValue(env.GITHUB_EVENT_NAME) || "n/a"}`);
	}
	if (ciProvider === "gitlab-ci") {
		signals.push(
			`CI_MERGE_REQUEST_IID=${normalizeEnvValue(env.CI_MERGE_REQUEST_IID) || "n/a"}`,
		);
	}

	if (runtimeMode !== "ci" && deliveryChannel !== "direct-branch") {
		// Keep deterministic local default when PR/MR signal is missing in non-CI runtime.
		deliveryChannel = explicitChannel ?? input?.preferChannel ?? "direct-branch";
	}

	const confidence: "high" | "medium" =
		explicitChannel || ciProvider !== "none" ? "high" : "medium";

	const recommendation = [
		`runtime=${runtimeMode} | channel=${deliveryChannel} | provider=${ciProvider}`,
		"board/settings writes: keep lock-aware atomic writers enabled before parallel lanes.",
		deliveryChannel === "direct-branch"
			? "promotion: direct branch apply allowed when governance gates are green."
			: `promotion: prefer ${deliveryChannel} flow for reviewable promotion in shared lanes.`,
	];

	return {
		runtimeMode,
		deliveryChannel,
		ciProvider,
		confidence,
		signals,
		recommendation,
	};
}

export function formatDeliveryModePlan(plan: DeliveryModePlan): string[] {
	return [
		"delivery-mode",
		`runtime: ${plan.runtimeMode}`,
		`channel: ${plan.deliveryChannel}`,
		`ciProvider: ${plan.ciProvider}`,
		`confidence: ${plan.confidence}`,
		`signals: ${plan.signals.join(", ")}`,
		...plan.recommendation.map((line) => `- ${line}`),
	];
}
