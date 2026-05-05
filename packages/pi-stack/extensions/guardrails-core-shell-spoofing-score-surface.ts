import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { BASH_GUARD_POLICIES, evaluateBashGuardPolicies } from "./guardrails-core-bash-guard-policies";
import { buildShellSpoofingCoverageScore } from "./guardrails-core-shell-spoofing-score";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function hasTool(pi: ExtensionAPI, name: string): boolean {
  return pi.getAllTools().some((tool) => tool?.name === name);
}

function hasFile(cwd: string, relPath: string): boolean {
  return existsSync(path.join(cwd, relPath));
}

function hasDoctrineSpoofingMarkers(cwd: string): boolean {
  const doctrinePath = path.join(cwd, "docs", "guides", "control-plane-operating-doctrine.md");
  if (!existsSync(doctrinePath)) return false;
  try {
    const text = readFileSync(doctrinePath, "utf8").toLowerCase();
    return text.includes("cache=...; echo $cache")
      && text.includes("interpolar $var")
      && text.includes("safe_marker_check");
  } catch {
    return false;
  }
}

function sampleCommandSensitiveShellInlineCommand(): string {
  return "node -e \"const markers=['`danger`']; console.log(markers.includes('x'));\"";
}

export function registerGuardrailsShellSpoofingScoreSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "shell_spoofing_coverage_score",
    label: "Shell Spoofing Coverage Score",
    description: "Report-only anti-spoofing coverage score for shell variable interpolation risk (policy/runtime/regression/observability).",
    parameters: Type.Object({}),
    execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const commandSensitivePolicy = BASH_GUARD_POLICIES.find((policy) => policy.id === "command-sensitive-shell-marker-check");
      const policyTrigger = evaluateBashGuardPolicies(sampleCommandSensitiveShellInlineCommand());

      const result = buildShellSpoofingCoverageScore({
        hasCommandSensitivePolicyRule: Boolean(commandSensitivePolicy),
        hasDoctrineSpoofingRule: hasDoctrineSpoofingMarkers(cwd),
        hasPolicyTriggerForSample: policyTrigger?.id === "command-sensitive-shell-marker-check",
        hasSafeMarkerCheckTool: hasTool(pi, "safe_marker_check"),
        hasValidationMethodPlanTool: hasTool(pi, "validation_method_plan"),
        hasBashGuardPolicyTest: hasFile(cwd, "packages/pi-stack/test/smoke/guardrails-bash-guard-policies.test.ts"),
        hasValidationMethodTest: hasFile(cwd, "packages/pi-stack/test/smoke/guardrails-validation-method.test.ts"),
        hasMarkerCheckTest: hasFile(cwd, "packages/pi-stack/test/smoke/guardrails-marker-check.test.ts"),
        hasToolHygieneScorecardTool: hasTool(pi, "tool_hygiene_scorecard"),
        hasPolicyAuditKey: Boolean(commandSensitivePolicy?.auditKey),
        hasValidationMethodSurfaceTest: hasFile(cwd, "packages/pi-stack/test/smoke/guardrails-validation-method-surface.test.ts"),
      });

      return buildOperatorVisibleToolResponse({
        label: "shell_spoofing_coverage_score",
        summary: result.summary,
        details: result,
      });
    },
  });
}
