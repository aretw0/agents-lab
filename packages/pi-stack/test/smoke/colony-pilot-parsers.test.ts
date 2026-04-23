import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyProjectBaselineSettings,
	buildAntColonyMirrorCandidates,
	buildColonyRunSequence,
	buildColonyStopSequence,
	buildHatchDoctorSnapshot,
	buildModelPolicyProfile,
	buildProjectBaselineSettings,
	buildRuntimeRunSequence,
	buildRuntimeStopSequence,
	collectAntColonyProviders,
	colonyPhaseToProjectTaskStatus,
	detectPilotCapabilities,
	ensureRecoveryTaskForCandidate,
	evaluateAntColonyBudgetPolicy,
	evaluateAntColonyModelPolicy,
	evaluateColonyDeliveryEvidence,
	evaluateHatchReadiness,
	evaluateSelectivePromotionInventoryEvidence,
	evaluateSelectivePromotionScope,
	evaluateSelectivePromotionScopeCompliance,
	evaluateProviderBudgetGate,
	executableProbe,
	formatHatchDoctorSnapshot,
	formatHatchReadiness,
	formatHatchRunbook,
	formatToolJsonOutput,
	missingCapabilities,
	normalizeColonySignalId,
	normalizeQuotedText,
	parseBudgetOverrideReason,
	parseColonySignal,
	parseCommandInput,
	parseDeliveryModeOverride,
	parseMonitorModeFromText,
	parseProviderModelRef,
	parseRemoteAccessUrl,
	requiresApplyToBranch,
	resolveBaselineProfile,
	resolveColonyModelReadiness,
	resolveColonyPilotBudgetPolicy,
	resolveColonyPilotCandidateRetentionConfig,
	resolveColonyPilotDeliveryPolicy,
	resolveColonyPilotModelPolicy,
	resolveColonyPilotPreflightConfig,
	resolveColonyPilotProjectTaskSync,
	resolveModelAuthStatus,
	resolveModelPolicyProfile,
} from "../../extensions/colony-pilot";

describe("colony-pilot parsers", () => {
	it("formatToolJsonOutput compacta payload grande quando habilitado", () => {
		const big = {
			items: Array.from({ length: 200 }, (_, i) => ({
				id: i,
				txt: "x".repeat(30),
			})),
		};
		const text = formatToolJsonOutput("colony_pilot_status", big, {
			compactLargeJson: true,
			maxInlineJsonChars: 500,
		});

		expect(text).toContain("output compactado");
		expect(text).toContain("payload completo disponível em details");
	});

	it("formatToolJsonOutput mantém json completo quando compactação desativada", () => {
		const data = { ok: true, n: 1 };
		const text = formatToolJsonOutput("x", data, {
			compactLargeJson: false,
			maxInlineJsonChars: 10,
		});

		expect(text).toBe(JSON.stringify(data, null, 2));
	});
	it("parseColonySignal extrai phase/id", () => {
		const parsed = parseColonySignal("[COLONY_SIGNAL:LAUNCHED] [c1]");
		expect(parsed).toEqual({ phase: "launched", id: "c1" });
	});

	it("parseColonySignal reconhece budget_exceeded", () => {
		const parsed = parseColonySignal("[COLONY_SIGNAL:BUDGET_EXCEEDED] [c9]");
		expect(parsed).toEqual({ phase: "budget_exceeded", id: "c9" });
	});

	it("parseColonySignal normaliza COMPLETE para completed", () => {
		const parsed = parseColonySignal("[COLONY_SIGNAL:COMPLETE] [c1|stable]");
		expect(parsed).toEqual({ phase: "completed", id: "c1|stable" });
	});

	it("parseRemoteAccessUrl extrai URL com token", () => {
		const url = parseRemoteAccessUrl(
			"🌐 Remote active · inst-abc\nhttp://192.168.0.10:3100?t=token-123",
		);
		expect(url).toBe("http://192.168.0.10:3100?t=token-123");
	});

	it("parseMonitorModeFromText detecta ON/OFF apenas em comandos explícitos", () => {
		expect(parseMonitorModeFromText("/monitors off")).toBe("off");
		expect(
			parseMonitorModeFromText("/doctor ... monitors:OFF"),
		).toBeUndefined();
		expect(parseMonitorModeFromText("/monitors on")).toBe("on");
	});

	it("normalizeColonySignalId reduz IDs compostos e rejeita placeholders", () => {
		expect(normalizeColonySignalId("c2|colony-abc")).toBe("c2");
		expect(normalizeColonySignalId("${launched.id}")).toBeUndefined();
	});

	// BUD-019: comprehensive coverage for malformed signal IDs
	describe("normalizeColonySignalId — malformed IDs", () => {
		// exact real-world case that created the phantom "colony-colonyidentity-colony" task
		it("rejeita template literal nao resolvido: colony ${colonyIdentity(colony)}", () => {
			expect(
				normalizeColonySignalId("colony ${colonyIdentity(colony)}"),
			).toBeUndefined();
		});

		it("rejeita qualquer ID contendo ${...}", () => {
			expect(
				normalizeColonySignalId("${colonyIdentity(colony)}"),
			).toBeUndefined();
			expect(normalizeColonySignalId("c${x}1")).toBeUndefined();
			expect(normalizeColonySignalId("prefix-${var}-suffix")).toBeUndefined();
		});

		it("rejeita ID com } solitario", () => {
			expect(normalizeColonySignalId("foo}bar")).toBeUndefined();
		});

		it("rejeita ID vazio ou apenas whitespace", () => {
			expect(normalizeColonySignalId("")).toBeUndefined();
			expect(normalizeColonySignalId("   ")).toBeUndefined();
		});

		it("rejeita ID com espacos", () => {
			expect(normalizeColonySignalId("colony abc")).toBeUndefined();
		});

		it("aceita IDs validos simples", () => {
			expect(normalizeColonySignalId("c1")).toBe("c1");
			expect(normalizeColonySignalId("colony-abc")).toBe("colony-abc");
			expect(normalizeColonySignalId("C3")).toBe("C3");
			expect(normalizeColonySignalId("abc.def")).toBe("abc.def");
		});

		it("extrai primeiro segmento de IDs compostos com pipe", () => {
			expect(normalizeColonySignalId("c1|colony-abc-123")).toBe("c1");
			expect(normalizeColonySignalId("c2|stable")).toBe("c2");
		});

		it("rejeita primeiro segmento invalido mesmo com pipe", () => {
			expect(normalizeColonySignalId("${bad}|c1")).toBeUndefined();
			expect(normalizeColonySignalId("colony ${x}|fallback")).toBeUndefined();
		});
	});

	it("requiresApplyToBranch detecta goals de materialização/promoção", () => {
		expect(
			requiresApplyToBranch(
				"Executar promoção/materialização no branch principal",
			),
		).toBe(true);
		expect(requiresApplyToBranch("apply outputs to main")).toBe(true);
		expect(requiresApplyToBranch("pesquisar docs de embedding")).toBe(false);
	});

	it("buildColonyRunSequence aplica ordem do pilot", () => {
		expect(buildColonyRunSequence("Refatorar auth")).toEqual([
			"/monitors off",
			"/remote",
			"/colony Refatorar auth",
		]);
	});

	it("buildColonyStopSequence inclui restore opcional", () => {
		expect(buildColonyStopSequence()).toEqual([
			"/colony-stop all",
			"/remote stop",
		]);
		expect(buildColonyStopSequence({ restoreMonitors: true })).toEqual([
			"/colony-stop all",
			"/remote stop",
			"/monitors on",
		]);
	});

	it("parseCommandInput preserva body com espaços", () => {
		expect(parseCommandInput("run migrar auth agora")).toEqual({
			cmd: "run",
			body: "migrar auth agora",
		});
	});

	it("normalizeQuotedText remove aspas externas", () => {
		expect(normalizeQuotedText('"goal complexo"')).toBe("goal complexo");
		expect(normalizeQuotedText("'goal complexo'")).toBe("goal complexo");
		expect(normalizeQuotedText("goal sem aspas")).toBe("goal sem aspas");
	});

	it("detectPilotCapabilities reconhece comandos base com sufixos", () => {
		const caps = detectPilotCapabilities([
			"monitors",
			"remote:1",
			"session-web",
			"colony",
			"colony-stop:2",
		]);
		expect(caps).toEqual({
			monitors: true,
			remote: true,
			sessionWeb: true,
			colony: true,
			colonyStop: true,
		});
	});

	it("missingCapabilities lista gaps do runtime", () => {
		const caps = detectPilotCapabilities(["monitors", "colony"]);
		expect(
			missingCapabilities(caps, [
				"monitors",
				"remote",
				"sessionWeb",
				"colony",
				"colonyStop",
			]),
		).toEqual(["remote", "sessionWeb", "colonyStop"]);
	});

	it("runtime sequence prefere session-web quando disponível", () => {
		const caps = detectPilotCapabilities([
			"monitors",
			"session-web",
			"colony",
			"colony-stop",
		]);
		expect(buildRuntimeRunSequence(caps, "Goal A")).toEqual([
			"/monitors off",
			"/session-web start",
			"/colony Goal A",
		]);
		expect(buildRuntimeStopSequence(caps, { restoreMonitors: true })).toEqual([
			"/colony-stop all",
			"/session-web stop",
			"/monitors on",
		]);
	});

	it("buildAntColonyMirrorCandidates gera caminhos esperados no Windows", () => {
		const candidates = buildAntColonyMirrorCandidates(
			"C:/Users/alice/work/repo",
		);
		expect(candidates.length).toBe(2);
		expect(candidates[0].replace(/\\/g, "/")).toContain(
			"/.pi/agent/ant-colony/c/Users/alice/work/repo",
		);
		expect(candidates[1].replace(/\\/g, "/")).toContain(
			"/.pi/agent/ant-colony/root/c/Users/alice/work/repo",
		);
	});

	it("resolveColonyPilotPreflightConfig aplica defaults e overrides", () => {
		const cfg = resolveColonyPilotPreflightConfig({
			requiredExecutables: ["node", "pnpm"],
		});
		expect(cfg.enabled).toBe(true);
		expect(cfg.enforceOnAntColonyTool).toBe(true);
		expect(cfg.requiredExecutables).toEqual(["node", "pnpm"]);
		expect(cfg.requireColonyCapabilities).toEqual(["colony", "colonyStop"]);
	});

	it("executableProbe usa powershell para npm no Windows", () => {
		expect(executableProbe("npm", "win32")).toEqual({
			command: "powershell",
			args: ["-NoProfile", "-Command", "npm --version"],
			label: "npm",
		});
		expect(executableProbe("node", "linux")).toEqual({
			command: "node",
			args: ["--version"],
			label: "node",
		});
	});

	it("resolveColonyPilotCandidateRetentionConfig aplica defaults e clamp", () => {
		expect(resolveColonyPilotCandidateRetentionConfig()).toEqual({
			enabled: true,
			maxEntries: 40,
			maxAgeDays: 14,
		});

		expect(
			resolveColonyPilotCandidateRetentionConfig({
				enabled: false,
				maxEntries: 0,
				maxAgeDays: 999,
			}),
		).toEqual({
			enabled: false,
			maxEntries: 1,
			maxAgeDays: 365,
		});
	});

	it("applyProjectBaselineSettings mescla sem remover config existente", () => {
		const merged = applyProjectBaselineSettings({
			model: "github-copilot",
			compaction: { enabled: true },
			piStack: {
				custom: { keep: true },
			},
		}) as any;

		expect(merged.model).toBe("github-copilot");
		expect(merged.compaction.enabled).toBe(true);
		expect(merged.piStack.custom.keep).toBe(true);
		expect(merged.piStack.colonyPilot.preflight.enabled).toBe(true);
		expect(merged.piStack.webSessionGateway.port).toBe(3100);
		expect(merged.piStack.guardrailsCore.portConflict.suggestedTestPort).toBe(
			4173,
		);
		expect(merged.piStack.colonyPilot.budgetPolicy.enabled).toBe(true);
		expect(merged.piStack.colonyPilot.budgetPolicy.defaultMaxCostUsd).toBe(2);
		expect(merged.piStack.colonyPilot.deliveryPolicy.enabled).toBe(false);
		expect(merged.piStack.colonyPilot.candidateRetention).toEqual({
			enabled: true,
			maxEntries: 40,
			maxAgeDays: 14,
		});
	});
	it("applyProjectBaselineSettings migra config legado em extensions objeto", () => {
		const merged = applyProjectBaselineSettings({
			extensions: {
				colonyPilot: { preflight: { requiredExecutables: ["node"] } },
			},
		}) as any;

		expect(Array.isArray(merged.extensions)).toBe(true);
		expect(merged.piStack.colonyPilot.preflight.requiredExecutables).toEqual([
			"node",
			"git",
			"npm",
		]);
	});

	it("profile phase2 endurece baseline", () => {
		expect(resolveBaselineProfile("phase2")).toBe("phase2");
		expect(resolveBaselineProfile("other")).toBe("default");

		const phase2 = buildProjectBaselineSettings("phase2") as any;
		expect(phase2.piStack.colonyPilot.preflight.requiredExecutables).toEqual([
			"node",
			"git",
			"npm",
			"npx",
		]);
		expect(
			phase2.piStack.colonyPilot.preflight.requireColonyCapabilities,
		).toEqual(["colony", "colonyStop", "monitors", "sessionWeb"]);
		expect(phase2.piStack.guardrailsCore.portConflict.suggestedTestPort).toBe(
			4273,
		);
		expect(phase2.piStack.colonyPilot.budgetPolicy.defaultMaxCostUsd).toBe(1);
		expect(phase2.piStack.colonyPilot.budgetPolicy.hardCapUsd).toBe(10);
		expect(phase2.piStack.colonyPilot.deliveryPolicy.enabled).toBe(true);
		expect(phase2.piStack.colonyPilot.deliveryPolicy.mode).toBe(
			"patch-artifact",
		);
		expect(phase2.piStack.colonyPilot.candidateRetention).toEqual({
			enabled: true,
			maxEntries: 24,
			maxAgeDays: 10,
		});
	});
	it("parseProviderModelRef separa provider/model", () => {
		expect(parseProviderModelRef("openai-codex/gpt-5.4-mini")).toEqual({
			provider: "openai-codex",
			model: "gpt-5.4-mini",
		});
		expect(parseProviderModelRef("gpt-5.4-mini")).toBeUndefined();
	});

	it("resolveModelAuthStatus cobre estados principais", () => {
		const modelObj = { id: "gpt-5.4-mini" };
		const registryOk = {
			find: () => modelObj,
			hasConfiguredAuth: () => true,
		};
		const registryNoAuth = {
			find: () => modelObj,
			hasConfiguredAuth: () => false,
		};
		const registryMissingModel = {
			find: () => undefined,
			hasConfiguredAuth: () => false,
		};

		expect(resolveModelAuthStatus(undefined, "openai-codex/gpt-5.4-mini")).toBe(
			"unavailable",
		);
		expect(
			resolveModelAuthStatus(registryMissingModel, "openai-codex/gpt-5.4-mini"),
		).toBe("missing-model");
		expect(
			resolveModelAuthStatus(registryNoAuth, "openai-codex/gpt-5.4-mini"),
		).toBe("missing-auth");
		expect(
			resolveModelAuthStatus(registryOk, "openai-codex/gpt-5.4-mini"),
		).toBe("ok");
		expect(resolveModelAuthStatus(registryOk, "gpt-5.4-mini")).toBe(
			"invalid-model",
		);
		expect(resolveModelAuthStatus(registryOk, undefined)).toBe("not-set");
	});

	it("resolveColonyModelReadiness resolve defaultModelRef com defaultProvider", () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-pilot-model-readiness-"));

		try {
			const piDir = join(cwd, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(
				join(piDir, "settings.json"),
				JSON.stringify(
					{
						defaultProvider: "openai-codex",
						defaultModel: "gpt-5.3-codex",
					},
					null,
					2,
				) + "\n",
				"utf8",
			);

			const registry = {
				find: (provider: string, model: string) => ({ provider, model }),
				hasConfiguredAuth: () => true,
			};

			const readiness = resolveColonyModelReadiness(
				cwd,
				"openai-codex/gpt-5.4-mini",
				registry,
			);
			expect(readiness.defaultProvider).toBe("openai-codex");
			expect(readiness.defaultModel).toBe("gpt-5.3-codex");
			expect(readiness.defaultModelRef).toBe("openai-codex/gpt-5.3-codex");
			expect(readiness.defaultModelStatus).toBe("ok");
			expect(readiness.currentModelStatus).toBe("ok");
			expect(readiness.antColonyDefaultModelRef).toBe(
				"openai-codex/gpt-5.4-mini",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("model policy auto-injecta roleModels e valida providers", () => {
		const policy = resolveColonyPilotModelPolicy({
			allowMixedProviders: false,
			allowedProviders: ["openai-codex"],
			roleModels: {
				scout: "openai-codex/gpt-5.4-mini",
				worker: "openai-codex/gpt-5.3-codex",
				soldier: "openai-codex/gpt-5.2-codex",
			},
		});

		const input: any = { goal: "x" };
		const registry = {
			find: () => ({ id: "ok" }),
			hasConfiguredAuth: () => true,
		};

		const evalResult = evaluateAntColonyModelPolicy(
			input,
			"openai-codex/gpt-5.4-mini",
			registry,
			policy,
		);
		expect(evalResult.ok).toBe(true);
		expect(input.scoutModel).toBe("openai-codex/gpt-5.4-mini");
		expect(input.workerModel).toBe("openai-codex/gpt-5.3-codex");
		expect(input.soldierModel).toBe("openai-codex/gpt-5.2-codex");
	});

	it("spark gate bloqueia uso spark sem trigger explícito no goal", () => {
		const policy = resolveColonyPilotModelPolicy({
			allowMixedProviders: false,
			allowedProviders: ["openai-codex"],
			sparkGateEnabled: true,
			sparkAllowedGoalTriggers: ["planning recovery", "scout burst"],
			sparkScoutOnlyTrigger: "scout burst",
		});

		const input: any = {
			goal: "rodar swarm normal",
			workerModel: "openai-codex/gpt-5.3-codex-spark",
		};
		const registry = {
			find: () => ({ id: "ok" }),
			hasConfiguredAuth: () => true,
		};

		const evalResult = evaluateAntColonyModelPolicy(
			input,
			"openai-codex/gpt-5.3-codex",
			registry,
			policy,
			input.goal,
		);

		expect(evalResult.ok).toBe(false);
		expect(
			evalResult.issues.some((i) =>
				i.includes("spark model usage requires explicit goal trigger"),
			),
		).toBe(true);
	});

	it("spark gate permite spark fora do scout quando goal inclui planning recovery", () => {
		const policy = resolveColonyPilotModelPolicy({
			allowMixedProviders: false,
			allowedProviders: ["openai-codex"],
			sparkGateEnabled: true,
			sparkAllowedGoalTriggers: ["planning recovery", "scout burst"],
			sparkScoutOnlyTrigger: "scout burst",
		});

		const input: any = {
			goal: "executar planning recovery com burst controlado",
			workerModel: "openai-codex/gpt-5.3-codex-spark",
		};
		const registry = {
			find: () => ({ id: "ok" }),
			hasConfiguredAuth: () => true,
		};

		const evalResult = evaluateAntColonyModelPolicy(
			input,
			"openai-codex/gpt-5.3-codex",
			registry,
			policy,
			input.goal,
		);

		expect(evalResult.ok).toBe(true);
	});

	it("spark gate enforce scout-only quando trigger é scout burst", () => {
		const policy = resolveColonyPilotModelPolicy({
			allowMixedProviders: false,
			allowedProviders: ["openai-codex"],
			sparkGateEnabled: true,
			sparkAllowedGoalTriggers: ["planning recovery", "scout burst"],
			sparkScoutOnlyTrigger: "scout burst",
		});

		const registry = {
			find: () => ({ id: "ok" }),
			hasConfiguredAuth: () => true,
		};

		const scoutOnlyInput: any = {
			goal: "ativar scout burst para triagem inicial",
			scoutModel: "openai-codex/gpt-5.3-codex-spark",
		};
		const scoutOnlyResult = evaluateAntColonyModelPolicy(
			scoutOnlyInput,
			"openai-codex/gpt-5.3-codex",
			registry,
			policy,
			scoutOnlyInput.goal,
		);
		expect(scoutOnlyResult.ok).toBe(true);

		const invalidInput: any = {
			goal: "ativar scout burst para triagem inicial",
			workerModel: "openai-codex/gpt-5.3-codex-spark",
		};
		const invalidResult = evaluateAntColonyModelPolicy(
			invalidInput,
			"openai-codex/gpt-5.3-codex",
			registry,
			policy,
			invalidInput.goal,
		);
		expect(invalidResult.ok).toBe(false);
		expect(
			invalidResult.issues.some((i) =>
				i.includes("is scout-only; found roles: worker"),
			),
		).toBe(true);
	});

	it("model policy profile codex mantém generic-first", () => {
		const policy = buildModelPolicyProfile("codex");
		expect(policy.specializedRolesEnabled).toBe(false);
		expect(policy.allowedProviders).toEqual(["openai-codex"]);
		expect(policy.roleModels.worker).toBe("openai-codex/gpt-5.3-codex");
		expect(policy.roleModels.review).toBeUndefined();
	});

	it("model policy profile factory-strict endurece regras", () => {
		expect(resolveModelPolicyProfile("factory-strict")).toBe("factory-strict");

		const policy = buildModelPolicyProfile("factory-strict");
		expect(policy.specializedRolesEnabled).toBe(true);
		expect(policy.requireExplicitRoleModels).toBe(true);
		expect(policy.allowMixedProviders).toBe(false);
		expect(policy.allowedProviders).toEqual(["openai-codex"]);
		expect(policy.requiredRoles).toEqual([
			"scout",
			"worker",
			"soldier",
			"design",
			"multimodal",
			"backend",
			"review",
		]);
	});

	it("model policy profile factory-strict-copilot endurece regras em copilot", () => {
		expect(resolveModelPolicyProfile("factory-strict-copilot")).toBe(
			"factory-strict-copilot",
		);

		const policy = buildModelPolicyProfile("factory-strict-copilot");
		expect(policy.specializedRolesEnabled).toBe(true);
		expect(policy.requireExplicitRoleModels).toBe(true);
		expect(policy.allowMixedProviders).toBe(false);
		expect(policy.allowedProviders).toEqual(["github-copilot"]);
		expect(policy.roleModels.worker).toBe("github-copilot/claude-sonnet-4.6");
	});

	it("factory-strict-hybrid aplica allowlist por role", () => {
		expect(resolveModelPolicyProfile("factory-strict-hybrid")).toBe(
			"factory-strict-hybrid",
		);

		const policy = buildModelPolicyProfile("factory-strict-hybrid");
		expect(policy.allowMixedProviders).toBe(true);
		expect(policy.allowedProviders).toEqual(["github-copilot", "openai-codex"]);
		expect(policy.allowedProvidersByRole.worker).toEqual(["github-copilot"]);
		expect(policy.allowedProvidersByRole.scout).toEqual(["openai-codex"]);

		const input: any = {
			goal: "x",
			scoutModel: "openai-codex/gpt-5.4-mini",
			workerModel: "openai-codex/gpt-5.3-codex",
			soldierModel: "openai-codex/gpt-5.2-codex",
			designWorkerModel: "github-copilot/claude-sonnet-4.6",
			multimodalWorkerModel: "openai-codex/gpt-5.4-mini",
			backendWorkerModel: "openai-codex/gpt-5.3-codex",
			reviewWorkerModel: "github-copilot/claude-sonnet-4.6",
		};
		const registry = {
			find: () => ({ id: "ok" }),
			hasConfiguredAuth: () => true,
		};

		const evalResult = evaluateAntColonyModelPolicy(
			input,
			"openai-codex/gpt-5.4-mini",
			registry,
			policy,
		);
		expect(evalResult.ok).toBe(false);
		expect(
			evalResult.issues.some((i) =>
				i.includes("allowedProvidersByRole.worker"),
			),
		).toBe(true);
	});

	it("budget policy injeta maxCost padrão quando habilitada", () => {
		const policy = resolveColonyPilotBudgetPolicy({
			enabled: true,
			requireMaxCost: true,
			autoInjectMaxCost: true,
			defaultMaxCostUsd: 1.25,
			hardCapUsd: 5,
		});

		const input: any = { goal: "x" };
		const evalResult = evaluateAntColonyBudgetPolicy(input, policy);

		expect(evalResult.ok).toBe(true);
		expect(input.maxCost).toBe(1.25);
		expect(evalResult.effectiveMaxCostUsd).toBe(1.25);
	});

	it("budget policy bloqueia quando maxCost excede hard cap", () => {
		const policy = resolveColonyPilotBudgetPolicy({
			enabled: true,
			requireMaxCost: true,
			autoInjectMaxCost: false,
			hardCapUsd: 2,
		});

		const input: any = { goal: "x", maxCost: 3 };
		const evalResult = evaluateAntColonyBudgetPolicy(input, policy);

		expect(evalResult.ok).toBe(false);
		expect(evalResult.issues.some((i) => i.includes("hardCapUsd"))).toBe(true);
	});

	it("parseBudgetOverrideReason extrai motivo auditável", () => {
		expect(
			parseBudgetOverrideReason(
				"Executar swarm budget-override: incidente de produção",
				"budget-override:",
			),
		).toBe("incidente de produção");
		expect(
			parseBudgetOverrideReason(
				"Executar swarm sem override",
				"budget-override:",
			),
		).toBeUndefined();
	});

	it("collectAntColonyProviders agrega providers de queen e roles", () => {
		const providers = collectAntColonyProviders(
			{
				goal: "x",
				scoutModel: "openai-codex/gpt-5.4-mini",
				workerModel: "github-copilot/claude-sonnet-4.6",
			},
			"openai-codex/gpt-5.5",
		);

		expect(providers).toEqual(["github-copilot", "openai-codex"]);
	});

	it("evaluateProviderBudgetGate bloqueia provider em BLOCK sem override", () => {
		const policy = resolveColonyPilotBudgetPolicy({
			enabled: true,
			enforceProviderBudgetBlock: true,
		});
		const evalResult = evaluateProviderBudgetGate(
			{ goal: "x", workerModel: "github-copilot/claude-sonnet-4.6" },
			"github-copilot/claude-sonnet-4.6",
			"x",
			[
				{
					provider: "github-copilot",
					period: "monthly",
					unit: "tokens-cost",
					periodDays: 30,
					periodStartIso: "2026-04-01T00:00:00.000Z",
					periodEndIso: "2026-04-30T23:59:59.999Z",
					observedMessages: 10,
					observedTokens: 1000,
					observedCostUsd: 2,
					projectedTokensEndOfPeriod: 6000,
					projectedCostUsdEndOfPeriod: 12,
					periodTokensCap: 5000,
					periodCostUsdCap: 10,
					usedPctTokens: 20,
					usedPctCost: 20,
					projectedPctTokens: 120,
					projectedPctCost: 120,
					warnPct: 80,
					hardPct: 100,
					state: "blocked",
					notes: [],
				},
			],
			[],
			policy,
		);

		expect(evalResult.ok).toBe(false);
		expect(evalResult.blockedProviders).toEqual(["github-copilot"]);
	});

	it("evaluateProviderBudgetGate permite override auditável", () => {
		const policy = resolveColonyPilotBudgetPolicy({
			enabled: true,
			enforceProviderBudgetBlock: true,
			allowProviderBudgetOverride: true,
			providerBudgetOverrideToken: "budget-override:",
		});

		const evalResult = evaluateProviderBudgetGate(
			{ goal: "x", workerModel: "github-copilot/claude-sonnet-4.6" },
			"github-copilot/claude-sonnet-4.6",
			"Rodar agora budget-override: plantao critico",
			[
				{
					provider: "github-copilot",
					period: "monthly",
					unit: "tokens-cost",
					periodDays: 30,
					periodStartIso: "2026-04-01T00:00:00.000Z",
					periodEndIso: "2026-04-30T23:59:59.999Z",
					observedMessages: 10,
					observedTokens: 1000,
					observedCostUsd: 2,
					observedRequests: 10,
					projectedTokensEndOfPeriod: 6000,
					projectedCostUsdEndOfPeriod: 12,
					projectedRequestsEndOfPeriod: 60,
					periodTokensCap: 5000,
					periodCostUsdCap: 10,
					usedPctTokens: 20,
					usedPctCost: 20,
					projectedPctTokens: 120,
					projectedPctCost: 120,
					warnPct: 80,
					hardPct: 100,
					state: "blocked",
					notes: [],
				},
			],
			[],
			policy,
		);

		expect(evalResult.ok).toBe(true);
		expect(evalResult.overrideReason).toBe("plantao critico");
	});

	it("evaluateHatchReadiness marca fail quando gate de provider está ativo sem budgets", () => {
		const readiness = evaluateHatchReadiness({
			capabilitiesMissing: [],
			preflightOk: true,
			modelPolicyOk: true,
			budgetPolicyOk: true,
			budgetPolicy: resolveColonyPilotBudgetPolicy({
				enabled: true,
				enforceProviderBudgetBlock: true,
			}),
			providerBudgetsConfigured: 0,
		});

		expect(readiness.ready).toBe(false);
		const providerItem = readiness.items.find(
			(i) => i.id === "budget-provider",
		);
		expect(providerItem?.status).toBe("fail");
	});

	it("formatHatchReadiness gera linhas determinísticas", () => {
		const lines = formatHatchReadiness({
			ready: true,
			items: [
				{
					id: "caps",
					label: "runtime capabilities",
					status: "pass",
					detail: "ok",
				},
				{
					id: "budget-provider",
					label: "provider budgets",
					status: "warn",
					detail: "desativado",
				},
			],
		});

		expect(lines).toEqual([
			"hatch readiness:",
			"  - [PASS] runtime capabilities: ok",
			"  - [WARN] provider budgets: desativado",
			"ready: yes",
		]);
	});

	it("formatHatchRunbook aplica simple-first por padrão e advanced por opt-in", () => {
		const simple = formatHatchRunbook("simple").join("\n");
		expect(simple).toContain("simple lane (default):");
		expect(simple).toContain("/colony-pilot hatch check --advanced");
		expect(simple).not.toContain("/colony <goal>");

		const advanced = formatHatchRunbook("advanced").join("\n");
		expect(advanced).toContain("advanced lane (explicit scale):");
		expect(advanced).toContain("/colony <goal>");
	});

	it("buildHatchDoctorSnapshot agrega blockers e fixes determinísticos", () => {
		const readiness = evaluateHatchReadiness({
			capabilitiesMissing: ["colony"],
			preflightOk: false,
			modelPolicyOk: true,
			budgetPolicyOk: true,
			budgetPolicy: resolveColonyPilotBudgetPolicy({
				enabled: true,
				enforceProviderBudgetBlock: true,
			}),
			providerBudgetsConfigured: 1,
		});

		const snapshot = buildHatchDoctorSnapshot({
			readiness,
			capabilitiesMissing: ["colony"],
			shellStatus: "warn",
			terminalStatus: "warn",
			schedulerStatus: "ok",
			sovereigntyOwnerMissing: 1,
			sovereigntyCoexisting: 0,
			sovereigntyHighRisk: 1,
		});

		expect(snapshot.issues.some((i) => i.severity === "blocker")).toBe(true);
		expect(
			snapshot.issues.some((i) => i.label.includes("capability missing")),
		).toBe(true);

		const lines = formatHatchDoctorSnapshot(snapshot);
		expect(lines.join("\n")).toContain("BLOCKER language");
		expect(lines.join("\n")).toContain("fix:");
	});

	it("project task sync resolver aplica defaults e clamp", () => {
		const cfg = resolveColonyPilotProjectTaskSync({
			enabled: true,
			taskIdPrefix: "  swarm-main  ",
			maxNoteLines: 2,
		});

		expect(cfg.enabled).toBe(true);
		expect(cfg.taskIdPrefix).toBe("swarm-main");
		expect(cfg.maxNoteLines).toBe(5);
		expect(cfg.autoQueueRecoveryOnCandidate).toBe(true);
		expect(cfg.recoveryTaskSuffix).toBe("promotion");
	});

	it("delivery policy resolver aceita modos válidos", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			mode: "apply-to-branch",
			requireFileInventory: true,
			requireValidationCommandLog: true,
			enforceDerivedScopeDiffApplyEvidence: true,
		});

		expect(cfg.enabled).toBe(true);
		expect(cfg.mode).toBe("apply-to-branch");
		expect(cfg.requireFileInventory).toBe(true);
		expect(cfg.requireValidationCommandLog).toBe(true);
		expect(cfg.enforceDerivedScopeDiffApplyEvidence).toBe(true);
	});

	it("delivery evidence falha quando faltam evidências obrigatórias", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			mode: "patch-artifact",
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const ev = evaluateColonyDeliveryEvidence(
			"[COLONY_SIGNAL:COMPLETE] [c1]",
			"completed",
			cfg,
		);
		expect(ev.ok).toBe(false);
		expect(ev.issues.some((i) => i.includes("file inventory"))).toBe(true);
		expect(ev.issues.some((i) => i.includes("validation command log"))).toBe(
			true,
		);
	});

	it("delivery evidence passa com report completo", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 30/31 done",
			"final file inventory: files changed: a.ts, b.md",
			"validation commands: `pnpm vitest run`",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(true);
	});

	it("detecta inventário de promoção seletiva (promoted/skipped)", () => {
		const report = [
			"Promoted file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Skipped file inventory:",
			"- packages/pi-stack/extensions/colony-pilot.ts (out-of-scope)",
		].join("\n");
		const evidence = evaluateSelectivePromotionInventoryEvidence(report);
		expect(evidence.hasPromotedFileInventory).toBe(true);
		expect(evidence.hasSkippedFileInventory).toBe(true);
		expect(evidence.hasSelectivePromotionInventory).toBe(true);
	});

	it("avalia promoção seletiva automática com scope docs-only", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"- packages/pi-stack/extensions/colony-pilot.ts",
			"- README.md",
		].join("\n");

		const scope = evaluateSelectivePromotionScope(goal, report);
		expect(scope).toBeDefined();
		expect(scope?.promotedFiles).toEqual([
			"docs/guides/project-canonical-pipeline.md",
			"README.md",
		]);
		expect(scope?.skippedFiles).toEqual([
			{
				path: "packages/pi-stack/extensions/colony-pilot.ts",
				reason: "out-of-scope",
			},
		]);
	});

	it("avalia promoção seletiva automática com inventário inline (files changed)", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report =
			"final file inventory: files changed: docs/a.md, packages/pi-stack/extensions/colony-pilot.ts, README.md";

		const scope = evaluateSelectivePromotionScope(goal, report);
		expect(scope).toBeDefined();
		expect(scope?.promotedFiles).toEqual(["docs/a.md", "README.md"]);
		expect(scope?.skippedFiles).toEqual([
			{
				path: "packages/pi-stack/extensions/colony-pilot.ts",
				reason: "out-of-scope",
			},
		]);
	});

	it("avalia promoção seletiva automática com code-scope", () => {
		const goal =
			"Promover mudanças com code-scope: packages/pi-stack/extensions/**, docs/**";
		const report = [
			"Final file inventory:",
			"- packages/pi-stack/extensions/colony-pilot.ts",
			"- docs/guides/project-canonical-pipeline.md",
			"- scripts/test/session-triage-delegation.test.mjs",
		].join("\n");

		const scope = evaluateSelectivePromotionScope(goal, report);
		expect(scope).toBeDefined();
		expect(scope?.promotedFiles).toEqual([
			"packages/pi-stack/extensions/colony-pilot.ts",
			"docs/guides/project-canonical-pipeline.md",
		]);
		expect(scope?.skippedFiles).toEqual([
			{
				path: "scripts/test/session-triage-delegation.test.mjs",
				reason: "out-of-scope",
			},
		]);
	});

	it("compliance de promoção seletiva falha quando inventário promovido viola allowlist", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"- packages/pi-stack/extensions/colony-pilot.ts",
			"Promoted file inventory:",
			"- packages/pi-stack/extensions/colony-pilot.ts",
			"Skipped file inventory:",
			"- docs/guides/project-canonical-pipeline.md (reported skip)",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report);
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("explicit-inventory");
		expect(compliance?.issues.some((i) => i.includes("out-of-scope"))).toBe(
			true,
		);
	});

	it("compliance explícita exige evidência de diff/apply para promoted files", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Promoted file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Skipped file inventory:",
			"- (none)",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report);
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("explicit-inventory");
		expect(compliance?.requiresDiffApplyEvidence).toBe(true);
		expect(compliance?.hasDiffApplyEvidence).toBe(false);
		expect(
			compliance?.issues.some((i) => i.includes("selective promotion apply evidence")),
		).toBe(true);
	});

	it("compliance explícita passa quando há trilha diff/apply", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Promoted file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Skipped file inventory:",
			"- (none)",
			"Validation command log:",
			"- `git diff -- docs/guides/project-canonical-pipeline.md > /tmp/promoted.patch`",
			"- `git apply /tmp/promoted.patch`",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report);
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("explicit-inventory");
		expect(compliance?.requiresDiffApplyEvidence).toBe(true);
		expect(compliance?.hasDiffApplyEvidence).toBe(true);
		expect(compliance?.issues).toEqual([]);
	});

	it("compliance derivada de scope passa quando promoted é candidateDiff ∩ allowlist", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"- packages/pi-stack/extensions/colony-pilot.ts",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report);
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("derived-from-scope");
		expect(compliance?.requiresDiffApplyEvidence).toBe(false);
		expect(compliance?.hasDiffApplyEvidence).toBe(false);
		expect(compliance?.promotedFiles).toEqual([
			"docs/guides/project-canonical-pipeline.md",
		]);
		expect(compliance?.issues).toEqual([]);
	});

	it("compliance derivada pode exigir evidência diff/apply quando flag de enforcement está ativa", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"- packages/pi-stack/extensions/colony-pilot.ts",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report, {
			enforceDerivedScopeDiffApplyEvidence: true,
		});
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("derived-from-scope");
		expect(compliance?.requiresDiffApplyEvidence).toBe(true);
		expect(compliance?.hasDiffApplyEvidence).toBe(false);
		expect(
			compliance?.issues.some((i) => i.includes("selective promotion apply evidence")),
		).toBe(true);
	});

	it("delivery evidence em apply-to-branch exige inventários promoted/skipped", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			mode: "apply-to-branch",
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});
		const reportMissingSelection = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: docs/a.md, docs/b.md",
			"Validation command log:",
			"- `npm run test:smoke -- packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`",
		].join("\n");

		const evMissing = evaluateColonyDeliveryEvidence(
			reportMissingSelection,
			"completed",
			cfg,
		);
		expect(evMissing.ok).toBe(false);
		expect(
			evMissing.issues.some((i) => i.includes("selective promotion inventory")),
		).toBe(true);

		const reportWithSelection = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: docs/a.md, docs/b.md",
			"Promoted file inventory:",
			"- docs/a.md",
			"Skipped file inventory:",
			"- docs/b.md (out-of-scope)",
			"Validation command log:",
			"- `npm run test:smoke -- packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`",
		].join("\n");

		const evOk = evaluateColonyDeliveryEvidence(reportWithSelection, "completed", cfg);
		expect(evOk.ok).toBe(true);
		expect(evOk.evidence.hasSelectivePromotionInventory).toBe(true);
	});

	it("delivery evidence aceita command log com heading + bullet em backticks", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Validation command log:",
			"- `/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(true);
		expect(ev.evidence.hasValidationCommandLog).toBe(true);
	});

	it("delivery evidence aceita command log em bloco fenced dentro da seção", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Validation command log:",
			"```bash",
			"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts",
			"```",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(true);
		expect(ev.evidence.hasValidationCommandLog).toBe(true);
	});

	it("delivery evidence não aceita heading com comando sem backticks", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Validation command log:",
			"- /mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(false);
		expect(ev.issues.some((i) => i.includes("backticks"))).toBe(true);
	});

	it("delivery evidence não aceita heading sem comando executável detectável", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Validation command log:",
			"- pending",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(false);
		expect(ev.issues.some((i) => i.includes("validation command log"))).toBe(
			true,
		);
		expect(
			ev.issues.some(
				(i) =>
					i.includes("Validation command log") && i.includes("backticks"),
			),
		).toBe(true);
	});

	it("delivery evidence não aceita comando isolado fora de seção de validação", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Hard evidence requirements:",
			"- section: validation command log with e.g. `npm run test:smoke`",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(false);
		expect(ev.evidence.hasValidationCommandLog).toBe(false);
		expect(ev.issues.some((i) => i.includes("validation command log"))).toBe(true);
	});

	it("colonyPhaseToProjectTaskStatus respeita human close", () => {
		expect(colonyPhaseToProjectTaskStatus("running", true)).toBe("in-progress");
		expect(colonyPhaseToProjectTaskStatus("completed", true)).toBe(
			"in-progress",
		);
		expect(colonyPhaseToProjectTaskStatus("completed", false)).toBe(
			"completed",
		);
		expect(colonyPhaseToProjectTaskStatus("budget_exceeded", true)).toBe(
			"blocked",
		);
	});

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

		rmSync(dir, { recursive: true, force: true });
	});
});

// ---------------------------------------------------------------------------
// parseDeliveryModeOverride
// ---------------------------------------------------------------------------

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
