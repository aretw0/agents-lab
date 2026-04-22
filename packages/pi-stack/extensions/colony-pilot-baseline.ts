export type BaselineProfile = "default" | "phase2";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeObjects<T extends Record<string, unknown>>(
	base: T,
	patch: Record<string, unknown>,
): T {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (isPlainObject(value) && isPlainObject(out[key])) {
			out[key] = deepMergeObjects(out[key] as Record<string, unknown>, value);
		} else {
			out[key] = value;
		}
	}
	return out as T;
}

export function resolveBaselineProfile(input?: string): BaselineProfile {
	return input === "phase2" ? "phase2" : "default";
}

export function buildProjectBaselineSettings(
	profile: BaselineProfile = "default",
) {
	const base = {
		piStack: {
			colonyPilot: {
				preflight: {
					enabled: true,
					enforceOnAntColonyTool: true,
					requiredExecutables: ["node", "git", "npm"],
					requireColonyCapabilities: ["colony", "colonyStop"],
				},
				modelPolicy: {
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
				},
				budgetPolicy: {
					enabled: true,
					enforceOnAntColonyTool: true,
					requireMaxCost: true,
					autoInjectMaxCost: true,
					defaultMaxCostUsd: 2,
					hardCapUsd: 20,
					minMaxCostUsd: 0.05,
					enforceProviderBudgetBlock: false,
					providerBudgetLookbackDays: 30,
					allowProviderBudgetOverride: true,
					providerBudgetOverrideToken: "budget-override:",
				},
				projectTaskSync: {
					enabled: false,
					createOnLaunch: true,
					trackProgress: true,
					markTerminalState: true,
					taskIdPrefix: "colony",
					requireHumanClose: true,
					maxNoteLines: 20,
					autoQueueRecoveryOnCandidate: true,
					recoveryTaskSuffix: "promotion",
				},
				deliveryPolicy: {
					enabled: false,
					mode: "report-only",
					requireWorkspaceReport: true,
					requireTaskSummary: true,
					requireFileInventory: false,
					requireValidationCommandLog: false,
					blockOnMissingEvidence: true,
				},
				candidateRetention: {
					enabled: true,
					maxEntries: 40,
					maxAgeDays: 14,
				},
			},
			webSessionGateway: {
				mode: "local",
				port: 3100,
			},
			schedulerGovernance: {
				enabled: true,
				policy: "observe",
				requireTextConfirmation: true,
				allowEnvOverride: true,
				staleAfterMs: 10000,
			},
			guardrailsCore: {
				portConflict: {
					enabled: true,
					suggestedTestPort: 4173,
				},
			},
		},
	};

	if (profile === "default") return base;

	return deepMergeObjects(base, {
		piStack: {
			colonyPilot: {
				preflight: {
					requiredExecutables: ["node", "git", "npm", "npx"],
					requireColonyCapabilities: [
						"colony",
						"colonyStop",
						"monitors",
						"sessionWeb",
					],
				},
				modelPolicy: {
					requireExplicitRoleModels: true,
					allowMixedProviders: false,
				},
				budgetPolicy: {
					defaultMaxCostUsd: 1,
					hardCapUsd: 10,
					enforceProviderBudgetBlock: true,
				},
				candidateRetention: {
					maxEntries: 24,
					maxAgeDays: 10,
				},
				deliveryPolicy: {
					enabled: true,
					mode: "patch-artifact",
					requireFileInventory: true,
					requireValidationCommandLog: true,
				},
			},
			guardrailsCore: {
				portConflict: {
					suggestedTestPort: 4273,
				},
			},
		},
	});
}

export function applyProjectBaselineSettings(
	existing: unknown,
	profile: BaselineProfile = "default",
) {
	const current = isPlainObject(existing) ? { ...existing } : {};

	const ext = current.extensions;
	if (isPlainObject(ext) && !Array.isArray(ext)) {
		const migrated: Record<string, unknown> = isPlainObject(current.piStack)
			? { ...(current.piStack as Record<string, unknown>) }
			: {};
		for (const key of ["colonyPilot", "webSessionGateway", "guardrailsCore"]) {
			if (key in ext) migrated[key] = (ext as Record<string, unknown>)[key];
		}
		current.piStack = migrated;
		current.extensions = [];
	}

	const baseline = buildProjectBaselineSettings(profile);
	return deepMergeObjects(current, baseline as Record<string, unknown>);
}
