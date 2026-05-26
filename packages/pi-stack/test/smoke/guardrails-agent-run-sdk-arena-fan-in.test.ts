import { describe, expect, it, vi } from "vitest";
import guardrailsAgentRun from "../../extensions/guardrails-agent-run";
import { buildAgentRunSdkProviderModelArenaFanInPacket, buildAgentRunSdkProviderModelArenaPacket } from "../../extensions/guardrails-core-exports";

type RegisteredTool = {
  name: string;
  parameters?: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
};

const PRIMARY_PROVIDER_MODEL_REF = "provider-a/model-alpha";
const SECONDARY_PROVIDER_MODEL_REF = "provider-b/model-beta";

function arenaPacket() {
  return buildAgentRunSdkProviderModelArenaPacket({
    arenaId: "arena-fan-in-smoke",
    providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
    envelopes: ["readonly-one-file", "mutation-one-file-marker"],
    maxCalls: 2,
    timeoutMs: 90_000,
    maxEstimatedCostUsd: 0.25,
    budgetDecision: "ok",
    budgetEvidence: "manual fan-in smoke budget evidence",
  });
}

function terminalScorecard(packet = arenaPacket()) {
  return {
    ...packet.scorecardTemplate,
    rows: packet.scorecardTemplate.rows.map((row, index) => ({
      ...row,
      processState: "completed",
      contractDecision: "pass",
      outputBytes: 120 + index,
      touchedFiles: index === 0 ? [] : packet.suiteManifest.envelopes[index]?.declaredFiles.slice(0, 1) ?? [],
      latencyMs: 1000 + index,
      errorClass: "none",
      estimatedCostUsd: 0.01,
    })),
  };
}

describe("agent run SDK arena fan-in", () => {
  it("passes only after terminal rows match the manifest and file contracts", () => {
    const packet = arenaPacket();
    const result = buildAgentRunSdkProviderModelArenaFanInPacket({
      suiteManifest: packet.suiteManifest,
      scorecard: terminalScorecard(packet),
      fanInPlan: packet.fanInPlan,
    });

    expect(result).toMatchObject({
      mode: "agent-run-sdk-provider-model-arena-fan-in-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      processStartAllowed: false,
      paidModelCallsAllowed: false,
      writeAllowed: false,
      decision: "pass",
      promotionReady: true,
      checkedRows: 2,
    });
    expect(result.summary).toContain("dispatch=no");
    expect(result.summary).toContain("write=no");
  });

  it("fails closed on missing rows, empty output, and undeclared mutation touches", () => {
    const packet = arenaPacket();
    const scorecard = terminalScorecard(packet);
    scorecard.rows = [
      {
        ...scorecard.rows[1],
        outputBytes: 0,
        touchedFiles: ["README.md"],
      },
    ];

    const result = buildAgentRunSdkProviderModelArenaFanInPacket({
      suiteManifest: packet.suiteManifest,
      scorecard,
      fanInPlan: packet.fanInPlan,
    });

    expect(result.decision).toBe("fail");
    expect(result.promotionReady).toBe(false);
    expect(result.blockers).toContain("scorecard-row-missing:arena-fan-in-smoke-readonly-one-file");
    expect(result.blockers).toContain("worker-empty-output:arena-fan-in-smoke-mutation-one-file-marker");
    expect(result.blockers).toContain("mutation-worker-touched-undeclared-files:arena-fan-in-smoke-mutation-one-file-marker:README.md");
  });

  it("registers a read-only fan-in surface without dispatch or writes", () => {
    const tools: RegisteredTool[] = [];
    guardrailsAgentRun({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      registerCommand() {},
    } as never);

    const tool = tools.find((entry) => entry.name === "agent_run_sdk_provider_model_arena_fan_in_packet");
    expect(tool?.parameters).toMatchObject({
      type: "object",
      properties: {
        suite_manifest: expect.any(Object),
        scorecard: expect.any(Object),
        fan_in_plan: expect.any(Object),
      },
    });

    const packet = arenaPacket();
    const result = tool?.execute("tc-arena-fan-in", {
      suite_manifest: packet.suiteManifest,
      scorecard: terminalScorecard(packet),
      fan_in_plan: packet.fanInPlan,
    }, undefined as unknown as AbortSignal, vi.fn(), { cwd: process.cwd() });

    expect(result?.details?.mode).toBe("agent-run-sdk-provider-model-arena-fan-in-packet");
    expect(result?.content?.[0]?.text).toContain("decision=pass");
    expect(result?.content?.[0]?.text).toContain("dispatch=no");
    expect(result?.content?.[0]?.text).toContain("write=no");
  });

  it("registers a calibration prep surface without dispatch or paid calls", () => {
    const tools: RegisteredTool[] = [];
    guardrailsAgentRun({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      registerCommand() {},
    } as never);

    const tool = tools.find((entry) => entry.name === "agent_run_sdk_provider_model_arena_calibration_packet");
    expect(tool?.parameters).toMatchObject({
      type: "object",
      properties: {
        provider_model_ref: expect.any(Object),
        readiness_decision: expect.any(Object),
        readiness_evidence: expect.any(Object),
        baseline_provider_model_refs: expect.any(Object),
      },
    });

    const result = tool?.execute("tc-arena-calibration", {
      arena_id: "arena-calibration-surface",
      provider_model_ref: SECONDARY_PROVIDER_MODEL_REF,
      readiness_decision: "ready",
      readiness_evidence: "provider_readiness=ready budget=ok source=operator-check",
      baseline_provider_model_refs: [PRIMARY_PROVIDER_MODEL_REF],
      envelopes: ["readonly-one-file"],
      max_calls: 1,
      timeout_ms: 45_000,
      max_estimated_cost_usd: 0.25,
      budget_decision: "ok",
      budget_evidence: `manual budget evidence for ${SECONDARY_PROVIDER_MODEL_REF}`,
    }, undefined as unknown as AbortSignal, vi.fn(), { cwd: process.cwd() });

    expect(result?.details?.mode).toBe("agent-run-sdk-provider-model-arena-calibration-packet");
    expect(result?.content?.[0]?.text).toContain("decision=ready-for-operator-decision");
    expect(result?.content?.[0]?.text).toContain("paidCalls=no");
    expect(result?.content?.[0]?.text).toContain("dispatch=no");
  });
});
