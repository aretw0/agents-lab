import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function registerColonyPilotCommandShortcuts(pi: ExtensionAPI): void {
	pi.registerCommand("colony-promote", {
		description: [
			"Convenience shortcut: pre-fills ant_colony call with deliveryMode='apply-to-branch'.",
			"Usage: /colony-promote <goal>",
			"This sets the per-call delivery mode override so the goal passes the delivery-policy gate",
			"without requiring a global settings change. The override is audited in the session log.",
		].join(" "),
		handler: async (args, ctx) => {
			const goal = (args ?? "").trim();
			if (!goal) {
				ctx.ui.notify(
					[
						"colony-promote: nenhum goal fornecido.",
						"Usage: /colony-promote <goal>",
						"",
						"Este comando prepara uma chamada ant_colony com deliveryMode='apply-to-branch'",
						"permitindo materialização/promoção sem editar a configuração global.",
					].join("\n"),
					"warning",
				);
				return;
			}

			const hint = [
				"colony-promote: promote goal pronto para confirmação.",
				"",
				`goal: ${goal}`,
				`deliveryMode: apply-to-branch (override per-call — auditado)`,
				"",
				"Execute a chamada abaixo (confirme antes de rodar):",
				`  ant_colony({ "goal": ${JSON.stringify(goal)}, "deliveryMode": "apply-to-branch" })`,
			].join("\n");

			ctx.ui.notify(hint, "info");
		},
	});
}
