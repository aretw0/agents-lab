import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readColonyRetentionSnapshot } from "./colony-pilot-candidate-retention";
import { inspectAntColonyRuntime } from "./colony-pilot-artifacts";
import {
	applyProjectBaselineSettings,
	buildProjectBaselineSettings,
	resolveBaselineProfile,
} from "./colony-pilot-baseline";
import { evaluateAntColonyBudgetPolicy } from "./colony-pilot-budget-policy";
import { getCapabilities } from "./colony-pilot-command-surface";
import { evaluateColonyDeliveryEvidence } from "./colony-pilot-delivery-policy";
import { evaluateAntColonyModelPolicy, type ColonyPilotModelPolicyConfig } from "./colony-pilot-model-policy";
import { resolveColonyModelReadiness } from "./colony-pilot-model-readiness";
import {
	formatToolJsonOutput,
	type CandidateRetentionConfig,
	type OutputPolicyConfig,
} from "./colony-pilot-output-policy";
import type {
	ColonyPilotBudgetPolicyConfig,
	ColonyPilotDeliveryPolicyConfig,
	ColonyPilotProjectTaskSyncConfig,
} from "./colony-pilot-policy-defaults";
import type { ColonyPilotPreflightConfig, ColonyPilotPreflightResult } from "./colony-pilot-preflight";
import { runColonyPilotPreflight } from "./colony-pilot-preflight";
import type { ProviderBudgetGateCacheEntry } from "./colony-pilot-provider-budget-gate";
import type { PilotState } from "./colony-pilot-runtime";
import { snapshotPilotState } from "./colony-pilot-runtime";
import {
	readProjectSettings as readProjectSettingsImpl,
	writeProjectSettings as writeProjectSettingsImpl,
} from "./colony-pilot-settings";

export interface ColonyPilotToolSurfaceRuntime {
	state: PilotState;
	getModelPolicyConfig(): ColonyPilotModelPolicyConfig;
	getBudgetPolicyConfig(): ColonyPilotBudgetPolicyConfig;
	getDeliveryPolicyConfig(): ColonyPilotDeliveryPolicyConfig;
	getProviderBudgetGateCache(): ProviderBudgetGateCacheEntry | undefined;
	getProjectTaskSyncConfig(): ColonyPilotProjectTaskSyncConfig;
	getCandidateRetentionConfig(): CandidateRetentionConfig;
	getOutputPolicyConfig(): OutputPolicyConfig;
	getPreflightConfig(): ColonyPilotPreflightConfig;
	setPreflightCache(entry: { at: number; result: ColonyPilotPreflightResult }): void;
}

export function registerColonyPilotToolSurface(
	pi: ExtensionAPI,
	runtime: ColonyPilotToolSurfaceRuntime,
): void {
	pi.registerTool({
		name: "colony_pilot_status",
		label: "Colony Pilot Status",
		description:
			"Mostra o estado atual do pilot: monitores, remote web e colonies em background.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const snapshot = snapshotPilotState(runtime.state);
			const retentionSnapshot = readColonyRetentionSnapshot(ctx.cwd, 5);
			const capabilities = getCapabilities(pi);
			const currentModelRef = ctx.model
				? `${ctx.model.provider}/${ctx.model.id}`
				: undefined;
			const modelPolicyConfig = runtime.getModelPolicyConfig();
			const budgetPolicyConfig = runtime.getBudgetPolicyConfig();
			const deliveryPolicyConfig = runtime.getDeliveryPolicyConfig();
			const providerBudgetGateCache = runtime.getProviderBudgetGateCache();
			const outputPolicyConfig = runtime.getOutputPolicyConfig();
			const modelReadiness = resolveColonyModelReadiness(
				ctx.cwd,
				currentModelRef,
				ctx.modelRegistry,
			);
			const modelPolicyEvaluation = evaluateAntColonyModelPolicy(
				{ goal: "status" },
				currentModelRef,
				ctx.modelRegistry,
				modelPolicyConfig,
			);
			const budgetPolicyEvaluation = evaluateAntColonyBudgetPolicy(
				{ goal: "status" },
				budgetPolicyConfig,
			);
			const deliveryPolicyEvaluation = evaluateColonyDeliveryEvidence(
				"",
				"running",
				deliveryPolicyConfig,
			);
			const payload = {
				...snapshot,
				capabilities,
				modelReadiness,
				modelPolicy: modelPolicyConfig,
				modelPolicyEvaluation,
				budgetPolicy: budgetPolicyConfig,
				budgetPolicyEvaluation,
				providerBudgetGateCache: providerBudgetGateCache
					? {
							at: new Date(providerBudgetGateCache.at).toISOString(),
							lookbackDays: providerBudgetGateCache.snapshot.lookbackDays,
							generatedAtIso: providerBudgetGateCache.snapshot.generatedAtIso,
							blockedProviders: providerBudgetGateCache.snapshot.budgets
								.filter((b) => b.state === "blocked")
								.map((b) => b.provider),
							allocationWarnings:
								providerBudgetGateCache.snapshot.allocationWarnings,
						}
					: undefined,
				projectTaskSync: runtime.getProjectTaskSyncConfig(),
				deliveryPolicy: deliveryPolicyConfig,
				deliveryPolicyEvaluation,
				retention: {
					config: runtime.getCandidateRetentionConfig(),
					root: retentionSnapshot.root,
					exists: retentionSnapshot.exists,
					count: retentionSnapshot.count,
					records: retentionSnapshot.records.map((entry) => ({
						colonyId: entry.record.colonyId,
						runtimeColonyId: entry.record.runtimeColonyId,
						phase: entry.record.phase,
						updatedAtIso: entry.updatedAtIso,
						path: entry.path,
						runtimeSnapshotPath: entry.record.runtimeSnapshotPath,
						runtimeSnapshotTaskCount:
							entry.record.runtimeSnapshotTaskCount,
						runtimeSnapshotMissingReason:
							entry.record.runtimeSnapshotMissingReason,
						goal: entry.record.goal,
					})),
				},
			};

			return {
				content: [
					{
						type: "text",
						text: formatToolJsonOutput(
							"colony_pilot_status",
							payload,
							outputPolicyConfig,
						),
					},
				],
				details: payload,
			};
		},
	});

	pi.registerTool({
		name: "colony_pilot_artifacts",
		label: "Colony Pilot Artifacts",
		description:
			"Inspect colony runtime artifacts (workspace mirrors, state files, worktrees).",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const data = inspectAntColonyRuntime(ctx.cwd);
			return {
				content: [
					{
						type: "text",
						text: formatToolJsonOutput(
							"colony_pilot_artifacts",
							data,
							runtime.getOutputPolicyConfig(),
						),
					},
				],
				details: data,
			};
		},
	});

	pi.registerTool({
		name: "colony_pilot_preflight",
		label: "Colony Pilot Preflight",
		description: "Run hard preflight checks used to gate ant_colony execution.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const caps = getCapabilities(pi);
			const result = await runColonyPilotPreflight(pi, caps, runtime.getPreflightConfig(), ctx.cwd);
			runtime.setPreflightCache({ at: Date.now(), result });
			return {
				content: [
					{
						type: "text",
						text: formatToolJsonOutput(
							"colony_pilot_preflight",
							result,
							runtime.getOutputPolicyConfig(),
						),
					},
				],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "colony_pilot_baseline",
		label: "Colony Pilot Baseline",
		description:
			"Show or apply project baseline settings for colony/web runtime governance.",
		parameters: Type.Object({
			apply: Type.Optional(Type.Boolean()),
			profile: Type.Optional(Type.String({ description: "default | phase2" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const p = params as { apply?: boolean; profile?: string };
			const apply = Boolean(p?.apply);
			const profile = resolveBaselineProfile(p?.profile);
			const baseline = buildProjectBaselineSettings(profile);
			if (!apply) {
				return {
					content: [
						{
							type: "text",
							text: formatToolJsonOutput(
								"colony_pilot_baseline",
								{ profile, baseline },
								runtime.getOutputPolicyConfig(),
							),
						},
					],
					details: { profile, baseline },
				};
			}

			const merged = applyProjectBaselineSettings(
				readProjectSettingsImpl(ctx.cwd),
				profile,
			);
			writeProjectSettingsImpl(ctx.cwd, merged);
			return {
				content: [
					{
						type: "text",
						text: `Applied project baseline (${profile}) to .pi/settings.json`,
					},
				],
				details: {
					applied: true,
					profile,
					path: path.join(ctx.cwd, ".pi", "settings.json"),
				},
			};
		},
	});
}
