import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PilotCapabilities } from "./colony-pilot-runtime";
import { missingCapabilities } from "./colony-pilot-runtime";

export interface ColonyPilotPreflightConfig {
	enabled: boolean;
	enforceOnAntColonyTool: boolean;
	requiredExecutables: string[];
	requireColonyCapabilities: Array<keyof PilotCapabilities>;
}

export interface ColonyPilotPreflightResult {
	ok: boolean;
	missingExecutables: string[];
	missingCapabilities: Array<keyof PilotCapabilities>;
	failures: string[];
	checkedAt: number;
}

const DEFAULT_PREFLIGHT_CONFIG: ColonyPilotPreflightConfig = {
	enabled: true,
	enforceOnAntColonyTool: true,
	requiredExecutables: ["node", "git", "npm"],
	requireColonyCapabilities: ["colony", "colonyStop"],
};

function normalizeCapabilitiesList(
	value: unknown,
): Array<keyof PilotCapabilities> {
	if (!Array.isArray(value)) {
		return [...DEFAULT_PREFLIGHT_CONFIG.requireColonyCapabilities];
	}

	const allowed: Array<keyof PilotCapabilities> = [
		"monitors",
		"remote",
		"sessionWeb",
		"colony",
		"colonyStop",
	];
	const out = value.filter(
		(v): v is keyof PilotCapabilities =>
			typeof v === "string" && allowed.includes(v as keyof PilotCapabilities),
	);
	return out.length > 0
		? out
		: [...DEFAULT_PREFLIGHT_CONFIG.requireColonyCapabilities];
}

export function resolveColonyPilotPreflightConfig(
	raw?: Partial<ColonyPilotPreflightConfig>,
): ColonyPilotPreflightConfig {
	return {
		enabled: raw?.enabled !== false,
		enforceOnAntColonyTool: raw?.enforceOnAntColonyTool !== false,
		requiredExecutables: Array.isArray(raw?.requiredExecutables)
			? raw.requiredExecutables.filter(
					(v): v is string => typeof v === "string" && v.trim().length > 0,
				)
			: [...DEFAULT_PREFLIGHT_CONFIG.requiredExecutables],
		requireColonyCapabilities: normalizeCapabilitiesList(
			raw?.requireColonyCapabilities,
		),
	};
}

export function executableProbe(
	name: string,
	platform = process.platform,
): { command: string; args: string[]; label: string } {
	const clean = name.trim();
	if (!clean) return { command: "", args: [], label: "" };

	if (platform === "win32" && clean.toLowerCase() === "npm") {
		// Em alguns runtimes Windows, `cmd /c npm` pode não executar como esperado.
		// PowerShell sem profile é mais estável para probe de versão.
		return {
			command: "powershell",
			args: ["-NoProfile", "-Command", "npm --version"],
			label: "npm",
		};
	}

	return { command: clean, args: ["--version"], label: clean };
}

export async function runColonyPilotPreflight(
	pi: ExtensionAPI,
	caps: PilotCapabilities,
	config: ColonyPilotPreflightConfig,
): Promise<ColonyPilotPreflightResult> {
	const missingCaps = missingCapabilities(
		caps,
		config.requireColonyCapabilities,
	);
	const missingExecutables: string[] = [];

	for (const execName of config.requiredExecutables) {
		const probe = executableProbe(execName);
		if (!probe.command) continue;

		try {
			const r = await pi.exec(probe.command, probe.args, { timeout: 5000 });
			if (r.code !== 0) missingExecutables.push(probe.label);
		} catch {
			missingExecutables.push(probe.label);
		}
	}

	const failures: string[] = [];
	if (missingCaps.length > 0) {
		failures.push(`missing capabilities: ${missingCaps.join(", ")}`);
	}
	if (missingExecutables.length > 0) {
		failures.push(`missing executables: ${missingExecutables.join(", ")}`);
	}

	return {
		ok: failures.length === 0,
		missingCapabilities: missingCaps,
		missingExecutables,
		failures,
		checkedAt: Date.now(),
	};
}

export function formatPreflightResult(
	result: ColonyPilotPreflightResult,
): string {
	const lines = [
		"colony-pilot preflight",
		`ok: ${result.ok ? "yes" : "no"}`,
		`missingCapabilities: ${result.missingCapabilities.length > 0 ? result.missingCapabilities.join(", ") : "(none)"}`,
		`missingExecutables: ${result.missingExecutables.length > 0 ? result.missingExecutables.join(", ") : "(none)"}`,
		`checkedAt: ${new Date(result.checkedAt).toISOString()}`,
	];

	if (result.failures.length > 0) {
		lines.push("", "failures:", ...result.failures.map((f) => `  - ${f}`));
	}

	return lines.join("\n");
}
