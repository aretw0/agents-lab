import { describe, expect, it, vi } from "vitest";
import guardrailsCore, { evaluateGrowthMaturityScorePacket } from "../../extensions/guardrails-core";

function makeMockPi() {
  const rawPi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    getAllTools: vi.fn(() => [] as unknown[]),
  };
  rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
  return rawPi as unknown as Parameters<typeof guardrailsCore>[0];
}

function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
    ([tool]) => tool?.name === name,
  );
  if (!call) throw new Error(`tool not found: ${name}`);
  return call[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: { cwd: string },
    ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
  };
}

describe("growth maturity score packet", () => {
  it("returns go recommendation when dimensions are strong and no blockers are present", () => {
    const result = evaluateGrowthMaturityScorePacket({
      safetyScore: 90,
      calibrationScore: 88,
      throughputScore: 86,
      simplicityScore: 87,
      debtBudgetOk: true,
      criticalBlockers: 0,
    });

    expect(result).toMatchObject({
      mode: "growth-maturity-score-packet",
      reviewMode: "read-only",
      activation: "none",
      authorization: "none",
      mutationAllowed: false,
      dispatchAllowed: false,
      decision: "go",
      recommendationCode: "growth-maturity-go-expand-bounded",
      score: 88,
      blockers: [],
      missingSignals: [],
    });
  });

  it("fails closed with needs-evidence when minimum signals are missing", () => {
    const result = evaluateGrowthMaturityScorePacket({
      safetyScore: 92,
      calibrationScore: 84,
      throughputScore: 80,
      debtBudgetOk: true,
    });

    expect(result.decision).toBe("needs-evidence");
    expect(result.recommendationCode).toBe("growth-maturity-needs-evidence");
    expect(result.missingSignals).toContain("missing-simplicity-score");
    expect(result.summary).toContain("decision=needs-evidence");
  });

  it("holds growth when debt budget or critical blockers are present", () => {
    const result = evaluateGrowthMaturityScorePacket({
      safetyScore: 95,
      calibrationScore: 92,
      throughputScore: 90,
      simplicityScore: 89,
      debtBudgetOk: false,
      criticalBlockers: 1,
    });

    expect(result.decision).toBe("hold");
    expect(result.recommendationCode).toBe("growth-maturity-hold-stabilize");
    expect(result.blockers).toContain("debt-budget-exceeded");
    expect(result.blockers).toContain("critical-blockers-present");
  });

  it("exposes growth_maturity_score_packet as read-only no-dispatch surface", async () => {
    const pi = makeMockPi();
    guardrailsCore(pi);
    const tool = getTool(pi, "growth_maturity_score_packet");

    const ready = await tool.execute(
      "tc-growth-maturity-ready",
      {
        safety_score: 90,
        calibration_score: 89,
        throughput_score: 86,
        simplicity_score: 88,
        debt_budget_ok: true,
        critical_blockers: 0,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(ready.details?.decision).toBe("go");
    expect(ready.details?.dispatchAllowed).toBe(false);
    expect(ready.details?.mutationAllowed).toBe(false);
    expect(ready.details?.authorization).toBe("none");
    expect(ready.content?.[0]?.text).toContain("growth-maturity-score: decision=go code=growth-maturity-go-expand-bounded score=88");
    expect(ready.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(ready.content?.[0]?.text).not.toContain('\"decision\"');

    const missing = await tool.execute(
      "tc-growth-maturity-missing",
      {
        safety_score: 90,
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(missing.details?.decision).toBe("needs-evidence");
    expect(missing.details?.recommendationCode).toBe("growth-maturity-needs-evidence");
  });
});
