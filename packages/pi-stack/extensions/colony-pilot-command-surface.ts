import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { PilotCapabilities, PilotState } from "./colony-pilot-runtime";
import {
	capabilityGuidance,
	detectPilotCapabilities,
	missingCapabilities,
	renderPilotStatus,
} from "./colony-pilot-runtime";

export function updateStatusUI(
	ctx: ExtensionContext | undefined,
	state: PilotState,
): void {
	ctx?.ui?.setStatus?.("colony-pilot", renderPilotStatus(state));
}

export function primeManualRunbook(
	ctx: ExtensionContext,
	title: string,
	steps: string[],
	reason = "Auto-dispatch de slash commands entre extensões não é suportado de forma confiável pela API atual do pi.",
): void {
	if (steps.length === 0) return;

	const text = [
		title,
		reason,
		"",
		"Execute na ordem:",
		...steps.map((s) => `  - ${s}`),
		"",
		`Primei o editor com: ${steps[0]}`,
	].join("\n");

	ctx.ui.notify(text, "info");
	ctx.ui.setEditorText?.(steps[0]);
}

export function getCapabilities(pi: ExtensionAPI): PilotCapabilities {
	const commands = pi.getCommands().map((c) => c.name);
	return detectPilotCapabilities(commands);
}

export function requireCapabilities(
	ctx: ExtensionContext,
	caps: PilotCapabilities,
	required: Array<keyof PilotCapabilities>,
	action: string,
): boolean {
	const missing = missingCapabilities(caps, required);
	if (missing.length === 0) return true;

	const lines = [
		`Não posso preparar \`${action}\` porque faltam comandos no runtime atual:`,
		...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
		"",
		"Sem acoplamento ad hoc: valide a composição da stack e só então rode /reload.",
		"Use /colony-pilot check para diagnóstico rápido.",
	];

	ctx.ui.notify(lines.join("\n"), "warning");
	ctx.ui.setEditorText?.("/colony-pilot check");
	return false;
}

export async function tryOpenUrl(
	pi: ExtensionAPI,
	url: string,
): Promise<boolean> {
	try {
		if (process.platform === "win32") {
			const r = await pi.exec("cmd", ["/c", "start", "", url], {
				timeout: 5000,
			});
			return r.code === 0;
		}
		if (process.platform === "darwin") {
			const r = await pi.exec("open", [url], { timeout: 5000 });
			return r.code === 0;
		}

		const r = await pi.exec("xdg-open", [url], { timeout: 5000 });
		return r.code === 0;
	} catch {
		return false;
	}
}
