import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { structuredJsonRead, structuredJsonWrite, structuredRead, structuredWrite } from "./guardrails-core-structured-io";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

export type GuardrailsAuditAppender = (
	ctx: ExtensionContext,
	key: string,
	value: Record<string, unknown>,
) => void;

export type GuardrailsPathInsideCwdChecker = (inputPath: string, cwd: string) => boolean;

function buildStructuredIoToolResponse(label: string, details: Record<string, unknown>) {
	const summaryParts = [
		`${label}: ok=${details.ok === true ? "yes" : "no"}`,
		typeof details.operation === "string" ? `operation=${details.operation}` : undefined,
		typeof details.path === "string" ? `path=${details.path}` : undefined,
		typeof details.selector === "string" ? `selector=${details.selector}` : undefined,
		typeof details.reason === "string" ? `reason=${details.reason}` : undefined,
		typeof details.found === "boolean" ? `found=${details.found ? "yes" : "no"}` : undefined,
		typeof details.dryRun === "boolean" ? `dryRun=${details.dryRun ? "yes" : "no"}` : undefined,
		typeof details.applied === "boolean" ? `applied=${details.applied ? "yes" : "no"}` : undefined,
		typeof details.changed === "boolean" ? `changed=${details.changed ? "yes" : "no"}` : undefined,
	].filter((part): part is string => Boolean(part));

	return buildOperatorVisibleToolResponse({
		label,
		summary: summaryParts.join(" "),
		details,
	});
}

export function registerGuardrailsStructuredIoSurface(
	pi: ExtensionAPI,
	appendAuditEntry: GuardrailsAuditAppender,
	isInsideCwd: GuardrailsPathInsideCwdChecker,
): void {
	pi.registerTool({
		name: "structured_io",
		label: "Structured IO",
		description: "Dry-first unified structured read/write for JSON, Markdown sections, and LaTeX sections.",
		parameters: Type.Object({
			path: Type.String({ description: "Path relativo ao projeto (dentro do cwd)." }),
			kind: Type.Optional(Type.Union([
				Type.Literal("auto"),
				Type.Literal("json"),
				Type.Literal("markdown"),
				Type.Literal("latex"),
			], { description: "auto | json | markdown | latex" })),
			selector: Type.String({ description: "JSON selector, heading:<title> for Markdown, or section:<title> for LaTeX." }),
			operation: Type.Union([
				Type.Literal("read"),
				Type.Literal("set"),
				Type.Literal("remove"),
			], { description: "read | set | remove" }),
			payload: Type.Optional(Type.Any()),
			dryRun: Type.Optional(Type.Boolean()),
			maxTouchedLines: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				path?: string;
				kind?: string;
				selector?: string;
				operation?: string;
				payload?: unknown;
				dryRun?: boolean;
				maxTouchedLines?: number;
			};
			const targetPath = String(p.path ?? "").trim();
			const selector = String(p.selector ?? "").trim();
			const operation = String(p.operation ?? "read").trim().toLowerCase();
			const kind = String(p.kind ?? "auto").trim().toLowerCase();

			if (!targetPath || !selector) {
				const details = { ok: false, reason: "missing-path-or-selector" };
				return buildStructuredIoToolResponse("structured_io", details);
			}

			if (!isInsideCwd(targetPath, ctx.cwd)) {
				const details = { ok: false, reason: "path-outside-cwd", path: targetPath };
				return buildStructuredIoToolResponse("structured_io", details);
			}

			const absolutePath = resolve(ctx.cwd, targetPath);
			if (!existsSync(absolutePath)) {
				const details = { ok: false, reason: "file-not-found", path: targetPath };
				return buildStructuredIoToolResponse("structured_io", details);
			}

			const content = readFileSync(absolutePath, "utf8");
			if (operation === "read") {
				const result = structuredRead({ content, selector, kind, path: targetPath });
				appendAuditEntry(ctx, "guardrails-core.structured-io.read", {
					atIso: new Date().toISOString(),
					path: targetPath,
					kind: result.kind,
					selector,
					via: result.via,
					found: result.found,
					reason: result.reason,
					shape: result.shape,
					sourceSpan: result.sourceSpan,
				});
				const details = { ok: true, path: targetPath, selector, operation, ...result };
				return buildStructuredIoToolResponse("structured_io", details);
			}

			if (operation !== "set" && operation !== "remove") {
				const details = { ok: false, reason: "invalid-operation", operation, allowed: ["read", "set", "remove"] };
				return buildStructuredIoToolResponse("structured_io", details);
			}

			if (operation === "set" && p.payload === undefined) {
				const details = { ok: false, reason: "missing-payload-for-set" };
				return buildStructuredIoToolResponse("structured_io", details);
			}

			const result = structuredWrite({
				content,
				selector,
				kind,
				path: targetPath,
				operation: operation as "set" | "remove",
				payload: p.payload,
				dryRun: p.dryRun !== false,
				maxTouchedLines: p.maxTouchedLines,
			});

			if (result.applied && result.output) {
				writeFileSync(absolutePath, `${result.output}\n`, "utf8");
			}

			appendAuditEntry(ctx, "guardrails-core.structured-io.write", {
				atIso: new Date().toISOString(),
				path: targetPath,
				kind: result.kind,
				selector,
				operation,
				via: result.via,
				dryRun: p.dryRun !== false,
				maxTouchedLines: p.maxTouchedLines,
				applied: result.applied,
				changed: result.changed,
				blocked: result.blocked,
				reason: result.reason,
				riskLevel: result.riskLevel,
				touchedLines: result.touchedLines,
				rollbackToken: result.rollbackToken,
				sourceSpan: result.sourceSpan,
			});

			const details = { ok: true, path: targetPath, selector, operation, ...result };
			return buildStructuredIoToolResponse("structured_io", details);
		},
	});

	pi.registerTool({
		name: "structured_io_json",
		label: "Structured IO JSON",
		description: "Dry-first structured JSON read/write with selector-based targeting and blast-radius caps.",
		parameters: Type.Object({
			path: Type.String({ description: "Path relativo ao projeto (dentro do cwd)." }),
			selector: Type.String({ description: "Seletor canônico JSON (ex.: a.b.0.c, $.a.b[0], a[\"b.c\"].0)." }),
			operation: Type.Union([
				Type.Literal("read"),
				Type.Literal("set"),
				Type.Literal("remove"),
			], { description: "read | set | remove" }),
			payload: Type.Optional(Type.Any()),
			dryRun: Type.Optional(Type.Boolean()),
			maxTouchedLines: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				path?: string;
				selector?: string;
				operation?: string;
				payload?: unknown;
				dryRun?: boolean;
				maxTouchedLines?: number;
			};
			const targetPath = String(p.path ?? "").trim();
			const selector = String(p.selector ?? "").trim();
			const operation = String(p.operation ?? "read").trim().toLowerCase();

			if (!targetPath || !selector) {
				const details = {
					ok: false,
					reason: "missing-path-or-selector",
				};
				return buildStructuredIoToolResponse("structured_io_json", details);
			}

			if (!isInsideCwd(targetPath, ctx.cwd)) {
				const details = {
					ok: false,
					reason: "path-outside-cwd",
					path: targetPath,
				};
				return buildStructuredIoToolResponse("structured_io_json", details);
			}

			const absolutePath = resolve(ctx.cwd, targetPath);
			if (!existsSync(absolutePath)) {
				const details = {
					ok: false,
					reason: "file-not-found",
					path: targetPath,
				};
				return buildStructuredIoToolResponse("structured_io_json", details);
			}

			const content = readFileSync(absolutePath, "utf8");

			if (operation === "read") {
				const result = structuredJsonRead({ content, selector });
				appendAuditEntry(ctx, "guardrails-core.structured-io.json-read", {
					atIso: new Date().toISOString(),
					path: targetPath,
					selector,
					via: "tool",
					found: result.found,
					reason: result.reason,
					shape: result.shape,
				});
				const details = {
					ok: true,
					path: targetPath,
					selector,
					operation,
					...result,
				};
				return buildStructuredIoToolResponse("structured_io_json", details);
			}

			if (operation !== "set" && operation !== "remove") {
				const details = {
					ok: false,
					reason: "invalid-operation",
					operation,
					allowed: ["read", "set", "remove"],
				};
				return buildStructuredIoToolResponse("structured_io_json", details);
			}

			if (operation === "set" && p.payload === undefined) {
				const details = {
					ok: false,
					reason: "missing-payload-for-set",
				};
				return buildStructuredIoToolResponse("structured_io_json", details);
			}

			const result = structuredJsonWrite({
				content,
				selector,
				operation: operation as "set" | "remove",
				payload: p.payload,
				dryRun: p.dryRun !== false,
				maxTouchedLines: p.maxTouchedLines,
			});

			if (result.applied && result.output) {
				writeFileSync(absolutePath, `${result.output}\n`, "utf8");
			}

			appendAuditEntry(ctx, "guardrails-core.structured-io.json-write", {
				atIso: new Date().toISOString(),
				path: targetPath,
				selector,
				operation,
				via: "tool",
				dryRun: p.dryRun !== false,
				maxTouchedLines: p.maxTouchedLines,
				applied: result.applied,
				changed: result.changed,
				blocked: result.blocked,
				reason: result.reason,
				riskLevel: result.riskLevel,
				touchedLines: result.touchedLines,
				rollbackToken: result.rollbackToken,
			});

			const details = {
				ok: true,
				path: targetPath,
				selector,
				operation,
				...result,
			};
			return buildStructuredIoToolResponse("structured_io_json", details);
		},
	});

	pi.registerCommand("structured-io", {
		description: "Structured JSON read/write with dry-first safeguards. Usage: /structured-io [help|json-read <path> <selector>|json-write <path> <selector> <set|remove> [payload] [--apply] [--max-lines N]]",
		handler: async (args, ctx) => {
			const rawArgs = String(args ?? "").trim();
			const tokens = rawArgs.split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "help").toLowerCase();

			const helpLines = [
				"structured-io usage:",
				"  /structured-io json-read <path> <selector>",
				"  /structured-io json-write <path> <selector> <set|remove> [payload] [--apply] [--max-lines N]",
				"",
				"examples:",
				"  /structured-io json-read package.json scripts.test",
				"  /structured-io json-write package.json scripts.test set \"vitest run\"",
				"  /structured-io json-write package.json scripts.test set \"vitest run\" --apply",
				"  /structured-io json-write data.json a[\"b.c\"] set 7 --apply",
			];

			if (sub === "help") {
				ctx.ui.notify(helpLines.join("\n"), "info");
				return;
			}

			if (sub === "json-read") {
				const targetPath = tokens[1];
				const selector = tokens[2];
				if (!targetPath || !selector) {
					ctx.ui.notify(["structured-io: invalid json-read args.", ...helpLines].join("\n"), "warning");
					return;
				}

				if (!isInsideCwd(targetPath, ctx.cwd)) {
					ctx.ui.notify("structured-io: path outside cwd is not allowed.", "warning");
					return;
				}

				const absolutePath = resolve(ctx.cwd, targetPath);
				if (!existsSync(absolutePath)) {
					ctx.ui.notify(`structured-io: file not found (${targetPath})`, "warning");
					return;
				}

				const content = readFileSync(absolutePath, "utf8");
				const result = structuredJsonRead({ content, selector });

				appendAuditEntry(ctx, "guardrails-core.structured-io.json-read", {
					atIso: new Date().toISOString(),
					path: targetPath,
					selector,
					found: result.found,
					reason: result.reason,
					shape: result.shape,
				});

				const lines = [
					"structured-io json-read",
					`path=${targetPath} selector=${selector}`,
					JSON.stringify(result, null, 2),
				];
				ctx.ui.notify(lines.join("\n"), result.found ? "info" : "warning");
				return;
			}

			if (sub === "json-write") {
				const targetPath = tokens[1];
				const selector = tokens[2];
				const operation = String(tokens[3] ?? "").toLowerCase();
				if (!targetPath || !selector || (operation !== "set" && operation !== "remove")) {
					ctx.ui.notify(["structured-io: invalid json-write args.", ...helpLines].join("\n"), "warning");
					return;
				}

				if (!isInsideCwd(targetPath, ctx.cwd)) {
					ctx.ui.notify("structured-io: path outside cwd is not allowed.", "warning");
					return;
				}

				const absolutePath = resolve(ctx.cwd, targetPath);
				if (!existsSync(absolutePath)) {
					ctx.ui.notify(`structured-io: file not found (${targetPath})`, "warning");
					return;
				}

				const applyRequested = tokens.includes("--apply");
				const maxLinesFlagIndex = tokens.findIndex((t) => t === "--max-lines");
				let maxTouchedLines = 120;
				if (maxLinesFlagIndex >= 0) {
					const rawMaxLines = tokens[maxLinesFlagIndex + 1];
					const parsedMaxLines = Number(rawMaxLines);
					if (!Number.isFinite(parsedMaxLines) || parsedMaxLines < 1) {
						ctx.ui.notify("structured-io: --max-lines must be a positive integer.", "warning");
						return;
					}
					maxTouchedLines = Math.floor(parsedMaxLines);
				}

				const writeMatch = rawArgs.match(/^json-write\s+\S+\s+\S+\s+(set|remove)\s*(.*)$/i);
				let payloadText = writeMatch?.[2] ?? "";
				payloadText = payloadText.replace(/\s--apply\b/i, "").replace(/\s--max-lines\s+\S+\b/i, "").trim();

				let payload: unknown = undefined;
				if (operation === "set") {
					if (!payloadText) {
						ctx.ui.notify("structured-io: json-write set requires payload.", "warning");
						return;
					}
					try {
						payload = JSON.parse(payloadText);
					} catch {
						payload = payloadText;
					}
				}

				const content = readFileSync(absolutePath, "utf8");
				const result = structuredJsonWrite({
					content,
					selector,
					operation: operation as "set" | "remove",
					payload,
					dryRun: !applyRequested,
					maxTouchedLines,
				});

				if (result.applied && result.output) {
					writeFileSync(absolutePath, `${result.output}\n`, "utf8");
				}

				appendAuditEntry(ctx, "guardrails-core.structured-io.json-write", {
					atIso: new Date().toISOString(),
					path: targetPath,
					selector,
					operation,
					applyRequested,
					maxTouchedLines,
					applied: result.applied,
					changed: result.changed,
					blocked: result.blocked,
					reason: result.reason,
					riskLevel: result.riskLevel,
					touchedLines: result.touchedLines,
					rollbackToken: result.rollbackToken,
				});

				const lines = [
					"structured-io json-write",
					`path=${targetPath} selector=${selector} op=${operation} dryRun=${!applyRequested ? "yes" : "no"}`,
					`result: applied=${result.applied ? "yes" : "no"} changed=${result.changed ? "yes" : "no"} blocked=${result.blocked ? "yes" : "no"} risk=${result.riskLevel} reason=${result.reason}`,
					JSON.stringify(result, null, 2),
				];
				const level = result.blocked ? "warning" : "info";
				ctx.ui.notify(lines.join("\n"), level);
				return;
			}

			ctx.ui.notify([
				`structured-io: unknown subcommand '${sub}'.`,
				...helpLines,
			].join("\n"), "warning");
		},
	});
}
