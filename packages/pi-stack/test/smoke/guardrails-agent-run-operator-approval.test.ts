import { describe, expect, it } from "vitest";
import {
  buildAgentRunSdkInProcessPacket,
  buildAgentRunSdkReadOnlyBatchPacket,
} from "../../extensions/guardrails-core-exports";

describe("agent run operator approval packets", () => {
  it("attaches exact-text fallback approval to SDK single-worker packets", () => {
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
      decision: "needs-exact-text-fallback",
      interaction: "exact-text-fallback",
      acceptsShortAnswer: false,
      dispatchAllowed: false,
      exactConfirmationPhrase: "execute o sdk worker sdk-approval-single",
    });
    expect(packet.operatorApproval.allowedResponses).toEqual(["execute o sdk worker sdk-approval-single"]);
  });

  it("attaches suite fallback approval to read-only batch packets", () => {
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
      decision: "needs-exact-text-fallback",
      interaction: "exact-text-fallback",
      acceptsShortAnswer: false,
      dispatchAllowed: false,
      exactConfirmationPhrase: "approve sdk readonly batch sdk-approval-batch",
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
