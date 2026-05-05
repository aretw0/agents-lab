import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	buildGuardrailsConfigHelpLines,
	buildGuardrailsRuntimeConfigGetLines,
	buildGuardrailsRuntimeConfigSetResult,
	buildGuardrailsRuntimeConfigStatus,
	readGuardrailsRuntimeConfigSnapshot,
} from "./guardrails-core-runtime-config";

export type GuardrailsRuntimeConfigAuditAppender = (
	ctx: ExtensionContext,
	event: string,
	entry: Record<string, unknown>,
) => void;

export interface GuardrailsRuntimeConfigSurfaceRuntime {
	onConfigChanged(ctx: ExtensionContext): void;
}

function formatRuntimeConfigValueForCommand(value: unknown): string {
	if (value === undefined) return "<default>";
	if (typeof value === "string") return JSON.stringify(value);
	return String(value);
}

export function registerGuardrailsRuntimeConfigSurface(
	pi: ExtensionAPI,
	appendAuditEntry: GuardrailsRuntimeConfigAuditAppender,
	runtime: GuardrailsRuntimeConfigSurfaceRuntime,
): void {
	pi.registerCommand("guardrails-config", {
		description: "Operate runtime config safely (get/set) for guardrails long-run/pragmatic autonomy without manual settings edits. Usage: /guardrails-config [status|help|get <key>|set <key> <value>]",
		handler: async (args, ctx) => {
			const rawArgs = String(args ?? "").trim();
			const tokens = rawArgs.split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "status").toLowerCase();

			if (sub === "help") {
				ctx.ui.notify(buildGuardrailsConfigHelpLines().join("\n"), "info");
				return;
			}

			if (sub === "status") {
				ctx.ui.notify(buildGuardrailsRuntimeConfigStatus(ctx.cwd).join("\n"), "info");
				return;
			}

			if (sub === "get") {
				const key = tokens[1];
				if (!key) {
					ctx.ui.notify("guardrails-config: usage /guardrails-config get <key>", "warning");
					return;
				}
				const lines = buildGuardrailsRuntimeConfigGetLines(ctx.cwd, key);
				const isUnsupported = lines[0]?.includes("unsupported key") === true;
				ctx.ui.notify(lines.join("\n"), isUnsupported ? "warning" : "info");
				return;
			}

			if (sub === "set") {
				const key = tokens[1];
				const rawValue = tokens.slice(2).join(" ");
				if (!key || rawValue.length === 0) {
					ctx.ui.notify("guardrails-config: usage /guardrails-config set <key> <value>", "warning");
					return;
				}

				const before = readGuardrailsRuntimeConfigSnapshot(ctx.cwd);
				const result = buildGuardrailsRuntimeConfigSetResult({ cwd: ctx.cwd, key, rawValue });
				if (!result.ok) {
					ctx.ui.notify(result.lines.join("\n"), "warning");
					return;
				}

				runtime.onConfigChanged(ctx);

				const after = readGuardrailsRuntimeConfigSnapshot(ctx.cwd);
				appendAuditEntry(ctx, "guardrails-core.runtime-config-set", {
					atIso: new Date().toISOString(),
					actor: "operator-command",
					command: "guardrails-config set",
					key: result.spec.key,
					oldConfigured: result.oldConfigured,
					newConfigured: result.newValue,
					oldEffective: before[result.spec.key],
					newEffective: after[result.spec.key],
					settingsPath: result.settingsPath,
					reloadRecommended: result.spec.reloadRequired,
				});

				const lines = [
					...result.lines,
					`effective: ${formatRuntimeConfigValueForCommand(before[result.spec.key])} -> ${formatRuntimeConfigValueForCommand(after[result.spec.key])}`,
					"fallback: unsupported keys can still be edited in .pi/settings.json (manual mode).",
				];
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			ctx.ui.notify(
				[`guardrails-config: unknown subcommand '${sub}'.`, ...buildGuardrailsConfigHelpLines()].join("\n"),
				"warning",
			);
		},
	});
}
