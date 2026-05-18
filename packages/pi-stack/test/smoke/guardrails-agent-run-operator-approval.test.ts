import { describe, expect, it } from "vitest";
import {
  buildAgentRunSdkInProcessPacket,
  buildAgentRunSdkReadOnlyBatchPacket,
  hasStructuredOperatorApproval,
} from "../../extensions/guardrails-core-exports";

describe("agent run operator approval packets", () => {
  it("validates structured operator approval envelopes with one shared primitive", () => {
    expect(hasStructuredOperatorApproval({
      packet_mode: "operator-approval-packet",
      approved: true,
      approval_state: "approved",
    })).toBe(true);
    expect(hasStructuredOperatorApproval({
      packet_mode: "operator-approval-packet",
      approved: true,
      approval_state: "pending",
    })).toBe(false);
  });

  it("attaches structured operator approval requirements to SDK single-worker packets", () => {
    const packet = buildAgentRunSdkInProcessPacket({
      runId: "sdk-approval-single",
      goal: "Read one file and stop.",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["README.md"],
      timeoutMs: 45_000,
      toolAllowlist: ["read", "grep"],
      sessionMode: "in-memory",
      fileContract: "read-only",
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: "ok",
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
    });

    expect(packet.operatorApproval).toMatchObject({
      mode: "operator-approval-packet",
      decision: "needs-structured-approval-signal",
      approvalState: "blocked",
      interaction: "yes-no",
      acceptsShortAnswer: false,
      dispatchAllowed: false,
    });
    expect(packet.operatorApproval.blockers).toContain("structured-operator-approval-signal-missing");
    expect(packet.operatorApproval.allowedResponses).toEqual([]);
  });

  it("attaches structured operator approval requirements to read-only batch packets", () => {
    const packet = buildAgentRunSdkReadOnlyBatchPacket({
      batchId: "sdk-approval-batch",
      sharedEvidence: ["VERIF-SDK-APPROVAL"],
      workers: [
        readyWorker("sdk-approval-a", "README.md"),
        readyWorker("sdk-approval-b", "package.json"),
      ],
    });

    expect(packet.operatorApproval).toMatchObject({
      mode: "operator-approval-packet",
      decision: "needs-structured-approval-signal",
      approvalState: "blocked",
      interaction: "suite-approval",
      acceptsShortAnswer: false,
      dispatchAllowed: false,
    });
    expect(packet.operatorApproval.prompt).toContain("sdk-approval-batch");
    expect(packet.operatorApproval.prompt).toContain("maxCalls=2");
  });
});

function readyWorker(runId: string, file: string) {
  return {
    runId,
    goal: "Read one file and stop.",
    providerModelRef: "openai-codex/gpt-5.3-codex-spark",
    cwd: process.cwd(),
    declaredFiles: [file],
    timeoutMs: 45_000,
    toolAllowlist: ["read", "grep"],
    sessionMode: "in-memory",
    fileContract: "read-only",
    validationGateKnown: true,
    rollbackPlanKnown: true,
    budgetDecision: "ok",
    abortKnown: true,
    eventStreamKnown: true,
    finalOutputContractKnown: true,
  };
}
