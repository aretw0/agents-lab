import { describe, expect, it } from "vitest";
import {
	assessLargeFileMutationRisk,
	buildSafeLargeFileMutationResult,
	assessStructuredQueryRisk,
	buildStructuredQueryPlanResult,
} from "../../extensions/guardrails-core";

describe("guardrails-core safe-mutation re-export", () => {
	it("exposes safe-mutation helpers through guardrails-core surface", () => {
		const assessment = assessLargeFileMutationRisk({
			touchedLines: 20,
			maxTouchedLines: 120,
			anchorState: "unique",
			applyRequested: true,
		});
		expect(assessment.decision).toBe("allow-apply");

		const result = buildSafeLargeFileMutationResult({
			assessment,
			dryRun: false,
			changed: true,
			rollbackToken: "rb-1",
		});
		expect(result.applied).toBe(true);
		expect(result.rollbackToken).toBe("rb-1");

		const queryAssessment = assessStructuredQueryRisk({
			normalizedQuery: "SELECT id FROM tasks LIMIT 10",
			forbidMutation: true,
		});
		expect(queryAssessment.blocked).toBe(false);

		const queryResult = buildStructuredQueryPlanResult({
			normalizedQuery: "SELECT id FROM tasks LIMIT 10",
			parameters: [],
			assessment: queryAssessment,
		});
		expect(queryResult.riskLevel).toBe("low");
	});
});
