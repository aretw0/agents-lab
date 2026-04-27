import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	formatDeliveryModePlan,
	resolveDeliveryModePlan,
	type DeliveryChannel,
	type DeliveryRuntimeMode,
} from "./guardrails-core-delivery-mode";
import {
	formatStateReconcilePlan,
	resolveStateReconcilePlan,
	type StateArtifactKind,
} from "./guardrails-core-state-reconcile";

export type GuardrailsAuditAppender = (
	ctx: ExtensionContext,
	key: string,
	value: Record<string, unknown>,
) => void;

function parseChannel(value: string | undefined): DeliveryChannel | undefined {
	const normalized = String(value ?? "").trim().toLowerCase();
	if (!normalized) return undefined;
	if (["direct", "direct-branch", "branch"].includes(normalized)) return "direct-branch";
	if (["pr", "pull-request", "pull_request"].includes(normalized)) return "pull-request";
	if (["mr", "merge-request", "merge_request"].includes(normalized)) return "merge-request";
	return undefined;
}

function parseRuntime(value: string | undefined): DeliveryRuntimeMode | undefined {
	const normalized = String(value ?? "").trim().toLowerCase();
	if (normalized === "native" || normalized === "container" || normalized === "ci") {
		return normalized;
	}
	return undefined;
}

function parseArtifact(value: string | undefined): StateArtifactKind | undefined {
	const normalized = String(value ?? "").trim().toLowerCase();
	if (normalized === "board" || normalized === "settings" || normalized === "handoff" || normalized === "generic-json") {
		return normalized;
	}
	return undefined;
}

export function registerGuardrailsDeliverySurface(
	pi: ExtensionAPI,
	appendAuditEntry: GuardrailsAuditAppender,
): void {
	pi.registerTool({
		name: "delivery_mode_plan",
		label: "Delivery Mode Plan",
		description: "Deterministic plan for runtime mode (native/container/ci) and promotion channel (direct/PR/MR).",
		parameters: Type.Object({
			preferChannel: Type.Optional(Type.Union([
				Type.Literal("direct-branch"),
				Type.Literal("pull-request"),
				Type.Literal("merge-request"),
			])),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const preferred = String((params as { preferChannel?: unknown }).preferChannel ?? "").trim().toLowerCase();
			const preferChannel = preferred === "direct-branch" || preferred === "pull-request" || preferred === "merge-request"
				? (preferred as DeliveryChannel)
				: undefined;
			const plan = resolveDeliveryModePlan({ preferChannel });
			appendAuditEntry(ctx, "guardrails-core.delivery-mode-plan", {
				atIso: new Date().toISOString(),
				via: "tool",
				preferChannel: preferChannel ?? null,
				runtimeMode: plan.runtimeMode,
				deliveryChannel: plan.deliveryChannel,
				ciProvider: plan.ciProvider,
				confidence: plan.confidence,
				signals: plan.signals,
			});
			const details = {
				ok: true,
				...plan,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
				details,
			};
		},
	});

	pi.registerCommand("delivery-mode", {
		description: "Show deterministic runtime delivery mode (native/container/ci + direct/PR/MR). Usage: /delivery-mode [status|json|help] [--channel direct|pr|mr]",
		handler: async (args, ctx) => {
			const rawArgs = String(args ?? "").trim();
			const tokens = rawArgs.split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "status").toLowerCase();

			const channelFlagIndex = tokens.findIndex((t) => t === "--channel" || t === "--prefer");
			const preferChannel = channelFlagIndex >= 0 ? parseChannel(tokens[channelFlagIndex + 1]) : undefined;

			if ((tokens.includes("--channel") || tokens.includes("--prefer")) && !preferChannel) {
				ctx.ui.notify("delivery-mode: invalid --channel value. Use direct|pr|mr", "warning");
				return;
			}

			if (sub === "help") {
				ctx.ui.notify([
					"delivery-mode usage:",
					"  /delivery-mode status [--channel direct|pr|mr]",
					"  /delivery-mode json [--channel direct|pr|mr]",
					"",
					"examples:",
					"  /delivery-mode",
					"  /delivery-mode json --channel pr",
				].join("\n"), "info");
				return;
			}

			if (sub !== "status" && sub !== "json") {
				ctx.ui.notify("delivery-mode: unknown subcommand. Use /delivery-mode help", "warning");
				return;
			}

			const plan = resolveDeliveryModePlan({ preferChannel });
			appendAuditEntry(ctx, "guardrails-core.delivery-mode-plan", {
				atIso: new Date().toISOString(),
				via: "command",
				command: "delivery-mode",
				subcommand: sub,
				preferChannel: preferChannel ?? null,
				runtimeMode: plan.runtimeMode,
				deliveryChannel: plan.deliveryChannel,
				ciProvider: plan.ciProvider,
				confidence: plan.confidence,
				signals: plan.signals,
			});

			if (sub === "json") {
				ctx.ui.notify(JSON.stringify({ ok: true, ...plan }, null, 2), "info");
				return;
			}

			ctx.ui.notify(formatDeliveryModePlan(plan).join("\n"), "info");
		},
	});

	pi.registerTool({
		name: "state_reconcile_plan",
		label: "State Reconcile Plan",
		description: "Deterministic conflict-avoidance plan for board/settings/handoff artifacts across native/container/CI flows.",
		parameters: Type.Object({
			artifactKind: Type.Optional(Type.Union([
				Type.Literal("board"),
				Type.Literal("settings"),
				Type.Literal("handoff"),
				Type.Literal("generic-json"),
			])),
			runtimeMode: Type.Optional(Type.Union([
				Type.Literal("native"),
				Type.Literal("container"),
				Type.Literal("ci"),
			])),
			deliveryChannel: Type.Optional(Type.Union([
				Type.Literal("direct-branch"),
				Type.Literal("pull-request"),
				Type.Literal("merge-request"),
			])),
			parallelWriters: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
			preferGeneratedStep: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				artifactKind?: unknown;
				runtimeMode?: unknown;
				deliveryChannel?: unknown;
				parallelWriters?: unknown;
				preferGeneratedStep?: unknown;
			};
			const delivery = resolveDeliveryModePlan();
			const plan = resolveStateReconcilePlan({
				artifactKind: p.artifactKind as StateArtifactKind | undefined,
				runtimeMode: (String(p.runtimeMode ?? "").trim().toLowerCase() || delivery.runtimeMode) as DeliveryRuntimeMode,
				deliveryChannel: (String(p.deliveryChannel ?? "").trim().toLowerCase() || delivery.deliveryChannel) as DeliveryChannel,
				parallelWriters: p.parallelWriters,
				preferGeneratedStep: p.preferGeneratedStep === true,
			});
			appendAuditEntry(ctx, "guardrails-core.state-reconcile-plan", {
				atIso: new Date().toISOString(),
				via: "tool",
				artifactKind: plan.artifactKind,
				runtimeMode: plan.runtimeMode,
				deliveryChannel: plan.deliveryChannel,
				parallelWriters: plan.parallelWriters,
				concurrencyRisk: plan.concurrencyRisk,
				recommendedPolicies: plan.recommendedPolicies,
				reasonCodes: plan.reasonCodes,
				manualReviewRequired: plan.manualReviewRequired,
			});
			const details = {
				ok: true,
				...plan,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
				details,
			};
		},
	});

	pi.registerCommand("state-reconcile", {
		description: "Plan deterministic merge/conflict handling for board/settings/handoff. Usage: /state-reconcile [status|json|help] [--artifact board|settings|handoff|generic-json] [--runtime native|container|ci] [--channel direct|pr|mr] [--writers N] [--generated-step yes|no]",
		handler: async (args, ctx) => {
			const rawArgs = String(args ?? "").trim();
			const tokens = rawArgs.split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "status").toLowerCase();

			const readFlag = (flag: string): string | undefined => {
				const idx = tokens.findIndex((t) => t === flag);
				if (idx < 0) return undefined;
				return tokens[idx + 1];
			};

			const runtimeFlag = parseRuntime(readFlag("--runtime"));
			const channelFlag = parseChannel(readFlag("--channel"));
			const artifactFlag = parseArtifact(readFlag("--artifact"));
			const writersRaw = readFlag("--writers");
			const generatedRaw = readFlag("--generated-step");

			if (readFlag("--runtime") && !runtimeFlag) {
				ctx.ui.notify("state-reconcile: invalid --runtime value (native|container|ci)", "warning");
				return;
			}
			if (readFlag("--channel") && !channelFlag) {
				ctx.ui.notify("state-reconcile: invalid --channel value (direct|pr|mr)", "warning");
				return;
			}
			if (readFlag("--artifact") && !artifactFlag) {
				ctx.ui.notify("state-reconcile: invalid --artifact value (board|settings|handoff|generic-json)", "warning");
				return;
			}

			if (sub === "help") {
				ctx.ui.notify([
					"state-reconcile usage:",
					"  /state-reconcile status [--artifact board|settings|handoff|generic-json] [--runtime native|container|ci] [--channel direct|pr|mr] [--writers N] [--generated-step yes|no]",
					"  /state-reconcile json [same flags]",
					"",
					"examples:",
					"  /state-reconcile",
					"  /state-reconcile json --artifact board --runtime ci --channel pr --writers 2",
				].join("\n"), "info");
				return;
			}

			if (sub !== "status" && sub !== "json") {
				ctx.ui.notify("state-reconcile: unknown subcommand. Use /state-reconcile help", "warning");
				return;
			}

			const inferredDelivery = resolveDeliveryModePlan({ preferChannel: channelFlag });
			const parallelWriters = Number(writersRaw);
			const preferGeneratedStep = ["1", "true", "yes", "on"].includes(String(generatedRaw ?? "").trim().toLowerCase());
			const plan = resolveStateReconcilePlan({
				artifactKind: artifactFlag,
				runtimeMode: runtimeFlag ?? inferredDelivery.runtimeMode,
				deliveryChannel: channelFlag ?? inferredDelivery.deliveryChannel,
				parallelWriters: Number.isFinite(parallelWriters) && parallelWriters >= 1 ? parallelWriters : 1,
				preferGeneratedStep,
			});

			appendAuditEntry(ctx, "guardrails-core.state-reconcile-plan", {
				atIso: new Date().toISOString(),
				via: "command",
				command: "state-reconcile",
				subcommand: sub,
				artifactKind: plan.artifactKind,
				runtimeMode: plan.runtimeMode,
				deliveryChannel: plan.deliveryChannel,
				parallelWriters: plan.parallelWriters,
				concurrencyRisk: plan.concurrencyRisk,
				recommendedPolicies: plan.recommendedPolicies,
				reasonCodes: plan.reasonCodes,
				manualReviewRequired: plan.manualReviewRequired,
			});

			if (sub === "json") {
				ctx.ui.notify(JSON.stringify({ ok: true, ...plan }, null, 2), "info");
				return;
			}

			ctx.ui.notify(formatStateReconcilePlan(plan).join("\n"), "info");
		},
	});
}
