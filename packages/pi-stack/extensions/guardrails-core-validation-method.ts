export type ValidationMethodKind = "marker-check" | "focal-test" | "structured-read" | "unknown";
export type ValidationMethodDecision = "use-safe-marker-check" | "run-focal-test" | "use-structured-read" | "ask-decision" | "blocked";

export interface ValidationMethodInput {
  kind: ValidationMethodKind;
  safeMarkerToolAvailable?: boolean;
  shellInlineRequested?: boolean;
  commandSensitiveMarkers?: boolean;
  touchesProtectedScope?: boolean;
  needsMutation?: boolean;
  focalGateKnown?: boolean;
}

export interface ValidationMethodPlan {
  decision: ValidationMethodDecision;
  canValidate: boolean;
  reasons: string[];
  summary: string;
  recommendation: string;
}

function normalizeKind(value: unknown): ValidationMethodKind {
  return value === "marker-check" || value === "focal-test" || value === "structured-read" || value === "unknown" ? value : "unknown";
}

export function resolveValidationMethodPlan(input: ValidationMethodInput): ValidationMethodPlan {
  const kind = normalizeKind(input.kind);
  const reasons: string[] = [];

  if (input.touchesProtectedScope === true) reasons.push("protected-scope");
  if (input.needsMutation === true) reasons.push("validation-needs-mutation");
  if (reasons.length > 0) {
    return {
      decision: "blocked",
      canValidate: false,
      reasons,
      summary: `validation-method: decision=blocked canValidate=no kind=${kind} reasons=${reasons.join(",")}`,
      recommendation: "Do not validate through this path without explicit operator intent.",
    };
  }

  if (kind === "marker-check") {
    if (input.shellInlineRequested === true) reasons.push("legacy-shell-inline-requested");
    if (input.commandSensitiveMarkers === true) reasons.push("command-sensitive-markers");
    if (input.safeMarkerToolAvailable !== false) {
      if (reasons.length === 0) reasons.push("marker-check");
      return {
        decision: "use-safe-marker-check",
        canValidate: true,
        reasons,
        summary: `validation-method: decision=use-safe-marker-check canValidate=yes kind=marker-check reasons=${reasons.join(",")}`,
        recommendation: "Use safe_marker_check or evaluateTextMarkerCheck instead of shell-inline marker validation.",
      };
    }
    return {
      decision: "blocked",
      canValidate: false,
      reasons: reasons.length > 0 ? reasons : ["safe-marker-tool-missing"],
      summary: `validation-method: decision=blocked canValidate=no kind=marker-check reasons=${(reasons.length > 0 ? reasons : ["safe-marker-tool-missing"]).join(",")}`,
      recommendation: "Do not fall back to shell-inline marker checks when the safe marker primitive is unavailable.",
    };
  }

  if (kind === "focal-test") {
    if (input.focalGateKnown !== true) {
      return {
        decision: "ask-decision",
        canValidate: false,
        reasons: ["focal-gate-unknown"],
        summary: "validation-method: decision=ask-decision canValidate=no kind=focal-test reasons=focal-gate-unknown",
        recommendation: "Ask for or derive a bounded focal gate before validating.",
      };
    }
    return {
      decision: "run-focal-test",
      canValidate: true,
      reasons: ["focal-gate-known"],
      summary: "validation-method: decision=run-focal-test canValidate=yes kind=focal-test reasons=focal-gate-known",
      recommendation: "Run the bounded focal test and record compact evidence.",
    };
  }

  if (kind === "structured-read") {
    return {
      decision: "use-structured-read",
      canValidate: true,
      reasons: ["read-only-structured-validation"],
      summary: "validation-method: decision=use-structured-read canValidate=yes kind=structured-read reasons=read-only-structured-validation",
      recommendation: "Use structured_io/read-only inspection and record compact evidence.",
    };
  }

  return {
    decision: "ask-decision",
    canValidate: false,
    reasons: ["unknown-validation-kind"],
    summary: "validation-method: decision=ask-decision canValidate=no kind=unknown reasons=unknown-validation-kind",
    recommendation: "Choose a known validation method before continuing.",
  };
}
