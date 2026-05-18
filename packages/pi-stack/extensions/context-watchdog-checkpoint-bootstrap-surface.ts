import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildContextWatchBootstrapPlan } from "./context-watchdog-bootstrap";
import { writeLocalSliceHandoffCheckpoint } from "./context-watchdog-runtime-helpers";
import { hasStructuredOperatorApproval } from "./guardrails-core-operator-approval";
import { operatorApprovalParameter } from "./guardrails-core-operator-approval-schema";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

export interface ContextWatchdogBootstrapApplyResult {
	preset: string;
	settingsPath: string;
	patch: Record<string, unknown>;
	notes: string[];
}

export interface ContextWatchdogCheckpointBootstrapSurfaceRuntime {
	isReloadRequiredForSourceUpdate(): boolean;
	applyPreset(ctx: ExtensionContext, presetInput?: unknown): ContextWatchdogBootstrapApplyResult;
}

export function registerContextWatchdogCheckpointBootstrapSurface(
	pi: ExtensionAPI,
	runtime: ContextWatchdogCheckpointBootstrapSurfaceRuntime,
): void {
	pi.registerTool({
		name: "context_watch_checkpoint",
		label: "Context Watch Checkpoint",
		description:
			"Write a compact bounded local-slice handoff checkpoint to .project/handoff.json.",
		parameters: Type.Object({
			task_id: Type.Optional(Type.String()),
			context: Type.String(),
			validation: Type.Optional(Type.Array(Type.String())),
			commits: Type.Optional(Type.Array(Type.String())),
			next_actions: Type.Optional(Type.Array(Type.String())),
			blockers: Type.Optional(Type.Array(Type.String())),
			context_level: Type.Optional(Type.Union([
				Type.Literal("ok"),
				Type.Literal("warn"),
				Type.Literal("checkpoint"),
				Type.Literal("compact"),
			])),
			context_percent: Type.Optional(Type.Number()),
			recommendation: Type.Optional(Type.String()),
			growth_decision: Type.Optional(Type.Union([
				Type.Literal("go"),
				Type.Literal("hold"),
				Type.Literal("needs-evidence"),
			])),
			growth_score: Type.Optional(Type.Number()),
			growth_code: Type.Optional(Type.String()),
			stop_status: Type.Optional(Type.Union([
				Type.Literal("graceful"),
				Type.Literal("interrupted"),
				Type.Literal("unknown"),
			])),
			stop_source: Type.Optional(Type.Union([
				Type.Literal("operator"),
				Type.Literal("agent"),
				Type.Literal("timeout"),
				Type.Literal("compact"),
				Type.Literal("unknown"),
			])),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				task_id?: string;
				context?: string;
				validation?: string[];
				commits?: string[];
				next_actions?: string[];
				blockers?: string[];
				context_level?: "ok" | "warn" | "checkpoint" | "compact";
				context_percent?: number;
				recommendation?: string;
				growth_decision?: "go" | "hold" | "needs-evidence";
				growth_score?: number;
				growth_code?: string;
				stop_status?: "graceful" | "interrupted" | "unknown";
				stop_source?: "operator" | "agent" | "timeout" | "compact" | "unknown";
			};
			const result = writeLocalSliceHandoffCheckpoint(ctx.cwd, {
				timestampIso: new Date().toISOString(),
				taskId: p.task_id,
				context: String(p.context ?? ""),
				validation: p.validation,
				commits: p.commits,
				nextActions: p.next_actions,
				blockers: p.blockers,
				contextLevel: p.context_level,
				contextPercent: p.context_percent,
				recommendation: p.recommendation,
				growthDecision: p.growth_decision,
				growthScore: p.growth_score,
				growthRecommendationCode: p.growth_code,
				stopStatus: p.stop_status,
				stopSource: p.stop_source,
			});
			const reloadRequired = runtime.isReloadRequiredForSourceUpdate();
			const details = {
				ok: result.ok,
				reason: result.reason,
				summary: result.summary,
				path: result.ok ? ".project/handoff.json" : undefined,
				jsonChars: result.jsonChars,
				maxJsonChars: result.maxJsonChars,
				reloadRequired,
				reloadHint: reloadRequired
					? "run /reload before relying on updated tool/runtime behavior."
					: undefined,
			};
			return {
				content: [{ type: "text", text: result.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "context_watch_bootstrap",
		label: "Context Watch Bootstrap",
		description:
			"Returns (or applies) a portable long-run context-watch preset patch (control-plane or agent-worker).",
		parameters: Type.Object({
			preset: Type.Optional(Type.String({ description: "control-plane | agent-worker" })),
			apply: Type.Optional(Type.Boolean()),
			operator_approval: operatorApprovalParameter("Structured operator approval envelope for apply=true."),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { preset?: string; apply?: boolean; operator_approval?: unknown };
			if (p.apply) {
				const structuredOperatorApproval = hasStructuredOperatorApproval(p.operator_approval);
				if (!structuredOperatorApproval) {
					const plan = buildContextWatchBootstrapPlan(p.preset);
					const details = {
						...plan,
						applied: false,
						structuredOperatorApproval,
						blockers: ["structured-operator-approval-missing"],
					};
					return buildOperatorVisibleToolResponse({
						label: "context_watch_bootstrap",
						summary: `context-watch-bootstrap: applied=no preset=${plan.preset} blockers=structured-operator-approval-missing`,
						details,
					});
				}
				const applied = runtime.applyPreset(ctx, p.preset);
				const details = { ...applied, applied: true, structuredOperatorApproval, reloadRequired: false };
				return buildOperatorVisibleToolResponse({
					label: "context_watch_bootstrap",
					summary: `context-watch-bootstrap: applied=yes preset=${applied.preset} notes=${applied.notes.length} reloadRequired=no`,
					details,
				});
			}
			const plan = buildContextWatchBootstrapPlan(p.preset);
			const details = { ...plan, applied: false };
			return buildOperatorVisibleToolResponse({
				label: "context_watch_bootstrap",
				summary: `context-watch-bootstrap: applied=no preset=${plan.preset} notes=${plan.notes.length}`,
				details,
			});
		},
	});
}
