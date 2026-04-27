import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	buildShellRoutingStatusLines,
	wrapCommandForHostShell,
	type CommandRoutingProfile,
} from "./guardrails-core-shell-routing";

export type GuardrailsAuditAppender = (
	ctx: ExtensionContext,
	key: string,
	value: Record<string, unknown>,
) => void;

export function registerGuardrailsShellRouteSurface(
	pi: ExtensionAPI,
	appendAuditEntry: GuardrailsAuditAppender,
	getShellRoutingProfile: () => CommandRoutingProfile,
): void {
	pi.registerCommand("shell-route", {
		description: "Show deterministic host shell routing profile or wrap a command. Usage: /shell-route [status|help|wrap <command>]",
		handler: async (args, ctx) => {
			const rawArgs = String(args ?? "").trim();
			const tokens = rawArgs.split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "status").toLowerCase();
			const profile = getShellRoutingProfile();

			if (sub === "help") {
				ctx.ui.notify([
					"shell-route usage:",
					"  /shell-route status",
					"  /shell-route wrap <command>",
					"",
					"example:",
					"  /shell-route wrap npm run test:smoke",
				].join("\n"), "info");
				return;
			}

			if (sub === "status") {
				ctx.ui.notify(buildShellRoutingStatusLines(profile).join("\n"), "info");
				return;
			}

			if (sub === "wrap") {
				const rawCommand = rawArgs.replace(/^wrap\b/i, "").trim();
				if (!rawCommand) {
					ctx.ui.notify("shell-route: usage /shell-route wrap <command>", "warning");
					return;
				}
				const wrapped = wrapCommandForHostShell(rawCommand, profile);
				const lines = [
					"shell-route wrap",
					`input: ${rawCommand}`,
					`output: ${wrapped.wrappedCommand}`,
					`changed: ${wrapped.changed ? "yes" : "no"}`,
					`reason: ${wrapped.reason}`,
				];
				ctx.ui.notify(lines.join("\n"), "info");
				appendAuditEntry(ctx, "guardrails-core.shell-routing-wrap", {
					atIso: new Date().toISOString(),
					profileId: profile.profileId,
					input: rawCommand,
					output: wrapped.wrappedCommand,
					changed: wrapped.changed,
					reason: wrapped.reason,
				});
				return;
			}

			ctx.ui.notify("shell-route: unknown subcommand. Use /shell-route help", "warning");
		},
	});
}
