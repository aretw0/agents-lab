import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const CORE_PATH = path.resolve(__dirname, "../../extensions/guardrails-core.ts");
// Staged ratchet: tighten gradually as surfaces are extracted.
const MAX_ORCHESTRATOR_LINES = 1250;

describe("guardrails-core orchestrator budget", () => {
	it("stays under orchestrator line budget", () => {
		const source = readFileSync(CORE_PATH, "utf8");
		const lineCount = source.split(/\r?\n/).length;
		expect(
			lineCount,
			`guardrails-core.ts reinflated to ${lineCount} lines (budget=${MAX_ORCHESTRATOR_LINES}). Extract new command/tool surfaces into guardrails-core-* modules.`,
		).toBeLessThanOrEqual(MAX_ORCHESTRATOR_LINES);
	});

	it("keeps extracted surface registrars wired in orchestrator", () => {
		const source = readFileSync(CORE_PATH, "utf8");
		const toolCallGuardPath = path.resolve(__dirname, "../../extensions/guardrails-core-tool-call-guard.ts");
		const surfaceRegistrationPath = path.resolve(__dirname, "../../extensions/guardrails-core-surface-registration.ts");
		const toolCallGuardSource = readFileSync(toolCallGuardPath, "utf8");
		const surfaceRegistrationSource = readFileSync(surfaceRegistrationPath, "utf8");
		expect(source).toContain("registerGuardrailsCoreEventSurface(pi, eventSurfaceRuntime)");
		expect(source).toContain("registerGuardrailsCoreToolCallGuard(pi");
		expect(source).toContain("registerGuardrailsCoreSurfaces({");
		expect(surfaceRegistrationSource).toContain("registerGuardrailsDeliverySurface(pi, appendAuditEntry)");
		expect(surfaceRegistrationSource).toContain("registerGuardrailsSafeMutationSurface(pi, appendAuditEntry)");
		expect(toolCallGuardSource).toContain("evaluateBashGuardPolicies(command)");
		expect(toolCallGuardSource).toContain("./guardrails-core-bash-guard-policies");
		expect(source).not.toContain("SESSION_LOG_PATH_PATTERN");
		expect(source).not.toContain("PI_ROOT_RECURSIVE_SCAN_TOOL_PATTERN");
	});
});
