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

export function assessLargeFileMutationRisk(
	input: SafeLargeFileMutationInput,
): SafeLargeFileMutationAssessment {
	const touchedLines = Math.max(0, Math.floor(Number(input.touchedLines ?? 0)));
	const maxTouchedLines = Math.max(1, Math.floor(Number(input.maxTouchedLines ?? 1)));
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

export type StructuredQueryAssessmentInput = {
	normalizedQuery: string;
	forbidMutation?: boolean;
};

export type StructuredQueryAssessment = {
	riskLevel: SafeMutationRiskLevel;
	blocked: boolean;
	reason: "ok" | "blocked:mutation-forbidden";
	safetyChecks: string[];
};

function detectQueryKind(query: string): "select" | "mutation" | "other" {
	const q = query.trim().toLowerCase();
	if (q.startsWith("select") || q.startsWith("with")) return "select";
	if (/^(insert|update|delete|merge|create|alter|drop|truncate)\b/.test(q)) return "mutation";
	return "other";
}

export function assessStructuredQueryRisk(
	input: StructuredQueryAssessmentInput,
): StructuredQueryAssessment {
	const normalizedQuery = String(input.normalizedQuery ?? "").trim();
	const forbidMutation = input.forbidMutation !== false;
	const kind = detectQueryKind(normalizedQuery);
	const checks: string[] = [];

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
