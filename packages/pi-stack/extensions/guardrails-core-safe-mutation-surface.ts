import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	assessLargeFileMutationRisk,
	assessStructuredQueryRisk,
	buildSafeLargeFileMutationResult,
	buildStructuredQueryPlanResult,
} from "./guardrails-core-safe-mutation";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

export type GuardrailsAuditAppender = (
	ctx: ExtensionContext,
	key: string,
	value: Record<string, unknown>,
) => void;

export function registerGuardrailsSafeMutationSurface(
	pi: ExtensionAPI,
	appendAuditEntry: GuardrailsAuditAppender,
): void {
	pi.registerTool({
		name: "safe_mutate_large_file",
		label: "Safe Mutate Large File",
		description: "Dry-first deterministic risk assessment for large-file mutation operations.",
		parameters: Type.Object({
			touchedLines: Type.Integer({ minimum: 0 }),
			maxTouchedLines: Type.Integer({ minimum: 1 }),
			anchorState: Type.Union([
				Type.Literal("unique"),
				Type.Literal("missing"),
				Type.Literal("ambiguous"),
			], { description: "unique | missing | ambiguous" }),
			dryRun: Type.Optional(Type.Boolean()),
			confirmed: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				touchedLines?: unknown;
				maxTouchedLines?: unknown;
				anchorState?: unknown;
				dryRun?: unknown;
				confirmed?: unknown;
			};
			const anchorState = String(p.anchorState ?? "").trim().toLowerCase();
			if (anchorState !== "unique" && anchorState !== "missing" && anchorState !== "ambiguous") {
				const details = {
					ok: false,
					reason: "invalid-anchor-state",
					anchorState,
					allowed: ["unique", "missing", "ambiguous"],
				};
				return buildOperatorVisibleToolResponse({
					label: "safe_mutate_large_file",
					summary: `safe-mutate-large-file: ok=no reason=${details.reason}`,
					details,
				});
			}

			const touchedLines = Number(p.touchedLines);
			const maxTouchedLines = Number(p.maxTouchedLines);
			if (
				!Number.isFinite(touchedLines)
				|| !Number.isFinite(maxTouchedLines)
				|| !Number.isInteger(touchedLines)
				|| !Number.isInteger(maxTouchedLines)
				|| touchedLines < 0
				|| maxTouchedLines < 1
			) {
				const details = {
					ok: false,
					reason: "invalid-line-counts",
					touchedLines,
					maxTouchedLines,
					expected: {
						touchedLines: "integer >= 0",
						maxTouchedLines: "integer >= 1",
					},
				};
				return buildOperatorVisibleToolResponse({
					label: "safe_mutate_large_file",
					summary: `safe-mutate-large-file: ok=no reason=${details.reason}`,
					details,
				});
			}

			const dryRun = p.dryRun !== false;
			const assessment = assessLargeFileMutationRisk({
				touchedLines,
				maxTouchedLines,
				anchorState,
				applyRequested: !dryRun,
				confirmed: p.confirmed === true,
			});
			const result = buildSafeLargeFileMutationResult({
				assessment,
				dryRun,
			});

			appendAuditEntry(ctx, "guardrails-core.safe-mutation.large-file", {
				atIso: new Date().toISOString(),
				via: "tool",
				touchedLines: assessment.touchedLines,
				maxTouchedLines: assessment.maxTouchedLines,
				anchorState,
				dryRun,
				confirmed: p.confirmed === true,
				riskLevel: assessment.riskLevel,
				decision: assessment.decision,
				reason: assessment.reason,
			});

			const details = {
				ok: true,
				anchorState,
				...result,
			};
			return buildOperatorVisibleToolResponse({
				label: "safe_mutate_large_file",
				summary: `safe-mutate-large-file: ok=yes decision=${details.decision} risk=${details.riskLevel} dryRun=${details.dryRun ? "yes" : "no"}`,
				details,
			});
		},
	});

	pi.registerTool({
		name: "structured_query_plan",
		label: "Structured Query Plan",
		description: "Deterministic structured query safety plan with optional mutation blocking.",
		parameters: Type.Object({
			query: Type.String({ minLength: 1 }),
			forbidMutation: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				query?: unknown;
				forbidMutation?: unknown;
			};
			const query = String(p.query ?? "").trim();
			const forbidMutation = p.forbidMutation !== false;
			const assessment = assessStructuredQueryRisk({
				normalizedQuery: query,
				forbidMutation,
			});
			const result = buildStructuredQueryPlanResult({
				normalizedQuery: query,
				parameters: [],
				assessment,
			});

			appendAuditEntry(ctx, "guardrails-core.safe-mutation.query", {
				atIso: new Date().toISOString(),
				via: "tool",
				forbidMutation,
				riskLevel: assessment.riskLevel,
				blocked: assessment.blocked,
				reason: assessment.reason,
				safetyChecks: assessment.safetyChecks,
			});

			const details = {
				ok: true,
				forbidMutation,
				...result,
			};
			return buildOperatorVisibleToolResponse({
				label: "structured_query_plan",
				summary: `structured-query-plan: blocked=${details.blocked ? "yes" : "no"} risk=${details.riskLevel} reason=${details.reason}`,
				details,
			});
		},
	});

	pi.registerCommand("safe-mutation", {
		description: "Dry-first risk assessment for large-file mutation and structured queries. Usage: /safe-mutation [help|large-file <touchedLines> <maxTouchedLines> <unique|missing|ambiguous> [--apply] [--confirm]|query <on|off> <sql>]",
		handler: async (args, ctx) => {
			const rawArgs = String(args ?? "").trim();
			const tokens = rawArgs.split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "help").toLowerCase();

			const helpLines = [
				"safe-mutation usage:",
				"  /safe-mutation large-file <touchedLines> <maxTouchedLines> <unique|missing|ambiguous> [--apply] [--confirm]",
				"  /safe-mutation query <on|off> <sql>",
				"",
				"examples:",
				"  /safe-mutation large-file 80 120 unique --apply --confirm",
				"  /safe-mutation query on SELECT id FROM tasks WHERE status='planned' LIMIT 50",
			];

			if (sub === "help") {
				ctx.ui.notify(helpLines.join("\n"), "info");
				return;
			}

			if (sub === "large-file") {
				const touchedLines = Number(tokens[1]);
				const maxTouchedLines = Number(tokens[2]);
				const anchorStateRaw = String(tokens[3] ?? "").toLowerCase();
				const anchorState = anchorStateRaw === "unique" || anchorStateRaw === "missing" || anchorStateRaw === "ambiguous"
					? anchorStateRaw
					: undefined;

				if (
					!Number.isFinite(touchedLines)
					|| !Number.isFinite(maxTouchedLines)
					|| !Number.isInteger(touchedLines)
					|| !Number.isInteger(maxTouchedLines)
					|| touchedLines < 0
					|| maxTouchedLines < 1
					|| !anchorState
				) {
					ctx.ui.notify([
						"safe-mutation: invalid large-file arguments (touchedLines>=0 integer, maxTouchedLines>=1 integer).",
						...helpLines,
					].join("\n"), "warning");
					return;
				}

				const applyRequested = tokens.includes("--apply") || tokens.includes("apply");
				const confirmed = tokens.includes("--confirm") || tokens.includes("confirm");
				const assessment = assessLargeFileMutationRisk({
					touchedLines,
					maxTouchedLines,
					anchorState,
					applyRequested,
					confirmed,
				});
				const result = buildSafeLargeFileMutationResult({
					assessment,
					dryRun: !applyRequested,
					changed: applyRequested && assessment.decision === "allow-apply",
					preview: "dry-first: canonical preview placeholder",
					rollbackToken: applyRequested && assessment.decision === "allow-apply" ? `rb-${Date.now()}` : null,
				});

				appendAuditEntry(ctx, "guardrails-core.safe-mutation.large-file", {
					atIso: new Date().toISOString(),
					touchedLines: assessment.touchedLines,
					maxTouchedLines: assessment.maxTouchedLines,
					anchorState,
					applyRequested,
					confirmed,
					riskLevel: assessment.riskLevel,
					decision: assessment.decision,
					reason: assessment.reason,
					applied: result.applied,
				});

				const lines = [
					"safe-mutation large-file",
					`risk=${assessment.riskLevel} decision=${assessment.decision} reason=${assessment.reason}`,
					JSON.stringify(result, null, 2),
				];
				const level = assessment.decision === "allow-preview" || assessment.decision === "allow-apply"
					? "info"
					: "warning";
				ctx.ui.notify(lines.join("\n"), level);
				return;
			}

			if (sub === "query") {
				const mode = String(tokens[1] ?? "on").toLowerCase();
				const forbidMutation = !["off", "false", "0", "no"].includes(mode);
				const sql = rawArgs.replace(/^query\s+\S+\s*/i, "").trim();
				if (!sql) {
					ctx.ui.notify([
						"safe-mutation: query requires SQL text.",
						...helpLines,
					].join("\n"), "warning");
					return;
				}

				const assessment = assessStructuredQueryRisk({
					normalizedQuery: sql,
					forbidMutation,
				});
				const result = buildStructuredQueryPlanResult({
					normalizedQuery: sql,
					parameters: [],
					assessment,
				});

				appendAuditEntry(ctx, "guardrails-core.safe-mutation.query", {
					atIso: new Date().toISOString(),
					forbidMutation,
					riskLevel: assessment.riskLevel,
					blocked: assessment.blocked,
					reason: assessment.reason,
					safetyChecks: assessment.safetyChecks,
				});

				const lines = [
					"safe-mutation query",
					`risk=${assessment.riskLevel} blocked=${assessment.blocked ? "yes" : "no"} reason=${assessment.reason}`,
					JSON.stringify(result, null, 2),
				];
				ctx.ui.notify(lines.join("\n"), assessment.blocked ? "warning" : "info");
				return;
			}

			ctx.ui.notify([
				`safe-mutation: unknown subcommand '${sub}'.`,
				...helpLines,
			].join("\n"), "warning");
		},
	});
}
