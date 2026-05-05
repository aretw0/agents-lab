export interface ColonyPilotCapabilitiesSummary {
	monitors?: boolean;
	sessionWeb?: boolean;
	remote?: boolean;
	colony?: boolean;
	colonyStop?: boolean;
}

export function formatColonyPilotHelp(): string {
	return [
		"Usage: /colony-pilot <command>",
		"",
		"Commands:",
		"  prep                          Mostrar plano recomendado do pilot",
		"  run <goal>                    Prepara sequência manual: /monitors off -> /remote -> /colony <goal> (sem maxCost no /colony)",
		"  stop [--restore-monitors]     Prepara sequência manual: /colony-stop all -> /remote stop [-> /monitors on]",
		"  monitors <on|off>             Prepara comando de profile de monitores",
		"  web <start|stop|open|status>  Controla/inspeciona sessão web",
		"  tui                           Mostra como entrar/retomar sessão no TUI",
		"  status                        Snapshot consolidado",
		"  check                         Diagnóstico de capacidades + readiness de provider/model/budget para ant_colony",
		"  hatch [check|doctor|apply] [default|phase2] [--advanced]  Onboarding progressivo (simple-first; escala avançada opt-in)",
		"  models <status|template|apply> [copilot|codex|hybrid|factory-strict|factory-strict-copilot|factory-strict-hybrid]  Política granular de modelos por classe",
		"  preflight                     Executa gates duros (capabilities + executáveis) antes da colony",
		"  baseline [show|apply] [default|phase2]  Baseline de .pi/settings.json (phase2 = mais estrito)",
		"  artifacts                     Mostra onde colony guarda states/worktrees para recovery",
		"",
		"Nota: o pi não expõe API confiável para uma extensão invocar slash commands de outra",
		"extensão no mesmo runtime. O pilot prepara e guia execução manual assistida.",
	].join("\n");
}

export function collectColonyPilotCheckModelIssues(input: {
	currentModelStatus: string;
	defaultModelStatus: string;
	policyIssues: string[];
	budgetPolicyEnabled: boolean;
	budgetIssues: string[];
}): string[] {
	const modelIssues: string[] = [];
	if (input.currentModelStatus !== "ok" && input.currentModelStatus !== "unavailable") {
		modelIssues.push("Current session model cannot run ant_colony defaults reliably.");
	}
	if (
		input.defaultModelStatus !== "ok"
		&& input.defaultModelStatus !== "not-set"
		&& input.defaultModelStatus !== "unavailable"
	) {
		modelIssues.push("defaultProvider/defaultModel appears misconfigured or unauthenticated.");
	}
	if (input.policyIssues.length > 0) modelIssues.push(...input.policyIssues);
	if (input.budgetPolicyEnabled && input.budgetIssues.length > 0) modelIssues.push(...input.budgetIssues);
	return modelIssues;
}

export function buildColonyPilotHatchLines(input: {
	mode: "simple" | "advanced";
	ready: boolean;
	readinessLines: string[];
	runbookLines: string[];
}): string[] {
	const lines = [
		"colony-pilot hatch",
		`mode: ${input.mode} ${input.mode === "simple" ? "(default simple-first, no swarm CTA)" : "(explicit opt-in for swarm/delegation)"}`,
		...input.readinessLines,
		"",
		...input.runbookLines,
	];
	if (input.mode === "simple") lines.push("", "scale opt-in: /colony-pilot hatch check --advanced");
	if (!input.ready) lines.push("", "ação sugerida: /colony-pilot hatch apply default");
	return lines;
}

export function buildColonyPilotStatusLines(input: {
	snapshot: string;
	caps: ColonyPilotCapabilitiesSummary;
	modelReadinessLines: string[];
	modelPolicyLines: string[];
	budgetPolicyLines: string[];
	deliveryPolicyLines: string[];
	projectTaskSyncConfig: {
		enabled: boolean;
		taskIdPrefix: string;
		requireHumanClose: boolean;
		autoQueueRecoveryOnCandidate: boolean;
		recoveryTaskSuffix: string;
	};
	candidateRetentionConfig: {
		enabled: boolean;
		maxEntries: number;
		maxAgeDays: number;
	};
}): string[] {
	return [
		input.snapshot,
		"",
		"capabilities:",
		`  monitors=${input.caps.monitors ? "ok" : "missing"}`,
		`  session-web=${input.caps.sessionWeb ? "ok" : "missing"}`,
		`  remote=${input.caps.remote ? "ok" : "missing"}`,
		`  colony=${input.caps.colony ? "ok" : "missing"}`,
		`  colony-stop=${input.caps.colonyStop ? "ok" : "missing"}`,
		"",
		...input.modelReadinessLines,
		"",
		...input.modelPolicyLines,
		"",
		...input.budgetPolicyLines,
		"",
		...input.deliveryPolicyLines,
		"",
		"project-task-sync:",
		`  enabled: ${input.projectTaskSyncConfig.enabled ? "yes" : "no"}`,
		`  taskIdPrefix: ${input.projectTaskSyncConfig.taskIdPrefix}`,
		`  requireHumanClose: ${input.projectTaskSyncConfig.requireHumanClose ? "yes" : "no"}`,
		`  autoQueueRecoveryOnCandidate: ${input.projectTaskSyncConfig.autoQueueRecoveryOnCandidate ? "yes" : "no"}`,
		`  recoveryTaskSuffix: ${input.projectTaskSyncConfig.recoveryTaskSuffix}`,
		"candidate-retention:",
		`  enabled: ${input.candidateRetentionConfig.enabled ? "yes" : "no"}`,
		`  maxEntries: ${input.candidateRetentionConfig.maxEntries}`,
		`  maxAgeDays: ${input.candidateRetentionConfig.maxAgeDays}`,
	];
}

export function buildColonyPilotCheckLines(input: {
	caps: ColonyPilotCapabilitiesSummary;
	missingGuidance: string[];
	modelReadinessLines: string[];
	modelPolicyLines: string[];
	budgetPolicyLines: string[];
	deliveryPolicyLines: string[];
	projectTaskSyncConfig: {
		enabled: boolean;
		createOnLaunch: boolean;
		trackProgress: boolean;
		markTerminalState: boolean;
		requireHumanClose: boolean;
		taskIdPrefix: string;
		autoQueueRecoveryOnCandidate: boolean;
		recoveryTaskSuffix: string;
	};
	candidateRetentionConfig: {
		enabled: boolean;
		maxEntries: number;
		maxAgeDays: number;
	};
	modelIssues: string[];
}): string[] {
	const lines = [
		"colony-pilot capabilities",
		`  monitors: ${input.caps.monitors ? "ok" : "missing"}`,
		`  session-web: ${input.caps.sessionWeb ? "ok" : "missing"}`,
		`  remote: ${input.caps.remote ? "ok" : "missing"}`,
		`  colony: ${input.caps.colony ? "ok" : "missing"}`,
		`  colony-stop: ${input.caps.colonyStop ? "ok" : "missing"}`,
		"",
		...input.modelReadinessLines,
		"",
		...input.modelPolicyLines,
		"",
		...input.budgetPolicyLines,
		"",
		...input.deliveryPolicyLines,
		"",
		"project-task-sync:",
		`  enabled: ${input.projectTaskSyncConfig.enabled ? "yes" : "no"}`,
		`  createOnLaunch: ${input.projectTaskSyncConfig.createOnLaunch ? "yes" : "no"}`,
		`  trackProgress: ${input.projectTaskSyncConfig.trackProgress ? "yes" : "no"}`,
		`  markTerminalState: ${input.projectTaskSyncConfig.markTerminalState ? "yes" : "no"}`,
		`  requireHumanClose: ${input.projectTaskSyncConfig.requireHumanClose ? "yes" : "no"}`,
		`  taskIdPrefix: ${input.projectTaskSyncConfig.taskIdPrefix}`,
		`  autoQueueRecoveryOnCandidate: ${input.projectTaskSyncConfig.autoQueueRecoveryOnCandidate ? "yes" : "no"}`,
		`  recoveryTaskSuffix: ${input.projectTaskSyncConfig.recoveryTaskSuffix}`,
		"candidate-retention:",
		`  enabled: ${input.candidateRetentionConfig.enabled ? "yes" : "no"}`,
		`  maxEntries: ${input.candidateRetentionConfig.maxEntries}`,
		`  maxAgeDays: ${input.candidateRetentionConfig.maxAgeDays}`,
	];

	if (input.missingGuidance.length > 0) {
		lines.push("", "Gaps detectados:", ...input.missingGuidance.map((m) => `  - ${m}`));
	}

	if (input.modelIssues.length > 0) {
		lines.push("", "Provider/model issues:", ...input.modelIssues.map((m) => `  - ${m}`));
		lines.push("  - Use /model and/or configure piStack.colonyPilot.modelPolicy/budgetPolicy.");
	}

	return lines;
}
