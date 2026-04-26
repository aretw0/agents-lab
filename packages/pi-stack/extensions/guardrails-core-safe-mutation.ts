export type SafeMutationRiskLevel = "low" | "medium" | "high";

export type SafeMutationAnchorState = "unique" | "missing" | "ambiguous";

export type SafeMutationDecision =
	| "allow-preview"
	| "allow-apply"
	| "require-confirmation"
	| "block";

export type SafeLargeFileMutationInput = {
	touchedLines: number;
	maxTouchedLines: number;
	anchorState: SafeMutationAnchorState;
	applyRequested?: boolean;
	confirmed?: boolean;
};

export type SafeLargeFileMutationAssessment = {
	riskLevel: SafeMutationRiskLevel;
	decision: SafeMutationDecision;
	reason:
		| "ok-preview"
		| "ok-apply-low-risk"
		| "ok-apply-confirmed-medium-risk"
		| "confirm-required-medium-risk"
		| "blocked:blast-radius-exceeded"
		| "blocked:anchor-missing"
		| "blocked:anchor-ambiguous";
	touchedLines: number;
	maxTouchedLines: number;
};

function normalizeTouchedLines(input: unknown): number {
	const raw = Number(input);
	if (!Number.isFinite(raw)) return 0;
	return Math.max(0, Math.floor(raw));
}

function normalizeMaxTouchedLines(input: unknown): number {
	const raw = Number(input);
	if (!Number.isFinite(raw)) return 1;
	return Math.max(1, Math.floor(raw));
}

export function assessLargeFileMutationRisk(
	input: SafeLargeFileMutationInput,
): SafeLargeFileMutationAssessment {
	const touchedLines = normalizeTouchedLines(input.touchedLines);
	const maxTouchedLines = normalizeMaxTouchedLines(input.maxTouchedLines);
	const applyRequested = input.applyRequested === true;
	const confirmed = input.confirmed === true;

	if (input.anchorState === "missing") {
		return {
			riskLevel: "high",
			decision: "block",
			reason: "blocked:anchor-missing",
			touchedLines,
			maxTouchedLines,
		};
	}
	if (input.anchorState === "ambiguous") {
		return {
			riskLevel: "high",
			decision: "block",
			reason: "blocked:anchor-ambiguous",
			touchedLines,
			maxTouchedLines,
		};
	}
	if (touchedLines > maxTouchedLines) {
		return {
			riskLevel: "high",
			decision: "block",
			reason: "blocked:blast-radius-exceeded",
			touchedLines,
			maxTouchedLines,
		};
	}

	const riskLevel: SafeMutationRiskLevel = touchedLines <= 40
		? "low"
		: touchedLines <= 120
			? "medium"
			: "high";

	if (!applyRequested) {
		return {
			riskLevel,
			decision: "allow-preview",
			reason: "ok-preview",
			touchedLines,
			maxTouchedLines,
		};
	}

	if (riskLevel === "low") {
		return {
			riskLevel,
			decision: "allow-apply",
			reason: "ok-apply-low-risk",
			touchedLines,
			maxTouchedLines,
		};
	}

	if (riskLevel === "medium" && confirmed) {
		return {
			riskLevel,
			decision: "allow-apply",
			reason: "ok-apply-confirmed-medium-risk",
			touchedLines,
			maxTouchedLines,
		};
	}

	return {
		riskLevel,
		decision: riskLevel === "medium" ? "require-confirmation" : "block",
		reason: riskLevel === "medium"
			? "confirm-required-medium-risk"
			: "blocked:blast-radius-exceeded",
		touchedLines,
		maxTouchedLines,
	};
}

export type SafeLargeFileMutationResult = {
	applied: boolean;
	changed: boolean;
	riskLevel: SafeMutationRiskLevel;
	decision: SafeMutationDecision;
	reason: SafeLargeFileMutationAssessment["reason"];
	touchedLines: number;
	maxTouchedLines: number;
	preview: string;
	rollbackToken: string | null;
	dryRun: boolean;
};

export function buildSafeLargeFileMutationResult(input: {
	assessment: SafeLargeFileMutationAssessment;
	dryRun?: boolean;
	changed?: boolean;
	preview?: string;
	rollbackToken?: string | null;
}): SafeLargeFileMutationResult {
	const dryRun = input.dryRun !== false;
	const assessment = input.assessment;
	const applyAllowed = assessment.decision === "allow-apply";
	const applied = !dryRun && applyAllowed;
	return {
		applied,
		changed: applied ? input.changed === true : false,
		riskLevel: assessment.riskLevel,
		decision: assessment.decision,
		reason: assessment.reason,
		touchedLines: assessment.touchedLines,
		maxTouchedLines: assessment.maxTouchedLines,
		preview: String(input.preview ?? ""),
		rollbackToken: applied ? (input.rollbackToken ?? null) : null,
		dryRun,
	};
}

export type StructuredQueryAssessmentInput = {
	normalizedQuery: string;
	forbidMutation?: boolean;
};

export type StructuredQueryAssessment = {
	riskLevel: SafeMutationRiskLevel;
	blocked: boolean;
	reason: "ok" | "blocked:mutation-forbidden" | "blocked:multi-statement";
	safetyChecks: string[];
};

export type StructuredQueryPlanResult = {
	normalizedQuery: string;
	parameters: unknown[];
	riskLevel: SafeMutationRiskLevel;
	blocked: boolean;
	reason: StructuredQueryAssessment["reason"];
	safetyChecks: string[];
};

export function buildStructuredQueryPlanResult(input: {
	normalizedQuery: string;
	parameters?: unknown[];
	assessment: StructuredQueryAssessment;
}): StructuredQueryPlanResult {
	return {
		normalizedQuery: String(input.normalizedQuery ?? "").trim(),
		parameters: Array.isArray(input.parameters) ? input.parameters : [],
		riskLevel: input.assessment.riskLevel,
		blocked: input.assessment.blocked,
		reason: input.assessment.reason,
		safetyChecks: [...input.assessment.safetyChecks],
	};
}

function detectQueryKind(query: string): "select" | "mutation" | "other" {
	const q = query.trim().toLowerCase();
	if (q.startsWith("select") || q.startsWith("with")) return "select";
	if (/^(insert|update|delete|merge|create|alter|drop|truncate)\b/.test(q)) return "mutation";
	return "other";
}

function hasMultipleStatements(query: string): boolean {
	const text = String(query ?? "").trim();
	if (!text) return false;

	let inSingle = false;
	let inDouble = false;
	let inBacktick = false;
	let sawTerminator = false;

	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		const prev = i > 0 ? text[i - 1] : "";

		if (!inDouble && !inBacktick && ch === "'" && prev !== "\\") {
			if (inSingle && text[i + 1] === "'") {
				i += 1;
				continue;
			}
			inSingle = !inSingle;
			continue;
		}
		if (!inSingle && !inBacktick && ch === '"' && prev !== "\\") {
			inDouble = !inDouble;
			continue;
		}
		if (!inSingle && !inDouble && ch === "`") {
			inBacktick = !inBacktick;
			continue;
		}

		if (inSingle || inDouble || inBacktick) continue;

		if (ch === ";") {
			sawTerminator = true;
			continue;
		}

		if (sawTerminator && /\S/.test(ch)) {
			return true;
		}
	}

	return false;
}

export function assessStructuredQueryRisk(
	input: StructuredQueryAssessmentInput,
): StructuredQueryAssessment {
	const normalizedQuery = String(input.normalizedQuery ?? "").trim();
	const forbidMutation = input.forbidMutation !== false;
	const kind = detectQueryKind(normalizedQuery);
	const checks: string[] = [];

	if (hasMultipleStatements(normalizedQuery)) {
		checks.push("multi-statement-detected");
		return {
			riskLevel: "high",
			blocked: true,
			reason: "blocked:multi-statement",
			safetyChecks: checks,
		};
	}

	if (kind === "mutation" && forbidMutation) {
		checks.push("mutation-detected");
		checks.push("forbid-mutation-true");
		return {
			riskLevel: "high",
			blocked: true,
			reason: "blocked:mutation-forbidden",
			safetyChecks: checks,
		};
	}

	if (kind === "select") {
		if (/\blimit\b/i.test(normalizedQuery)) {
			checks.push("limit-present");
			checks.push("mutation-forbidden-ok");
			return {
				riskLevel: "low",
				blocked: false,
				reason: "ok",
				safetyChecks: checks,
			};
		}
		checks.push("limit-missing");
		checks.push("mutation-forbidden-ok");
		return {
			riskLevel: "medium",
			blocked: false,
			reason: "ok",
			safetyChecks: checks,
		};
	}

	checks.push("query-kind-other");
	if (forbidMutation) checks.push("mutation-forbidden-ok");
	return {
		riskLevel: "medium",
		blocked: false,
		reason: "ok",
		safetyChecks: checks,
	};
}
