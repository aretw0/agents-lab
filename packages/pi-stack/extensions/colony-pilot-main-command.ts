import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { HatchExperienceMode } from "./colony-pilot-hatch";
import { capabilityGuidance, evaluateHatchReadiness, formatHatchReadiness, formatHatchRunbook } from "./colony-pilot-hatch";
import type { PilotCapabilities, PilotState } from "./colony-pilot-runtime";
import { buildRuntimeRunSequence, buildRuntimeStopSequence, formatPilotSnapshot, missingCapabilities, normalizeQuotedText, parseCommandInput } from "./colony-pilot-runtime";
import type { ColonyPilotPreflightConfig, ColonyPilotPreflightResult } from "./colony-pilot-preflight";
import { formatPreflightResult, runColonyPilotPreflight } from "./colony-pilot-preflight";
import { formatModelReadiness, resolveColonyModelReadiness } from "./colony-pilot-model-readiness";
import type { ColonyPilotDeliveryPolicyConfig } from "./colony-pilot-delivery-policy";
import { evaluateColonyDeliveryEvidence, formatDeliveryPolicyEvaluation } from "./colony-pilot-delivery-policy";
import { formatArtifactsReport, inspectAntColonyRuntime } from "./colony-pilot-artifacts";
import { getCapabilities, primeManualRunbook, requireCapabilities, tryOpenUrl, updateStatusUI } from "./colony-pilot-command-surface";
import { applyProjectBaselineSettings, buildProjectBaselineSettings, deepMergeObjects, resolveBaselineProfile } from "./colony-pilot-baseline";
import { evaluateAntColonyBudgetPolicy, formatBudgetPolicyEvaluation } from "./colony-pilot-budget-policy";
import type { ColonyPilotModelPolicyConfig } from "./colony-pilot-model-policy";
import { buildModelPolicyProfile, evaluateAntColonyModelPolicy, formatPolicyEvaluation, resolveColonyPilotModelPolicy, resolveModelPolicyProfile } from "./colony-pilot-model-policy";
import type { CandidateRetentionConfig } from "./colony-pilot-output-policy";
import { readProjectSettings, writeProjectSettings } from "./colony-pilot-settings";
import type { ColonyPilotBudgetPolicyConfig, ColonyPilotProjectTaskSyncConfig } from "./colony-pilot-policy-defaults";
import { buildColonyPilotCheckLines, buildColonyPilotHatchLines, buildColonyPilotStatusLines, collectColonyPilotCheckModelIssues, formatColonyPilotHelp } from "./colony-pilot-summary";
import type { ProviderBudgetGateCacheEntry } from "./colony-pilot-provider-budget-gate";
import { parseQuotaVisibilityBudgetSettings as parseQuotaVisibilityBudgetSettingsImpl } from "./colony-pilot-settings";

export interface ColonyPilotMainCommandRuntimeSettings {
	preflightConfig: ColonyPilotPreflightConfig;
	modelPolicyConfig: ColonyPilotModelPolicyConfig;
	budgetPolicyConfig: ColonyPilotBudgetPolicyConfig;
	projectTaskSyncConfig: ColonyPilotProjectTaskSyncConfig;
	deliveryPolicyConfig: ColonyPilotDeliveryPolicyConfig;
}

export interface ColonyPilotMainCommandRuntime {
	state: PilotState;
	pendingColonyGoals: Array<{ goal: string; source: "ant_colony" | "manual"; at: number }>;
	setCurrentCtx(ctx: ExtensionContext): void;
	getPreflightConfig(): ColonyPilotPreflightConfig;
	getModelPolicyConfig(): ColonyPilotModelPolicyConfig;
	setModelPolicyConfig(config: ColonyPilotModelPolicyConfig): void;
	getBudgetPolicyConfig(): ColonyPilotBudgetPolicyConfig;
	getProjectTaskSyncConfig(): ColonyPilotProjectTaskSyncConfig;
	getDeliveryPolicyConfig(): ColonyPilotDeliveryPolicyConfig;
	getCandidateRetentionConfig(): CandidateRetentionConfig;
	setPreflightCache(entry: { at: number; result: ColonyPilotPreflightResult } | undefined): void;
	setProviderBudgetGateCache(entry: ProviderBudgetGateCacheEntry | undefined): void;
	reloadSettingsFromProject(cwd: string): ColonyPilotMainCommandRuntimeSettings;
}

export function registerColonyPilotMainCommand(pi: ExtensionAPI, runtime: ColonyPilotMainCommandRuntime): void {
	pi.registerCommand("colony-pilot", {
		description:
			"Orquestra pilot de colony + web inspect + profile de monitores (run/status/stop/web).",
		handler: async (args, ctx) => {
			runtime.setCurrentCtx(ctx);
			const input = (args ?? "").trim();
			const { cmd, body } = parseCommandInput(input);
			const caps = getCapabilities(pi);
			let preflightConfig = runtime.getPreflightConfig();
			let modelPolicyConfig = runtime.getModelPolicyConfig();
			let budgetPolicyConfig = runtime.getBudgetPolicyConfig();
			let projectTaskSyncConfig = runtime.getProjectTaskSyncConfig();
			let deliveryPolicyConfig = runtime.getDeliveryPolicyConfig();
			const candidateRetentionConfig = runtime.getCandidateRetentionConfig();
			const state = runtime.state;
			const pendingColonyGoals = runtime.pendingColonyGoals;

			if (!cmd || cmd === "help") {
				ctx.ui.notify(formatColonyPilotHelp(), "info");
				return;
			}

			if (cmd === "prep") {
				const base = ["/monitors off", "/remote", "/colony <goal>"];
				primeManualRunbook(
					ctx,
					"Pilot direction:",
					base,
					[
						"- colony run com monitores gerais OFF",
						"- governança principal: mecanismos da colony (inclui soldier)",
						"- inspeção ativa por web remote + TUI status",
						"",
						"Auto-dispatch foi desativado por confiabilidade da API de comandos entre extensões.",
					].join("\n"),
				);
				return;
			}

			if (cmd === "check") {
				const missing = missingCapabilities(caps, [
					"monitors",
					"sessionWeb",
					"remote",
					"colony",
					"colonyStop",
				]);
				const currentModelRef = ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: undefined;
				const readiness = resolveColonyModelReadiness(
					ctx.cwd,
					currentModelRef,
					ctx.modelRegistry,
				);
				const policyEval = evaluateAntColonyModelPolicy(
					{ goal: "check" },
					currentModelRef,
					ctx.modelRegistry,
					modelPolicyConfig,
				);
				const budgetEval = evaluateAntColonyBudgetPolicy(
					{ goal: "check" },
					budgetPolicyConfig,
				);
				const deliveryEval = evaluateColonyDeliveryEvidence(
					"",
					"running",
					deliveryPolicyConfig,
				);

				const modelIssues = collectColonyPilotCheckModelIssues({
					currentModelStatus: readiness.currentModelStatus,
					defaultModelStatus: readiness.defaultModelStatus,
					policyIssues: policyEval.issues,
					budgetPolicyEnabled: budgetPolicyConfig.enabled,
					budgetIssues: budgetEval.issues,
				});
				const lines = buildColonyPilotCheckLines({
					caps,
					missingGuidance: missing.map((m) => capabilityGuidance(m)),
					modelReadinessLines: formatModelReadiness(readiness),
					modelPolicyLines: formatPolicyEvaluation(modelPolicyConfig, policyEval),
					budgetPolicyLines: formatBudgetPolicyEvaluation(budgetPolicyConfig, budgetEval),
					deliveryPolicyLines: formatDeliveryPolicyEvaluation(deliveryPolicyConfig, deliveryEval),
					projectTaskSyncConfig,
					candidateRetentionConfig,
					modelIssues,
				});

				const warn = missing.length > 0 || modelIssues.length > 0;
				ctx.ui.notify(lines.join("\n"), warn ? "warning" : "info");
				return;
			}

			if (cmd === "hatch") {
				const tokens = body
					.split(/\s+/)
					.map((t) => t.trim())
					.filter(Boolean);
				const action = (tokens[0] ?? "check").toLowerCase();
				const profile = resolveBaselineProfile(tokens[1] ?? "default");
				const hatchMode: HatchExperienceMode = tokens.some((token) => {
					const normalized = token.toLowerCase();
					return normalized === "--advanced" || normalized === "advanced";
				})
					? "advanced"
					: "simple";

				if (action === "doctor") {
					ctx.ui.notify(
						[
							"hatch doctor foi centralizado no doctor canônico.",
							"Use: /doctor hatch",
						].join("\n"),
						"info",
					);
					ctx.ui.setEditorText?.("/doctor hatch");
					return;
				}

				if (action === "apply") {
					const existing = readProjectSettings(ctx.cwd);
					const merged = applyProjectBaselineSettings(existing, profile);
					writeProjectSettings(ctx.cwd, merged as Record<string, unknown>);

					const reloaded = runtime.reloadSettingsFromProject(ctx.cwd);
					preflightConfig = reloaded.preflightConfig;
					modelPolicyConfig = reloaded.modelPolicyConfig;
					budgetPolicyConfig = reloaded.budgetPolicyConfig;
					projectTaskSyncConfig = reloaded.projectTaskSyncConfig;
					deliveryPolicyConfig = reloaded.deliveryPolicyConfig;

					ctx.ui.notify(
						[
							`hatch apply: baseline '${profile}' aplicado em .pi/settings.json`,
							"",
							"Próximos passos (ordem recomendada):",
							"  1) /reload",
							"  2) /monitor-provider apply",
							"  3) /colony-pilot hatch check",
							"  4) /quota-visibility budget 30",
							'  5) /colony-pilot run "<goal>"',
						].join("\n"),
						"info",
					);
					ctx.ui.setEditorText?.("/reload");
					return;
				}

				if (action !== "check") {
					ctx.ui.notify(
						"Usage: /colony-pilot hatch [check|doctor|apply] [default|phase2] [--advanced]",
						"warning",
					);
					return;
				}

				const missing = missingCapabilities(caps, [
					"monitors",
					"colony",
					"colonyStop",
				]);
				const preflight = await runColonyPilotPreflight(
					pi,
					caps,
					preflightConfig,
					ctx.cwd,
				);
				runtime.setPreflightCache({ at: Date.now(), result: preflight });

				const currentModelRef = ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: undefined;
				const modelEval = evaluateAntColonyModelPolicy(
					{ goal: "hatch-check" },
					currentModelRef,
					ctx.modelRegistry,
					modelPolicyConfig,
				);
				const budgetEval = evaluateAntColonyBudgetPolicy(
					{ goal: "hatch-check" },
					budgetPolicyConfig,
				);
				const quotaCfg = parseQuotaVisibilityBudgetSettingsImpl(ctx.cwd);

				const readiness = evaluateHatchReadiness({
					capabilitiesMissing: missing,
					preflightOk: preflight.ok,
					modelPolicyOk: modelEval.ok,
					budgetPolicyOk: budgetEval.ok,
					budgetPolicy: budgetPolicyConfig,
					providerBudgetsConfigured: Object.keys(quotaCfg.providerBudgets)
						.length,
				});

				const lines = buildColonyPilotHatchLines({
					mode: hatchMode,
					ready: readiness.ready,
					readinessLines: formatHatchReadiness(readiness),
					runbookLines: formatHatchRunbook(hatchMode),
				});

				ctx.ui.setStatus?.(
					"colony-pilot-hatch",
					`[hatch] mode=${hatchMode}${readiness.ready ? "" : " !ready"}`,
				);
				ctx.ui.notify(lines.join("\n"), readiness.ready ? "info" : "warning");
				return;
			}

			if (cmd === "status") {
				const currentModelRef = ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: undefined;
				const readiness = resolveColonyModelReadiness(
					ctx.cwd,
					currentModelRef,
					ctx.modelRegistry,
				);
				const policyEval = evaluateAntColonyModelPolicy(
					{ goal: "status" },
					currentModelRef,
					ctx.modelRegistry,
					modelPolicyConfig,
				);
				const budgetEval = evaluateAntColonyBudgetPolicy(
					{ goal: "status" },
					budgetPolicyConfig,
				);
				const deliveryEval = evaluateColonyDeliveryEvidence(
					"",
					"running",
					deliveryPolicyConfig,
				);
				const lines = buildColonyPilotStatusLines({
					snapshot: formatPilotSnapshot(state),
					caps,
					modelReadinessLines: formatModelReadiness(readiness),
					modelPolicyLines: formatPolicyEvaluation(modelPolicyConfig, policyEval),
					budgetPolicyLines: formatBudgetPolicyEvaluation(budgetPolicyConfig, budgetEval),
					deliveryPolicyLines: formatDeliveryPolicyEvaluation(deliveryPolicyConfig, deliveryEval),
					projectTaskSyncConfig,
					candidateRetentionConfig,
				});
				const warn =
					!policyEval.ok || (budgetPolicyConfig.enabled && !budgetEval.ok);
				ctx.ui.notify(lines.join("\n"), warn ? "warning" : "info");
				return;
			}

			if (cmd === "models") {
				const parsed = parseCommandInput(body);
				const action = parsed.cmd || "status";
				const profile = resolveModelPolicyProfile(
					parseCommandInput(parsed.body).cmd || parsed.body || "codex",
				);

				if (action === "status") {
					const currentModelRef = ctx.model
						? `${ctx.model.provider}/${ctx.model.id}`
						: undefined;
					const evalResult = evaluateAntColonyModelPolicy(
						{ goal: "models-status" },
						currentModelRef,
						ctx.modelRegistry,
						modelPolicyConfig,
					);

					const lines = [
						"colony-pilot model policy status",
						...formatPolicyEvaluation(modelPolicyConfig, evalResult),
						...(evalResult.issues.length > 0
							? ["", "issues:", ...evalResult.issues.map((i) => `  - ${i}`)]
							: ["", "issues: (none)"]),
					];

					ctx.ui.notify(lines.join("\n"), evalResult.ok ? "info" : "warning");
					return;
				}

				if (action === "template") {
					const template = buildModelPolicyProfile(profile);
					ctx.ui.notify(
						[
							`colony-pilot model policy template (${profile})`,
							"",
							JSON.stringify(
								{ piStack: { colonyPilot: { modelPolicy: template } } },
								null,
								2,
							),
							"",
							"Para aplicar automaticamente:",
							`  /colony-pilot models apply ${profile}`,
						].join("\n"),
						"info",
					);
					return;
				}

				if (action === "apply") {
					const settings = readProjectSettings(ctx.cwd);
					const merged = deepMergeObjects(settings, {
						piStack: {
							colonyPilot: { modelPolicy: buildModelPolicyProfile(profile) },
						},
					});
					writeProjectSettings(ctx.cwd, merged);
					const currentModelRef = ctx.model
						? `${ctx.model.provider}/${ctx.model.id}`
						: undefined;
					modelPolicyConfig = resolveColonyPilotModelPolicy(
						buildModelPolicyProfile(profile),
					);
					runtime.setModelPolicyConfig(modelPolicyConfig);
					const evalResult = evaluateAntColonyModelPolicy(
						{ goal: "models-apply" },
						currentModelRef,
						ctx.modelRegistry,
						modelPolicyConfig,
					);

					ctx.ui.notify(
						[
							`Model policy (${profile}) aplicada em .pi/settings.json`,
							"Recomendado: /reload",
							"",
							...formatPolicyEvaluation(modelPolicyConfig, evalResult),
						].join("\n"),
						evalResult.ok ? "info" : "warning",
					);
					ctx.ui.setEditorText?.("/reload");
					return;
				}

				ctx.ui.notify(
					"Usage: /colony-pilot models <status|template|apply> [copilot|codex|hybrid|factory-strict|factory-strict-copilot|factory-strict-hybrid]",
					"warning",
				);
				return;
			}

			if (cmd === "preflight") {
				const result = await runColonyPilotPreflight(pi, caps, preflightConfig, ctx.cwd);
				runtime.setPreflightCache({ at: Date.now(), result });
				ctx.ui.notify(
					formatPreflightResult(result),
					result.ok ? "info" : "warning",
				);
				return;
			}

			if (cmd === "baseline") {
				const parsed = parseCommandInput(body);
				const maybeAction = parsed.cmd || "show";
				const isProfileOnly =
					maybeAction === "default" || maybeAction === "phase2";
				const act = isProfileOnly ? "show" : maybeAction;
				const profileSource = isProfileOnly
					? maybeAction
					: parseCommandInput(parsed.body).cmd || parsed.body || "default";
				const profile = resolveBaselineProfile(profileSource);

				if (act === "show") {
					const baseline = buildProjectBaselineSettings(profile);
					ctx.ui.notify(
						[
							`colony-pilot project baseline (${profile}) (.pi/settings.json)`,
							"",
							JSON.stringify(baseline, null, 2),
							"",
							"Para aplicar automaticamente:",
							`  /colony-pilot baseline apply ${profile}`,
						].join("\n"),
						"info",
					);
					return;
				}

				if (act === "apply") {
					const merged = applyProjectBaselineSettings(
						readProjectSettings(ctx.cwd),
						profile,
					);
					writeProjectSettings(ctx.cwd, merged);
					ctx.ui.notify(
						[
							`Baseline (${profile}) aplicada em .pi/settings.json`,
							"Recomendado: /reload",
						].join("\n"),
						"info",
					);
					ctx.ui.setEditorText?.("/reload");
					return;
				}

				ctx.ui.notify(
					"Usage: /colony-pilot baseline [show|apply] [default|phase2]",
					"warning",
				);
				return;
			}

			if (cmd === "artifacts") {
				const data = inspectAntColonyRuntime(ctx.cwd);
				ctx.ui.notify(formatArtifactsReport(data), "info");
				return;
			}

			if (cmd === "run") {
				const goal = normalizeQuotedText(body);
				if (!goal) {
					ctx.ui.notify("Usage: /colony-pilot run <goal>", "warning");
					return;
				}

				if (
					!caps.monitors ||
					!caps.colony ||
					(!caps.remote && !caps.sessionWeb)
				) {
					const missing: Array<keyof PilotCapabilities> = [];
					if (!caps.monitors) missing.push("monitors");
					if (!caps.colony) missing.push("colony");
					if (!caps.remote && !caps.sessionWeb)
						missing.push("sessionWeb", "remote");
					const lines = [
						"Não posso preparar `run` porque faltam comandos no runtime atual:",
						...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
						"",
						"Use /colony-pilot check para diagnóstico rápido.",
					];
					ctx.ui.notify(lines.join("\n"), "warning");
					return;
				}

				const preflight = await runColonyPilotPreflight(
					pi,
					caps,
					preflightConfig,
					ctx.cwd,
				);
				runtime.setPreflightCache({ at: Date.now(), result: preflight });
				if (!preflight.ok) {
					ctx.ui.notify(
						[
							"Run bloqueado por preflight.",
							formatPreflightResult(preflight),
							"",
							"Resolva os itens e rode /colony-pilot preflight novamente.",
						].join("\n"),
						"warning",
					);
					ctx.ui.setEditorText?.("/colony-pilot preflight");
					return;
				}

				const sequence = buildRuntimeRunSequence(caps, goal);
				state.monitorMode = "off";
				updateStatusUI(ctx, state);

				pendingColonyGoals.push({ goal, source: "manual", at: Date.now() });
				while (pendingColonyGoals.length > 20) pendingColonyGoals.shift();

				const reason =
					budgetPolicyConfig.enabled && budgetPolicyConfig.requireMaxCost
						? [
								"Auto-dispatch de slash commands entre extensões não é suportado de forma confiável pela API atual do pi.",
								"",
								"Aviso de budget: /colony não aceita maxCost via CLI atualmente.",
								"Se precisar hard-cap de custo, prefira execução via tool ant_colony com { goal, maxCost }.",
							].join("\n")
						: undefined;

				primeManualRunbook(
					ctx,
					"Pilot run pronto (manual assistido)",
					sequence,
					reason,
				);
				return;
			}

			if (cmd === "stop") {
				const restore = body.includes("--restore-monitors");
				if (
					!caps.colonyStop ||
					(!caps.remote && !caps.sessionWeb) ||
					(restore && !caps.monitors)
				) {
					const missing: Array<keyof PilotCapabilities> = [];
					if (!caps.colonyStop) missing.push("colonyStop");
					if (!caps.remote && !caps.sessionWeb)
						missing.push("sessionWeb", "remote");
					if (restore && !caps.monitors) missing.push("monitors");

					const lines = [
						"Não posso preparar `stop` porque faltam comandos no runtime atual:",
						...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
						"",
						"Use /colony-pilot check para diagnóstico rápido.",
					];
					ctx.ui.notify(lines.join("\n"), "warning");
					return;
				}

				const sequence = buildRuntimeStopSequence(caps, {
					restoreMonitors: restore,
				});
				if (restore) state.monitorMode = "on";
				updateStatusUI(ctx, state);

				primeManualRunbook(
					ctx,
					"Pilot stop pronto (manual assistido)",
					sequence,
				);
				return;
			}

			if (cmd === "monitors") {
				const mode = normalizeQuotedText(body).split(/\s+/)[0];
				if (mode !== "on" && mode !== "off") {
					ctx.ui.notify("Usage: /colony-pilot monitors <on|off>", "warning");
					return;
				}

				if (!requireCapabilities(ctx, caps, ["monitors"], "monitors")) {
					return;
				}

				state.monitorMode = mode;
				updateStatusUI(ctx, state);
				primeManualRunbook(
					ctx,
					`Profile de monitores (${mode.toUpperCase()}) pronto`,
					[`/monitors ${mode}`],
					"Execute o comando abaixo para aplicar no runtime atual.",
				);
				return;
			}

			if (cmd === "web") {
				const { cmd: actionCmd } = parseCommandInput(body);
				const action = actionCmd || "status";

				if (action === "start") {
					if (!caps.remote && !caps.sessionWeb) {
						const lines = [
							"Não posso preparar `web start` porque faltam comandos de web no runtime:",
							`  - sessionWeb: ${capabilityGuidance("sessionWeb")}`,
							`  - remote: ${capabilityGuidance("remote")}`,
						];
						ctx.ui.notify(lines.join("\n"), "warning");
						return;
					}

					const cmd = caps.sessionWeb ? "/session-web start" : "/remote";
					primeManualRunbook(
						ctx,
						"Start do web session pronto",
						[cmd],
						"Execute o comando abaixo para iniciar o servidor web da sessão.",
					);
					return;
				}

				if (action === "stop") {
					if (!caps.remote && !caps.sessionWeb) {
						const lines = [
							"Não posso preparar `web stop` porque faltam comandos de web no runtime:",
							`  - sessionWeb: ${capabilityGuidance("sessionWeb")}`,
							`  - remote: ${capabilityGuidance("remote")}`,
						];
						ctx.ui.notify(lines.join("\n"), "warning");
						return;
					}

					state.remoteActive = false;
					state.remoteClients = 0;
					updateStatusUI(ctx, state);
					const cmd = caps.sessionWeb ? "/session-web stop" : "/remote stop";
					primeManualRunbook(
						ctx,
						"Stop do web session pronto",
						[cmd],
						"Execute o comando abaixo para encerrar o servidor web da sessão.",
					);
					return;
				}

				if (action === "open") {
					if (!state.remoteUrl) {
						ctx.ui.notify(
							"Nenhuma URL remote detectada ainda. Rode /colony-pilot web start e depois /colony-pilot status.",
							"warning",
						);
						return;
					}

					const ok = await tryOpenUrl(pi, state.remoteUrl);
					if (ok) {
						ctx.ui.notify(`Abrindo browser: ${state.remoteUrl}`, "info");
					} else {
						ctx.ui.notify(
							`Nao consegui abrir automaticamente. URL: ${state.remoteUrl}`,
							"warning",
						);
					}
					return;
				}

				if (action === "status") {
					const lines = [
						`remote: ${state.remoteActive ? "active" : "inactive"}`,
						`clients: ${state.remoteClients ?? 0}`,
						`url: ${state.remoteUrl ?? "(none)"}`,
					];
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}

				ctx.ui.notify(
					"Usage: /colony-pilot web <start|stop|open|status>",
					"warning",
				);
				return;
			}

			if (cmd === "tui") {
				ctx.ui.notify(
					[
						"TUI session access:",
						"- Nesta instância você já está na sessão ativa.",
						"- Em outro terminal, abra `pi` e use `/resume` para entrar nesta sessão.",
						`- Session file atual: ${state.lastSessionFile ?? "(ephemeral / sem arquivo)"}`,
					].join("\n"),
					"info",
				);
				return;
			}

			ctx.ui.notify(
				`Comando desconhecido: ${cmd}. Use /colony-pilot help`,
				"warning",
			);
		},
	});
}
