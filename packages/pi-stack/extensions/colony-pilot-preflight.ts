import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PilotCapabilities } from "./colony-pilot-runtime";
import { missingCapabilities } from "./colony-pilot-runtime";
import {
	formatMachineMaintenanceGate,
	readMachineMaintenanceGate,
	type MachineMaintenanceGate,
	type MachineMaintenanceSeverity,
} from "./machine-maintenance";

export interface ColonyPilotPreflightConfig {
	enabled: boolean;
	enforceOnAntColonyTool: boolean;
	requiredExecutables: string[];
	requireColonyCapabilities: Array<keyof PilotCapabilities>;
	enforceMachineMaintenance: boolean;
	machineMaintenanceBlockOn: Exclude<MachineMaintenanceSeverity, "unknown">;
}

export interface ColonyPilotPreflightResult {
	ok: boolean;
	missingExecutables: string[];
	missingCapabilities: Array<keyof PilotCapabilities>;
	machineMaintenance?: Pick<
		MachineMaintenanceGate,
		"severity" | "action" | "canStartLongRun" | "blockers" | "recommendation"
	>;
	failures: string[];
	checkedAt: number;
}

const DEFAULT_PREFLIGHT_CONFIG: ColonyPilotPreflightConfig = {
	enabled: true,
	enforceOnAntColonyTool: true,
	requiredExecutables: ["node", "git", "npm"],
	requireColonyCapabilities: ["colony", "colonyStop"],
	enforceMachineMaintenance: true,
	machineMaintenanceBlockOn: "warn",
};

function normalizeMachineMaintenanceBlockOn(
	value: unknown,
): Exclude<MachineMaintenanceSeverity, "unknown"> {
	return value === "ok" ||
		value === "warn" ||
		value === "pause" ||
		value === "block"
		? value
		: DEFAULT_PREFLIGHT_CONFIG.machineMaintenanceBlockOn;
}

function severityRank(value: MachineMaintenanceSeverity): number {
	const rank: Record<MachineMaintenanceSeverity, number> = {
		ok: 0,
		unknown: 1,
		warn: 2,
		pause: 3,
		block: 4,
	};
	return rank[value] ?? rank.unknown;
}

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
		enforceMachineMaintenance: raw?.enforceMachineMaintenance !== false,
		machineMaintenanceBlockOn: normalizeMachineMaintenanceBlockOn(
			raw?.machineMaintenanceBlockOn,
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
	cwd = process.cwd(),
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

	let machineMaintenance: ColonyPilotPreflightResult["machineMaintenance"];
	if (config.enforceMachineMaintenance) {
		const gate = readMachineMaintenanceGate(cwd);
		machineMaintenance = {
			severity: gate.severity,
			action: gate.action,
			canStartLongRun: gate.canStartLongRun,
			blockers: gate.blockers,
			recommendation: gate.recommendation,
		};
		const comparableSeverity = gate.severity === "unknown" ? "warn" : gate.severity;
		if (severityRank(comparableSeverity) >= severityRank(config.machineMaintenanceBlockOn)) {
			failures.push(`machine maintenance: ${formatMachineMaintenanceGate(gate)}`);
		}
	}

	return {
		ok: failures.length === 0,
		missingCapabilities: missingCaps,
		missingExecutables,
		machineMaintenance,
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
		`machineMaintenance: ${result.machineMaintenance ? `${result.machineMaintenance.severity} / ${result.machineMaintenance.action}` : "(disabled)"}`,
		`checkedAt: ${new Date(result.checkedAt).toISOString()}`,
	];

	if (result.failures.length > 0) {
		lines.push("", "failures:", ...result.failures.map((f) => `  - ${f}`));
	}

	return lines.join("\n");
}
