import {
	parseProviderModelRef,
	resolveModelAuthStatus,
} from "./colony-pilot-model-readiness";

export type ColonyAgentRole =
	| "queen"
	| "scout"
	| "worker"
	| "soldier"
	| "design"
	| "multimodal"
	| "backend"
	| "review";

export interface ColonyRoleModelMap {
	scout?: string;
	worker?: string;
	soldier?: string;
	design?: string;
	multimodal?: string;
	backend?: string;
	review?: string;
}

export interface ColonyPilotModelPolicyConfig {
	enabled: boolean;
	specializedRolesEnabled: boolean;
	autoInjectRoleModels: boolean;
	requireHealthyCurrentModel: boolean;
	requireExplicitRoleModels: boolean;
	requiredRoles: ColonyAgentRole[];
	enforceFullModelRef: boolean;
	allowMixedProviders: boolean;
	allowedProviders: string[];
	allowedProvidersByRole: Partial<Record<ColonyAgentRole, string[]>>;
	roleModels: ColonyRoleModelMap;
	sparkGateEnabled: boolean;
	sparkAllowedGoalTriggers: string[];
	sparkScoutOnlyTrigger: string;
}

export interface ColonyModelPolicyEvaluation {
	ok: boolean;
	issues: string[];
	effectiveModels: Record<ColonyAgentRole, string | undefined>;
}

export type ModelPolicyProfile =
	| "copilot"
	| "codex"
	| "hybrid"
	| "factory-strict"
	| "factory-strict-copilot"
	| "factory-strict-hybrid";

export interface AntColonyModelInput {
	scoutModel?: string;
	workerModel?: string;
	soldierModel?: string;
	designWorkerModel?: string;
	multimodalWorkerModel?: string;
	backendWorkerModel?: string;
	reviewWorkerModel?: string;
}

const ROLE_ORDER: Array<Exclude<ColonyAgentRole, "queen">> = [
	"scout",
	"worker",
	"soldier",
	"design",
	"multimodal",
	"backend",
	"review",
];

const CORE_ROLE_ORDER: Array<Exclude<ColonyAgentRole, "queen">> = [
	"scout",
	"worker",
	"soldier",
];

type AntColonyRoleModelInputKey =
	| "scoutModel"
	| "workerModel"
	| "soldierModel"
	| "designWorkerModel"
	| "multimodalWorkerModel"
	| "backendWorkerModel"
	| "reviewWorkerModel";

const ROLE_TO_INPUT_KEY: Record<
	Exclude<ColonyAgentRole, "queen">,
	AntColonyRoleModelInputKey
> = {
	scout: "scoutModel",
	worker: "workerModel",
	soldier: "soldierModel",
	design: "designWorkerModel",
	multimodal: "multimodalWorkerModel",
	backend: "backendWorkerModel",
	review: "reviewWorkerModel",
};

const DEFAULT_MODEL_POLICY: ColonyPilotModelPolicyConfig = {
	enabled: true,
	specializedRolesEnabled: false,
	autoInjectRoleModels: true,
	requireHealthyCurrentModel: true,
	requireExplicitRoleModels: false,
	requiredRoles: ["scout", "worker", "soldier"],
	enforceFullModelRef: true,
	allowMixedProviders: true,
	allowedProviders: [],
	allowedProvidersByRole: {},
	roleModels: {},
	sparkGateEnabled: false,
	sparkAllowedGoalTriggers: ["planning recovery", "scout burst"],
	sparkScoutOnlyTrigger: "scout burst",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRoleList(value: unknown): ColonyAgentRole[] {
	if (!Array.isArray(value)) return [...DEFAULT_MODEL_POLICY.requiredRoles];
	const allowed: ColonyAgentRole[] = ["queen", ...ROLE_ORDER];
	const out = value.filter(
		(v): v is ColonyAgentRole =>
			typeof v === "string" && allowed.includes(v as ColonyAgentRole),
	);
	return out.length > 0 ? out : [...DEFAULT_MODEL_POLICY.requiredRoles];
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
		.map((v) => v.trim());
}

function normalizeRoleModels(value: unknown): ColonyRoleModelMap {
	const input = isPlainObject(value) ? (value as Record<string, unknown>) : {};
	const out: ColonyRoleModelMap = {};
	for (const role of ROLE_ORDER) {
		const v = input[role];
		if (typeof v === "string" && v.trim().length > 0) out[role] = v.trim();
	}
	return out;
}

function normalizeAllowedProvidersByRole(
	value: unknown,
): Partial<Record<ColonyAgentRole, string[]>> {
	const input = isPlainObject(value) ? (value as Record<string, unknown>) : {};
	const out: Partial<Record<ColonyAgentRole, string[]>> = {};
	for (const role of ["queen", ...ROLE_ORDER] as ColonyAgentRole[]) {
		const providers = normalizeStringList(input[role]);
		if (providers.length > 0) out[role] = providers;
	}
	return out;
}

function providerOf(modelRef: string | undefined): string | undefined {
	if (!modelRef) return undefined;
	return parseProviderModelRef(modelRef)?.provider;
}

export function resolveColonyPilotModelPolicy(
	raw?: Partial<ColonyPilotModelPolicyConfig>,
): ColonyPilotModelPolicyConfig {
	const specializedRolesEnabled = raw?.specializedRolesEnabled === true;
	const requestedRequiredRoles = normalizeRoleList(raw?.requiredRoles);
	const sparkAllowedGoalTriggers = normalizeStringList(
		raw?.sparkAllowedGoalTriggers,
	)
		.map((v) => v.toLowerCase())
		.filter((v, idx, arr) => arr.indexOf(v) === idx);
	const sparkScoutOnlyTriggerRaw =
		typeof raw?.sparkScoutOnlyTrigger === "string"
			? raw.sparkScoutOnlyTrigger.trim().toLowerCase()
			: "";
	const requiredRoles = specializedRolesEnabled
		? requestedRequiredRoles
		: requestedRequiredRoles.filter(
				(role) =>
					role === "queen" ||
					CORE_ROLE_ORDER.includes(role as Exclude<ColonyAgentRole, "queen">),
			);

	return {
		enabled: raw?.enabled !== false,
		specializedRolesEnabled,
		autoInjectRoleModels: raw?.autoInjectRoleModels !== false,
		requireHealthyCurrentModel: raw?.requireHealthyCurrentModel !== false,
		requireExplicitRoleModels: raw?.requireExplicitRoleModels === true,
		requiredRoles,
		enforceFullModelRef: raw?.enforceFullModelRef !== false,
		allowMixedProviders: raw?.allowMixedProviders !== false,
		allowedProviders: normalizeStringList(raw?.allowedProviders),
		allowedProvidersByRole: normalizeAllowedProvidersByRole(
			raw?.allowedProvidersByRole,
		),
		roleModels: normalizeRoleModels(raw?.roleModels),
		sparkGateEnabled: raw?.sparkGateEnabled === true,
		sparkAllowedGoalTriggers:
			sparkAllowedGoalTriggers.length > 0
				? sparkAllowedGoalTriggers
				: [...DEFAULT_MODEL_POLICY.sparkAllowedGoalTriggers],
		sparkScoutOnlyTrigger:
			sparkScoutOnlyTriggerRaw || DEFAULT_MODEL_POLICY.sparkScoutOnlyTrigger,
	};
}

export function evaluateAntColonyModelPolicy(
	input: AntColonyModelInput,
	currentModelRef: string | undefined,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	modelRegistry: any,
	policy: ColonyPilotModelPolicyConfig,
	goal?: string,
): ColonyModelPolicyEvaluation {
	const issues: string[] = [];
	const effectiveModels: Record<ColonyAgentRole, string | undefined> = {
		queen: currentModelRef,
		scout: undefined,
		worker: undefined,
		soldier: undefined,
		design: undefined,
		multimodal: undefined,
		backend: undefined,
		review: undefined,
	};

	const activeRoles = policy.specializedRolesEnabled
		? ROLE_ORDER
		: CORE_ROLE_ORDER;

	if (policy.requireHealthyCurrentModel) {
		const status = resolveModelAuthStatus(modelRegistry, currentModelRef);
		if (status !== "ok" && status !== "unavailable") {
			issues.push(
				`queen model invalid/unavailable for runtime: ${currentModelRef ?? "(none)"} (${status})`,
			);
		}
	}

	const queenProvider = providerOf(currentModelRef);
	const queenAllowed = policy.allowedProvidersByRole.queen ?? [];
	if (
		queenProvider &&
		queenAllowed.length > 0 &&
		!queenAllowed.includes(queenProvider)
	) {
		issues.push(
			`queen provider '${queenProvider}' is not in allowedProvidersByRole.queen`,
		);
	}

	for (const role of ROLE_ORDER) {
		const key = ROLE_TO_INPUT_KEY[role];
		const explicit =
			typeof input[key] === "string" ? input[key]?.trim() : undefined;
		const roleIsActive = activeRoles.includes(role);
		const configured = roleIsActive ? policy.roleModels[role] : undefined;

		if (
			!explicit &&
			roleIsActive &&
			policy.autoInjectRoleModels &&
			configured
		) {
			input[key] = configured;
		}

		const effective =
			(typeof input[key] === "string" && input[key]?.trim().length
				? input[key]?.trim()
				: undefined) ?? currentModelRef;
		effectiveModels[role] = effective;

		if (!roleIsActive && !explicit) {
			continue;
		}

		if (
			policy.requireExplicitRoleModels &&
			policy.requiredRoles.includes(role) &&
			!input[key]
		) {
			issues.push(`missing explicit model for role '${role}' (${String(key)})`);
			continue;
		}

		if (!effective) {
			issues.push(`role '${role}' has no effective model`);
			continue;
		}

		if (policy.enforceFullModelRef && !parseProviderModelRef(effective)) {
			issues.push(`role '${role}' model must be provider/model: ${effective}`);
			continue;
		}

		const status = resolveModelAuthStatus(modelRegistry, effective);
		if (status !== "ok" && status !== "unavailable") {
			issues.push(`role '${role}' model not ready: ${effective} (${status})`);
		}

		const provider = providerOf(effective);
		if (
			provider &&
			policy.allowedProviders.length > 0 &&
			!policy.allowedProviders.includes(provider)
		) {
			issues.push(
				`role '${role}' provider '${provider}' is not in allowedProviders`,
			);
		}

		const roleAllowed = policy.allowedProvidersByRole[role] ?? [];
		if (provider && roleAllowed.length > 0 && !roleAllowed.includes(provider)) {
			issues.push(
				`role '${role}' provider '${provider}' is not in allowedProvidersByRole.${role}`,
			);
		}
	}

	if (!policy.allowMixedProviders) {
		const providers = new Set<string>();
		for (const role of ["queen", ...activeRoles] as ColonyAgentRole[]) {
			const p = providerOf(effectiveModels[role]);
			if (p) providers.add(p);
		}
		if (providers.size > 1) {
			issues.push(
				`mixed providers are disabled, found: ${[...providers].join(", ")}`,
			);
		}
	}

	if (policy.sparkGateEnabled) {
		const sparkRoles = (["queen", ...ROLE_ORDER] as ColonyAgentRole[]).filter(
			(role) => {
				const modelRef = effectiveModels[role];
				return (
					typeof modelRef === "string" &&
					modelRef.toLowerCase().includes("codex-spark")
				);
			},
		);

		if (sparkRoles.length > 0) {
			const normalizedGoal = (goal ?? "").toLowerCase();
			const matchedSparkTriggers = policy.sparkAllowedGoalTriggers.filter(
				(trigger) => normalizedGoal.includes(trigger),
			);

			if (matchedSparkTriggers.length === 0) {
				issues.push(
					`spark model usage requires explicit goal trigger: ${policy.sparkAllowedGoalTriggers.join(", ")}`,
				);
			} else {
				const hasPlanningRecoveryTrigger =
					matchedSparkTriggers.includes("planning recovery");
				const hasScoutOnlyTrigger = matchedSparkTriggers.includes(
					policy.sparkScoutOnlyTrigger,
				);

				if (!hasPlanningRecoveryTrigger && hasScoutOnlyTrigger) {
					const nonScoutRoles = sparkRoles.filter((role) => role !== "scout");
					if (nonScoutRoles.length > 0) {
						issues.push(
							`spark with trigger '${policy.sparkScoutOnlyTrigger}' is scout-only; found roles: ${nonScoutRoles.join(", ")}`,
						);
					}
				}
			}
		}
	}

	return {
		ok: issues.length === 0,
		issues,
		effectiveModels,
	};
}

export function formatPolicyEvaluation(
	policy: ColonyPilotModelPolicyConfig,
	evalResult: ColonyModelPolicyEvaluation,
): string[] {
	const roleAllowRows = (["queen", ...ROLE_ORDER] as ColonyAgentRole[])
		.map((role) => {
			const providers = policy.allowedProvidersByRole[role] ?? [];
			if (providers.length === 0) return undefined;
			return `    ${role}: ${providers.join(", ")}`;
		})
		.filter((row): row is string => Boolean(row));

	const activeRoles = policy.specializedRolesEnabled
		? ROLE_ORDER
		: CORE_ROLE_ORDER;

	return [
		"model-policy:",
		`  enabled: ${policy.enabled ? "yes" : "no"}`,
		`  specializedRolesEnabled: ${policy.specializedRolesEnabled ? "yes" : "no"}`,
		`  activeRoles: ${activeRoles.join(", ")}`,
		`  autoInjectRoleModels: ${policy.autoInjectRoleModels ? "yes" : "no"}`,
		`  requireHealthyCurrentModel: ${policy.requireHealthyCurrentModel ? "yes" : "no"}`,
		`  requireExplicitRoleModels: ${policy.requireExplicitRoleModels ? "yes" : "no"}`,
		`  requiredRoles: ${policy.requiredRoles.join(", ") || "(none)"}`,
		`  allowMixedProviders: ${policy.allowMixedProviders ? "yes" : "no"}`,
		`  allowedProviders: ${policy.allowedProviders.join(", ") || "(any)"}`,
		`  sparkGateEnabled: ${policy.sparkGateEnabled ? "yes" : "no"}`,
		`  sparkAllowedGoalTriggers: ${policy.sparkAllowedGoalTriggers.join(", ") || "(none)"}`,
		`  sparkScoutOnlyTrigger: ${policy.sparkScoutOnlyTrigger || "(none)"}`,
		`  allowedProvidersByRole: ${roleAllowRows.length > 0 ? "(configured)" : "(none)"}`,
		...(roleAllowRows.length > 0 ? roleAllowRows : []),
		"  effectiveModels:",
		`    queen: ${evalResult.effectiveModels.queen ?? "(none)"}`,
		...ROLE_ORDER.map(
			(role) => `    ${role}: ${evalResult.effectiveModels[role] ?? "(none)"}`,
		),
	];
}

export function resolveModelPolicyProfile(input?: string): ModelPolicyProfile {
	return input === "copilot" ||
		input === "hybrid" ||
		input === "factory-strict" ||
		input === "factory-strict-copilot" ||
		input === "factory-strict-hybrid"
		? input
		: "codex";
}

export function buildModelPolicyProfile(
	profile: ModelPolicyProfile,
): ColonyPilotModelPolicyConfig {
	if (profile === "copilot") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: false,
			allowMixedProviders: false,
			allowedProviders: ["github-copilot"],
			roleModels: {
				scout: "github-copilot/claude-haiku-4.5",
				worker: "github-copilot/claude-sonnet-4.6",
				soldier: "github-copilot/claude-sonnet-4.6",
			},
		});
	}

	if (profile === "hybrid") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: false,
			allowMixedProviders: true,
			allowedProviders: ["github-copilot", "openai-codex"],
			roleModels: {
				scout: "openai-codex/gpt-5.4-mini",
				worker: "github-copilot/claude-sonnet-4.6",
				soldier: "openai-codex/gpt-5.2-codex",
			},
		});
	}

	if (profile === "factory-strict-copilot") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: true,
			autoInjectRoleModels: true,
			requireExplicitRoleModels: true,
			requiredRoles: [
				"scout",
				"worker",
				"soldier",
				"design",
				"multimodal",
				"backend",
				"review",
			],
			enforceFullModelRef: true,
			allowMixedProviders: false,
			allowedProviders: ["github-copilot"],
			roleModels: {
				scout: "github-copilot/claude-haiku-4.5",
				worker: "github-copilot/claude-sonnet-4.6",
				soldier: "github-copilot/claude-sonnet-4.6",
				design: "github-copilot/claude-sonnet-4.6",
				multimodal: "github-copilot/claude-haiku-4.5",
				backend: "github-copilot/claude-sonnet-4.6",
				review: "github-copilot/claude-sonnet-4.6",
			},
		});
	}

	if (profile === "factory-strict-hybrid") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: true,
			autoInjectRoleModels: true,
			requireExplicitRoleModels: true,
			requiredRoles: [
				"scout",
				"worker",
				"soldier",
				"design",
				"multimodal",
				"backend",
				"review",
			],
			enforceFullModelRef: true,
			allowMixedProviders: true,
			allowedProviders: ["github-copilot", "openai-codex"],
			allowedProvidersByRole: {
				queen: ["openai-codex", "github-copilot"],
				scout: ["openai-codex"],
				worker: ["github-copilot"],
				soldier: ["openai-codex"],
				design: ["github-copilot"],
				multimodal: ["openai-codex"],
				backend: ["openai-codex"],
				review: ["github-copilot"],
			},
			roleModels: {
				scout: "openai-codex/gpt-5.4-mini",
				worker: "github-copilot/claude-sonnet-4.6",
				soldier: "openai-codex/gpt-5.2-codex",
				design: "github-copilot/claude-sonnet-4.6",
				multimodal: "openai-codex/gpt-5.4-mini",
				backend: "openai-codex/gpt-5.3-codex",
				review: "github-copilot/claude-sonnet-4.6",
			},
		});
	}

	if (profile === "factory-strict") {
		return resolveColonyPilotModelPolicy({
			specializedRolesEnabled: true,
			autoInjectRoleModels: true,
			requireExplicitRoleModels: true,
			requiredRoles: [
				"scout",
				"worker",
				"soldier",
				"design",
				"multimodal",
				"backend",
				"review",
			],
			enforceFullModelRef: true,
			allowMixedProviders: false,
			allowedProviders: ["openai-codex"],
			roleModels: {
				scout: "openai-codex/gpt-5.4-mini",
				worker: "openai-codex/gpt-5.3-codex",
				soldier: "openai-codex/gpt-5.2-codex",
				design: "openai-codex/gpt-5.3-codex",
				multimodal: "openai-codex/gpt-5.4-mini",
				backend: "openai-codex/gpt-5.3-codex",
				review: "openai-codex/gpt-5.2-codex",
			},
		});
	}

	return resolveColonyPilotModelPolicy({
		specializedRolesEnabled: false,
		allowMixedProviders: false,
		allowedProviders: ["openai-codex"],
		roleModels: {
			scout: "openai-codex/gpt-5.4-mini",
			worker: "openai-codex/gpt-5.3-codex",
			soldier: "openai-codex/gpt-5.2-codex",
		},
	});
}
