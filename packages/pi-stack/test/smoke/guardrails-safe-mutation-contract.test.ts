import { describe, expect, it } from "vitest";
import {
	assessLargeFileMutationRisk,
	assessStructuredQueryRisk,
} from "../../extensions/guardrails-core-safe-mutation";

describe("guardrails-core safe mutation contract", () => {
	it("blocks ambiguous or missing anchors deterministically", () => {
		expect(assessLargeFileMutationRisk({
			touchedLines: 10,
			maxTouchedLines: 120,
			anchorState: "missing",
			applyRequested: true,
		})).toMatchObject({
			decision: "block",
			reason: "blocked:anchor-missing",
			riskLevel: "high",
		});

		expect(assessLargeFileMutationRisk({
			touchedLines: 10,
			maxTouchedLines: 120,
			anchorState: "ambiguous",
			applyRequested: true,
		})).toMatchObject({
			decision: "block",
			reason: "blocked:anchor-ambiguous",
			riskLevel: "high",
		});
	});

	it("enforces blast-radius caps before apply", () => {
		expect(assessLargeFileMutationRisk({
			touchedLines: 121,
			maxTouchedLines: 120,
			anchorState: "unique",
			applyRequested: true,
		})).toMatchObject({
			decision: "block",
			reason: "blocked:blast-radius-exceeded",
			riskLevel: "high",
		});
	});

	it("requires confirmation for medium-risk apply", () => {
		const medium = assessLargeFileMutationRisk({
			touchedLines: 80,
			maxTouchedLines: 120,
			anchorState: "unique",
			applyRequested: true,
		});
		expect(medium).toMatchObject({
			riskLevel: "medium",
			decision: "require-confirmation",
			reason: "confirm-required-medium-risk",
		});

		expect(assessLargeFileMutationRisk({
			touchedLines: 80,
			maxTouchedLines: 120,
			anchorState: "unique",
			applyRequested: true,
			confirmed: true,
		})).toMatchObject({
			riskLevel: "medium",
			decision: "allow-apply",
			reason: "ok-apply-confirmed-medium-risk",
		});
	});

	it("keeps dry-run preview as default safe pathway", () => {
		expect(assessLargeFileMutationRisk({
			touchedLines: 30,
			maxTouchedLines: 120,
			anchorState: "unique",
			applyRequested: false,
		})).toMatchObject({
			decision: "allow-preview",
			riskLevel: "low",
			reason: "ok-preview",
		});
	});

	it("blocks mutation queries when forbidMutation is true", () => {
		const blocked = assessStructuredQueryRisk({
			normalizedQuery: "UPDATE tasks SET status='done' WHERE id=1",
			forbidMutation: true,
		});
		expect(blocked).toMatchObject({
			blocked: true,
			riskLevel: "high",
			reason: "blocked:mutation-forbidden",
		});
		expect(blocked.safetyChecks).toContain("mutation-detected");
	});

	it("classifies select with limit as low risk", () => {
		const low = assessStructuredQueryRisk({
			normalizedQuery: "SELECT id FROM tasks WHERE status = $1 LIMIT $2",
			forbidMutation: true,
		});
		expect(low).toMatchObject({
			blocked: false,
			riskLevel: "low",
			reason: "ok",
		});
		expect(low.safetyChecks).toContain("limit-present");
	});
});
