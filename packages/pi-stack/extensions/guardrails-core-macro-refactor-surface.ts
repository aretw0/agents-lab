import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	buildRefactorFormatTargetResult,
	buildRefactorOrganizeImportsResult,
	buildRefactorRenameSymbolResult,
} from "./guardrails-core-macro-refactor";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

export type GuardrailsAuditAppender = (
	ctx: ExtensionContext,
	key: string,
	value: Record<string, unknown>,
) => void;

export type GuardrailsPathInsideCwdChecker = (inputPath: string, cwd: string) => boolean;

export function registerGuardrailsMacroRefactorSurface(
	pi: ExtensionAPI,
	appendAuditEntry: GuardrailsAuditAppender,
	isInsideCwd: GuardrailsPathInsideCwdChecker,
): void {
	pi.registerTool({
		name: "refactor_rename_symbol",
		label: "Refactor Rename Symbol",
		description: "Deterministic dry-first macro plan for project/file symbol rename with explicit fallback.",
		parameters: Type.Object({
			symbol: Type.String({ description: "Current symbol name." }),
			to: Type.String({ description: "New symbol name." }),
			scope: Type.Optional(Type.Union([
				Type.Literal("file"),
				Type.Literal("directory"),
				Type.Literal("workspace"),
			], { description: "file | directory | workspace" })),
			path: Type.Optional(Type.String({ description: "Optional path anchor inside cwd." })),
			dryRun: Type.Optional(Type.Boolean()),
			maxFiles: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				symbol?: unknown;
				to?: unknown;
				scope?: unknown;
				path?: unknown;
				dryRun?: unknown;
				maxFiles?: unknown;
			};
			const pathInput = String(p.path ?? "").trim();
			const pathInsideCwd = pathInput.length > 0 ? isInsideCwd(pathInput, ctx.cwd) : undefined;
			const result = buildRefactorRenameSymbolResult({
				symbol: p.symbol,
				to: p.to,
				scope: p.scope,
				path: pathInput || undefined,
				dryRun: p.dryRun,
				maxFiles: p.maxFiles,
				pathInsideCwd,
			});
			appendAuditEntry(ctx, "guardrails-core.macro-refactor.rename-symbol", {
				atIso: new Date().toISOString(),
				request: result.request,
				dryRun: result.dryRun,
				applyRequested: result.applyRequested,
				reason: result.reason,
				blocked: result.blocked,
				supported: result.supported,
				riskLevel: result.riskLevel,
			});
			const details = {
				ok: !result.blocked,
				...result,
			};
			return buildOperatorVisibleToolResponse({
				label: "refactor_rename_symbol",
				summary: result.summary,
				details,
			});
		},
	});

	pi.registerTool({
		name: "refactor_organize_imports",
		label: "Refactor Organize Imports",
		description: "Deterministic dry-first macro plan for organize-imports with explicit fallback.",
		parameters: Type.Object({
			path: Type.String({ description: "Target file path inside cwd." }),
			dryRun: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { path?: unknown; dryRun?: unknown };
			const targetPath = String(p.path ?? "").trim();
			const result = buildRefactorOrganizeImportsResult({
				path: targetPath,
				dryRun: p.dryRun,
				pathInsideCwd: targetPath.length > 0 ? isInsideCwd(targetPath, ctx.cwd) : undefined,
			});
			appendAuditEntry(ctx, "guardrails-core.macro-refactor.organize-imports", {
				atIso: new Date().toISOString(),
				request: result.request,
				dryRun: result.dryRun,
				applyRequested: result.applyRequested,
				reason: result.reason,
				blocked: result.blocked,
				supported: result.supported,
				riskLevel: result.riskLevel,
			});
			const details = {
				ok: !result.blocked,
				...result,
			};
			return buildOperatorVisibleToolResponse({
				label: "refactor_organize_imports",
				summary: result.summary,
				details,
			});
		},
	});

	pi.registerTool({
		name: "refactor_format_target",
		label: "Refactor Format Target",
		description: "Deterministic dry-first macro plan for format-target with explicit fallback.",
		parameters: Type.Object({
			path: Type.String({ description: "Target file path inside cwd." }),
			rangeStartLine: Type.Optional(Type.Integer({ minimum: 1 })),
			rangeEndLine: Type.Optional(Type.Integer({ minimum: 1 })),
			dryRun: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				path?: unknown;
				rangeStartLine?: unknown;
				rangeEndLine?: unknown;
				dryRun?: unknown;
			};
			const targetPath = String(p.path ?? "").trim();
			const result = buildRefactorFormatTargetResult({
				path: targetPath,
				rangeStartLine: p.rangeStartLine,
				rangeEndLine: p.rangeEndLine,
				dryRun: p.dryRun,
				pathInsideCwd: targetPath.length > 0 ? isInsideCwd(targetPath, ctx.cwd) : undefined,
			});
			appendAuditEntry(ctx, "guardrails-core.macro-refactor.format-target", {
				atIso: new Date().toISOString(),
				request: result.request,
				dryRun: result.dryRun,
				applyRequested: result.applyRequested,
				reason: result.reason,
				blocked: result.blocked,
				supported: result.supported,
				riskLevel: result.riskLevel,
			});
			const details = {
				ok: !result.blocked,
				...result,
			};
			return buildOperatorVisibleToolResponse({
				label: "refactor_format_target",
				summary: result.summary,
				details,
			});
		},
	});

	pi.registerCommand("macro-refactor", {
		description: "Dry-first macro plans for rename/imports/format. Usage: /macro-refactor [help|rename-symbol <symbol> <to> [--scope file|directory|workspace] [--path <path>] [--apply]|organize-imports <path> [--apply]|format-target <path> [--start N --end N] [--apply]]",
		handler: async (args, ctx) => {
			const rawArgs = String(args ?? "").trim();
			const tokens = rawArgs.split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "help").toLowerCase();
			const applyRequested = tokens.includes("--apply");
			const dryRun = !applyRequested;

			const helpLines = [
				"macro-refactor usage:",
				"  /macro-refactor rename-symbol <symbol> <to> [--scope file|directory|workspace] [--path <path>] [--max-files N] [--apply]",
				"  /macro-refactor organize-imports <path> [--apply]",
				"  /macro-refactor format-target <path> [--start N --end N] [--apply]",
				"",
				"note: current runtime returns deterministic preview/fallback contracts; apply requires language/formatter engine availability.",
			];

			if (sub === "help") {
				ctx.ui.notify(helpLines.join("\n"), "info");
				return;
			}

			if (sub === "rename-symbol") {
				const symbol = tokens[1] ?? "";
				const to = tokens[2] ?? "";
				const scopeFlagIndex = tokens.findIndex((t) => t === "--scope");
				const pathFlagIndex = tokens.findIndex((t) => t === "--path");
				const maxFilesFlagIndex = tokens.findIndex((t) => t === "--max-files");
				const scope = scopeFlagIndex >= 0 ? tokens[scopeFlagIndex + 1] : undefined;
				const pathInput = pathFlagIndex >= 0 ? tokens[pathFlagIndex + 1] : undefined;
				const maxFiles = maxFilesFlagIndex >= 0 ? Number(tokens[maxFilesFlagIndex + 1]) : undefined;

				const result = buildRefactorRenameSymbolResult({
					symbol,
					to,
					scope,
					path: pathInput,
					maxFiles,
					dryRun,
					pathInsideCwd: pathInput ? isInsideCwd(pathInput, ctx.cwd) : undefined,
				});
				appendAuditEntry(ctx, "guardrails-core.macro-refactor.rename-symbol", {
					atIso: new Date().toISOString(),
					via: "command",
					request: result.request,
					dryRun: result.dryRun,
					applyRequested: result.applyRequested,
					reason: result.reason,
					blocked: result.blocked,
					supported: result.supported,
					riskLevel: result.riskLevel,
				});
				ctx.ui.notify([
					"macro-refactor rename-symbol",
					JSON.stringify(result, null, 2),
				].join("\n"), result.blocked ? "warning" : "info");
				return;
			}

			if (sub === "organize-imports") {
				const targetPath = tokens[1] ?? "";
				const result = buildRefactorOrganizeImportsResult({
					path: targetPath,
					dryRun,
					pathInsideCwd: targetPath ? isInsideCwd(targetPath, ctx.cwd) : undefined,
				});
				appendAuditEntry(ctx, "guardrails-core.macro-refactor.organize-imports", {
					atIso: new Date().toISOString(),
					via: "command",
					request: result.request,
					dryRun: result.dryRun,
					applyRequested: result.applyRequested,
					reason: result.reason,
					blocked: result.blocked,
					supported: result.supported,
					riskLevel: result.riskLevel,
				});
				ctx.ui.notify([
					"macro-refactor organize-imports",
					JSON.stringify(result, null, 2),
				].join("\n"), result.blocked ? "warning" : "info");
				return;
			}

			if (sub === "format-target") {
				const targetPath = tokens[1] ?? "";
				const startFlagIndex = tokens.findIndex((t) => t === "--start");
				const endFlagIndex = tokens.findIndex((t) => t === "--end");
				const rangeStartLine = startFlagIndex >= 0 ? Number(tokens[startFlagIndex + 1]) : undefined;
				const rangeEndLine = endFlagIndex >= 0 ? Number(tokens[endFlagIndex + 1]) : undefined;
				const result = buildRefactorFormatTargetResult({
					path: targetPath,
					rangeStartLine,
					rangeEndLine,
					dryRun,
					pathInsideCwd: targetPath ? isInsideCwd(targetPath, ctx.cwd) : undefined,
				});
				appendAuditEntry(ctx, "guardrails-core.macro-refactor.format-target", {
					atIso: new Date().toISOString(),
					via: "command",
					request: result.request,
					dryRun: result.dryRun,
					applyRequested: result.applyRequested,
					reason: result.reason,
					blocked: result.blocked,
					supported: result.supported,
					riskLevel: result.riskLevel,
				});
				ctx.ui.notify([
					"macro-refactor format-target",
					JSON.stringify(result, null, 2),
				].join("\n"), result.blocked ? "warning" : "info");
				return;
			}

			ctx.ui.notify([
				`macro-refactor: unknown subcommand '${sub}'.`,
				...helpLines,
			].join("\n"), "warning");
		},
	});
}
