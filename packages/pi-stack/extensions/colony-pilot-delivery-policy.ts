export type ColonyDeliveryMode =
	| "report-only"
	| "patch-artifact"
	| "apply-to-branch";

export interface ColonyPilotDeliveryPolicyConfig {
	enabled: boolean;
	mode: ColonyDeliveryMode;
	requireWorkspaceReport: boolean;
	requireTaskSummary: boolean;
	requireFileInventory: boolean;
	requireValidationCommandLog: boolean;
	blockOnMissingEvidence: boolean;
}

export interface SelectivePromotionInventoryEvidence {
	hasPromotedFileInventory: boolean;
	hasSkippedFileInventory: boolean;
	hasSelectivePromotionInventory: boolean;
}

export interface ColonyPilotDeliveryEvidence
	extends SelectivePromotionInventoryEvidence {
	hasWorkspaceReport: boolean;
	hasTaskSummary: boolean;
	hasFileInventory: boolean;
	hasValidationCommandLog: boolean;
}

export interface ColonyPilotDeliveryEvaluation {
	ok: boolean;
	issues: string[];
	evidence: ColonyPilotDeliveryEvidence;
}

export const DEFAULT_COLONY_PILOT_DELIVERY_POLICY: ColonyPilotDeliveryPolicyConfig = {
	enabled: false,
	mode: "report-only",
	requireWorkspaceReport: true,
	requireTaskSummary: true,
	requireFileInventory: false,
	requireValidationCommandLog: false,
	blockOnMissingEvidence: true,
};

export function parseDeliveryModeOverride(
	input: unknown,
): ColonyDeliveryMode | undefined {
	if (!input || typeof input !== "object") return undefined;
	const raw = (input as Record<string, unknown>)["deliveryMode"];
	if (
		raw === "report-only" ||
		raw === "patch-artifact" ||
		raw === "apply-to-branch"
	) {
		return raw as ColonyDeliveryMode;
	}
	return undefined;
}

export function resolveColonyPilotDeliveryPolicy(
	raw?: Partial<ColonyPilotDeliveryPolicyConfig>,
): ColonyPilotDeliveryPolicyConfig {
	const modeRaw = typeof raw?.mode === "string" ? raw.mode.trim() : "";
	const mode: ColonyDeliveryMode =
		modeRaw === "patch-artifact" ||
		modeRaw === "apply-to-branch" ||
		modeRaw === "report-only"
			? modeRaw
			: DEFAULT_COLONY_PILOT_DELIVERY_POLICY.mode;

	return {
		enabled: raw?.enabled === true,
		mode,
		requireWorkspaceReport: raw?.requireWorkspaceReport !== false,
		requireTaskSummary: raw?.requireTaskSummary !== false,
		requireFileInventory: raw?.requireFileInventory === true,
		requireValidationCommandLog: raw?.requireValidationCommandLog === true,
		blockOnMissingEvidence: raw?.blockOnMissingEvidence !== false,
	};
}

export function evaluateSelectivePromotionInventoryEvidence(
	text: string,
): SelectivePromotionInventoryEvidence {
	const hasPromotedFileInventory =
		/(?:promoted\s+file\s+inventory|files?\s+promoted|arquivos?\s+promovid|invent[aá]rio\s+de\s+promov)/i.test(
			text,
		);
	const hasSkippedFileInventory =
		/(?:skipped\s+file\s+inventory|files?\s+skipped|arquivos?\s+(?:ignorad|pulad|n[aã]o\s+promovid)|invent[aá]rio\s+de\s+skip)/i.test(
			text,
		);
	return {
		hasPromotedFileInventory,
		hasSkippedFileInventory,
		hasSelectivePromotionInventory:
			hasPromotedFileInventory && hasSkippedFileInventory,
	};
}

export function evaluateColonyDeliveryEvidence(
	text: string,
	phase: string,
	policy: ColonyPilotDeliveryPolicyConfig,
): ColonyPilotDeliveryEvaluation {
	const validationHeadingTextPattern =
		"(?:validation\\s+command\\s+log|validation\\s+commands?|comandos?\\s+de\\s+valida[cç][aã]o)";
	const commandLikePattern =
		/(?:pnpm|npm|npx|vitest|node(?:\.exe)?\s+--test|\S*node(?:\.exe)?\s+\S+|tsc|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle(?:w)?\s+test|bun\s+test)\b/i;
	const validationHeadingLinePattern = new RegExp(
		`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${validationHeadingTextPattern}\\s*(?::|-)?\\s*(?:\\n|$)`,
		"i",
	);
	const hasValidationHeading = validationHeadingLinePattern.test(text);
	const hasValidationInlineCommand =
		new RegExp(
			`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${validationHeadingTextPattern}\\s*[:\\-]\\s*` +
				"`" +
				`${commandLikePattern.source}[^` + "`" + `]*` +
				"`",
			"im",
		).test(text);
	const hasValidationSectionBacktickedCommand =
		new RegExp(
			`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${validationHeadingTextPattern}\\s*(?::|-)?\\s*\\n[\\s\\S]{0,400}?` +
				"`" +
				`${commandLikePattern.source}[^` + "`" + `]*` +
				"`",
			"i",
		).test(text);
	const hasValidationSectionFencedCommand =
		new RegExp(
			`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${validationHeadingTextPattern}\\s*(?::|-)?\\s*\\n[\\s\\S]{0,500}?` +
				"```" +
				`[\\s\\S]{0,500}?${commandLikePattern.source}[\\s\\S]{0,500}?` +
				"```",
			"i",
		).test(text);

	const selectivePromotionEvidence =
		evaluateSelectivePromotionInventoryEvidence(text);
	const evidence: ColonyPilotDeliveryEvidence = {
		hasWorkspaceReport:
			/###\s+🧪\s+Workspace|Mode:\s+(?:isolated|shared)/i.test(text),
		hasTaskSummary: /\*\*Tasks:\*\*\s*\d+\/\d+|tasks\s+done/i.test(text),
		hasFileInventory:
			/(?:files?\s+(?:changed|altered|touched)|arquivos?\s+alterad|invent[aá]rio\s+final)/i.test(
				text,
			),
		hasValidationCommandLog:
			hasValidationInlineCommand ||
			(hasValidationHeading &&
				(hasValidationSectionBacktickedCommand ||
					hasValidationSectionFencedCommand)),
		...selectivePromotionEvidence,
	};

	if (!policy.enabled || phase !== "completed") {
		return { ok: true, issues: [], evidence };
	}

	const issues: string[] = [];
	if (policy.requireWorkspaceReport && !evidence.hasWorkspaceReport) {
		issues.push("delivery evidence missing: workspace report");
	}
	if (policy.requireTaskSummary && !evidence.hasTaskSummary) {
		issues.push("delivery evidence missing: task summary");
	}
	if (policy.requireFileInventory && !evidence.hasFileInventory) {
		issues.push("delivery evidence missing: file inventory");
	}
	if (policy.requireValidationCommandLog && !evidence.hasValidationCommandLog) {
		issues.push(
			"delivery evidence missing: validation command log (expected section 'Validation command log' with command lines in backticks)",
		);
	}
	if (policy.mode === "apply-to-branch" && !evidence.hasSelectivePromotionInventory) {
		issues.push(
			"delivery evidence missing: selective promotion inventory (expected sections 'Promoted file inventory' and 'Skipped file inventory')",
		);
	}

	return { ok: issues.length === 0, issues, evidence };
}

export function formatDeliveryPolicyEvaluation(
	policy: ColonyPilotDeliveryPolicyConfig,
	evalResult: ColonyPilotDeliveryEvaluation,
): string[] {
	return [
		"delivery policy:",
		`  enabled: ${policy.enabled ? "yes" : "no"}`,
		`  mode: ${policy.mode}`,
		`  requireWorkspaceReport: ${policy.requireWorkspaceReport ? "yes" : "no"}`,
		`  requireTaskSummary: ${policy.requireTaskSummary ? "yes" : "no"}`,
		`  requireFileInventory: ${policy.requireFileInventory ? "yes" : "no"}`,
		`  requireValidationCommandLog: ${policy.requireValidationCommandLog ? "yes" : "no"}`,
		`  blockOnMissingEvidence: ${policy.blockOnMissingEvidence ? "yes" : "no"}`,
		`  evaluation: ${evalResult.ok ? "ok" : "issues"}`,
	];
}
