import type { PilotCapabilities } from "./colony-pilot-runtime";

export type HatchCheckStatus = "pass" | "fail" | "warn";

export interface HatchCheckItem {
	id: string;
	label: string;
	status: HatchCheckStatus;
	detail: string;
}

export interface HatchReadiness {
	ready: boolean;
	items: HatchCheckItem[];
}

export interface HatchReadinessInput {
	capabilitiesMissing: Array<keyof PilotCapabilities>;
	preflightOk: boolean;
	modelPolicyOk: boolean;
	budgetPolicyOk: boolean;
	budgetPolicy: { enforceProviderBudgetBlock: boolean };
	providerBudgetsConfigured: number;
}

export function evaluateHatchReadiness(
	input: HatchReadinessInput,
): HatchReadiness {
	const items: HatchCheckItem[] = [];

	items.push({
		id: "caps",
		label: "runtime capabilities",
		status: input.capabilitiesMissing.length === 0 ? "pass" : "fail",
		detail:
			input.capabilitiesMissing.length === 0
				? "monitors/colony/colony-stop disponíveis"
				: `faltando: ${input.capabilitiesMissing.join(", ")}`,
	});

	items.push({
		id: "preflight",
		label: "preflight executáveis",
		status: input.preflightOk ? "pass" : "fail",
		detail: input.preflightOk ? "ok" : "falhou (rode /colony-pilot preflight)",
	});

	items.push({
		id: "models",
		label: "model policy",
		status: input.modelPolicyOk ? "pass" : "fail",
		detail: input.modelPolicyOk ? "ok" : "inconsistência em provider/model",
	});

	items.push({
		id: "budget-core",
		label: "budget policy (maxCost)",
		status: input.budgetPolicyOk ? "pass" : "fail",
		detail: input.budgetPolicyOk ? "ok" : "maxCost/hardcap inválido",
	});

	if (input.budgetPolicy.enforceProviderBudgetBlock) {
		const configured = input.providerBudgetsConfigured > 0;
		items.push({
			id: "budget-provider",
			label: "provider budgets",
			status: configured ? "pass" : "fail",
			detail: configured
				? `${input.providerBudgetsConfigured} provider(s) configurado(s)`
				: "gate ativo sem providerBudgets (configure em piStack.quotaVisibility)",
		});
	} else {
		items.push({
			id: "budget-provider",
			label: "provider budgets",
			status: "warn",
			detail:
				"gate provider-budget desativado (enforceProviderBudgetBlock=false)",
		});
	}

	const ready = items.every((i) => i.status !== "fail");
	return { ready, items };
}

export function formatHatchReadiness(readiness: HatchReadiness): string[] {
	const icon = (s: HatchCheckStatus) =>
		s === "pass" ? "PASS" : s === "warn" ? "WARN" : "FAIL";
	return [
		"hatch readiness:",
		...readiness.items.map(
			(i) => `  - [${icon(i.status)}] ${i.label}: ${i.detail}`,
		),
		`ready: ${readiness.ready ? "yes" : "no"}`,
	];
}

export interface HatchDoctorIssue {
	severity: "info" | "warn" | "blocker";
	source: "runtime" | "environment" | "sovereignty";
	label: string;
	detail: string;
	fix: string;
}

export interface HatchDoctorSnapshot {
	readiness: HatchReadiness;
	issues: HatchDoctorIssue[];
}

export function capabilityGuidance(
	capability: keyof PilotCapabilities,
): string {
	switch (capability) {
		case "remote":
			return "`/remote` ausente — revisar inclusão de `@ifi/pi-web-remote` na stack curada do ambiente (ou usar `/session-web` first-party).";
		case "sessionWeb":
			return "`/session-web` ausente — revisar carga da extensão first-party `web-session-gateway` no `@aretw0/pi-stack`.";
		case "colony":
		case "colonyStop":
			return "Comandos de colony ausentes — revisar inclusão de `@ifi/oh-pi-ant-colony` na stack curada do ambiente.";
		case "monitors":
			return "`/monitors` ausente — revisar inclusão de `@davidorex/pi-project-workflows` na stack curada do ambiente.";
		default:
			return "Capacidade ausente.";
	}
}

export function buildHatchDoctorSnapshot(input: {
	readiness: HatchReadiness;
	capabilitiesMissing: Array<keyof PilotCapabilities>;
	shellStatus: "ok" | "warn" | "error";
	terminalStatus: "ok" | "warn" | "error" | "unknown";
	schedulerStatus: "ok" | "warn" | "error";
	sovereigntyOwnerMissing: number;
	sovereigntyCoexisting: number;
	sovereigntyHighRisk: number;
}): HatchDoctorSnapshot {
	const issues: HatchDoctorIssue[] = [];

	for (const cap of input.capabilitiesMissing) {
		issues.push({
			severity: "blocker",
			source: "runtime",
			label: `capability missing: ${cap}`,
			detail: capabilityGuidance(cap),
			fix: "Revisar stack instalada e executar /reload após ajuste.",
		});
	}

	if (input.shellStatus !== "ok") {
		issues.push({
			severity: "warn",
			source: "environment",
			label: "shell",
			detail: "shell não está em estado ideal para automações previsíveis.",
			fix: "Padronize shell (PowerShell/Git Bash) e valide com /doctor.",
		});
	}

	if (input.terminalStatus !== "ok" && input.terminalStatus !== "unknown") {
		issues.push({
			severity: "warn",
			source: "environment",
			label: "terminal keybindings",
			detail: "terminal pode ter keybindings incompletos para o fluxo do pi.",
			fix: "Rode /doctor e aplique remappings recomendados.",
		});
	}

	if (input.schedulerStatus !== "ok") {
		issues.push({
			severity: "warn",
			source: "environment",
			label: "scheduler governance",
			detail:
				"scheduler lease/governance requer atenção antes de swarm paralelo.",
			fix: "Inspecione /scheduler-governance status e mantenha policy=observe/review.",
		});
	}

	if (input.sovereigntyHighRisk > 0 || input.sovereigntyOwnerMissing > 0) {
		issues.push({
			severity: "blocker",
			source: "sovereignty",
			label: "stack ownership",
			detail: `ownerMissing=${input.sovereigntyOwnerMissing}, highRisk=${input.sovereigntyHighRisk}`,
			fix: "Convergir ownership para a stack curada e reduzir extensões concorrentes.",
		});
	} else if (input.sovereigntyCoexisting > 0) {
		issues.push({
			severity: "warn",
			source: "sovereignty",
			label: "coexisting capabilities",
			detail: `coexisting=${input.sovereigntyCoexisting}`,
			fix: "Auditar coexistência com /stack-status e remover sobreposição não essencial.",
		});
	}

	if (input.readiness.ready && issues.length === 0) {
		issues.push({
			severity: "info",
			source: "runtime",
			label: "hatch",
			detail: "runtime pronto para operação swarm-first.",
			fix: "Rotina recomendada: /monitors off -> /colony ... -> /colony-pilot stop --restore-monitors",
		});
	}

	return { readiness: input.readiness, issues };
}

export function formatHatchDoctorSnapshot(
	snapshot: HatchDoctorSnapshot,
): string[] {
	const lines = ["hatch doctor", ...formatHatchReadiness(snapshot.readiness)];
	const blockers = snapshot.issues.filter((i) => i.severity === "blocker");
	if (blockers.length > 0) {
		lines.push("", "BLOCKER language:");
		for (const i of blockers) {
			lines.push(`  - BLOCKER (${i.source}) ${i.label}: ${i.detail}`);
			lines.push(`    fix: ${i.fix}`);
		}
	}

	const warns = snapshot.issues.filter((i) => i.severity === "warn");
	if (warns.length > 0) {
		lines.push("", "warnings:");
		for (const i of warns)
			lines.push(`  - (${i.source}) ${i.label}: ${i.detail} | fix: ${i.fix}`);
	}

	const infos = snapshot.issues.filter((i) => i.severity === "info");
	if (infos.length > 0) {
		lines.push("", "notes:");
		for (const i of infos) lines.push(`  - ${i.detail}`);
	}

	return lines;
}
