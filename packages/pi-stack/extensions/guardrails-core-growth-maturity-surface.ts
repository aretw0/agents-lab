import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { evaluateGrowthMaturityScorePacket } from "./guardrails-core-growth-maturity";

export function registerGuardrailsGrowthMaturitySurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "growth_maturity_score_packet",
    label: "Growth Maturity Score Packet",
    description: "Report-only scorecard packet for growth maturity (safety/calibration/throughput/simplicity) with deterministic go/hold guidance. Never dispatches execution.",
    parameters: Type.Object({
      safety_score: Type.Optional(Type.Number({ description: "Safety maturity score (0..100)." })),
      calibration_score: Type.Optional(Type.Number({ description: "Calibration maturity score (0..100)." })),
      throughput_score: Type.Optional(Type.Number({ description: "Throughput maturity score (0..100)." })),
      simplicity_score: Type.Optional(Type.Number({ description: "Simplicity maturity score (0..100)." })),
      go_threshold: Type.Optional(Type.Number({ description: "Expansion threshold (default 85)." })),
      hold_threshold: Type.Optional(Type.Number({ description: "Hold threshold (default 70)." })),
      debt_budget_ok: Type.Optional(Type.Boolean({ description: "Whether debt budget remains within policy." })),
      critical_blockers: Type.Optional(Type.Number({ description: "Count of critical blockers currently open." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = evaluateGrowthMaturityScorePacket({
        safetyScore: typeof p.safety_score === "number" ? p.safety_score : undefined,
        calibrationScore: typeof p.calibration_score === "number" ? p.calibration_score : undefined,
        throughputScore: typeof p.throughput_score === "number" ? p.throughput_score : undefined,
        simplicityScore: typeof p.simplicity_score === "number" ? p.simplicity_score : undefined,
        goThreshold: typeof p.go_threshold === "number" ? p.go_threshold : undefined,
        holdThreshold: typeof p.hold_threshold === "number" ? p.hold_threshold : undefined,
        debtBudgetOk: typeof p.debt_budget_ok === "boolean" ? p.debt_budget_ok : undefined,
        criticalBlockers: typeof p.critical_blockers === "number" ? p.critical_blockers : undefined,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
