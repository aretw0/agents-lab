import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildContextWatchBootstrapPlan } from "./context-watchdog-bootstrap";
import { writeLocalSliceHandoffCheckpoint } from "./context-watchdog-runtime-helpers";

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
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { preset?: string; apply?: boolean };
			if (p.apply) {
				const applied = runtime.applyPreset(ctx, p.preset);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ ...applied, applied: true, reloadRequired: false }, null, 2),
					}],
					details: { ...applied, applied: true, reloadRequired: false },
				};
			}
			const plan = buildContextWatchBootstrapPlan(p.preset);
			return {
				content: [{ type: "text", text: JSON.stringify({ ...plan, applied: false }, null, 2) }],
				details: { ...plan, applied: false },
			};
		},
	});
}
