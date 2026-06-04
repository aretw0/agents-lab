import { describe, expect, it } from "vitest";
import { buildColonySerialFanInPacket } from "../../extensions/guardrails-core-colony-fanin-packet";
import { registerColonyPlanPacketSurface } from "../../extensions/guardrails-core-colony-plan-surface";

describe("colony serial fan-in packet", () => {
  const planId = "serial-subagent-bootstrap-001";
  const worker01 = {
    workerPacketId: "worker-01-scope-scan",
    requiredOutcomeId: "outcome:serial-subagent-bootstrap-001:worker-01-scope-scan",
    expectedArtifact: ".project/reports/colony-serial-subagent-bootstrap-001-worker-01-scope-scan.json",
    artifactPresent: true,
    artifactBytes: 1104,
    artifactStatus: "PASS",
    processState: "completed",
    contractDecision: "pass",
    fileContract: "read-only",
    declaredFiles: [
      "packages/pi-stack/extensions/guardrails-core-colony-plan.ts",
      "packages/pi-stack/test/smoke/guardrails-colony-plan-packet.test.ts",
    ],
    touchedFiles: [],
    outputBytes: 1104,
    cacheStatus: "unknown",
  };
  const worker02 = {
    workerPacketId: "worker-02-join-contract",
    requiredOutcomeId: "outcome:serial-subagent-bootstrap-001:worker-02-join-contract",
    expectedArtifact: ".project/reports/colony-serial-subagent-bootstrap-001-worker-02-join-contract.json",
    artifactPresent: true,
    artifactBytes: 1849,
    artifactStatus: "PASS",
    processState: "completed",
    contractDecision: "pass",
    fileContract: "read-only",
    declaredFiles: [
      "packages/pi-stack/extensions/guardrails-core-colony-plan-surface.ts",
      "scripts/decoupling-maturity-report.mjs",
    ],
    touchedFiles: [".project/reports/colony-serial-subagent-bootstrap-001-worker-02-join-contract.json"],
    outputBytes: 1849,
    cacheStatus: "unknown",
  };

  it("passes when outcomes pass and touched files are only expected artifacts", () => {
    const result = buildColonySerialFanInPacket({
      planId,
      workers: [worker01, worker02],
    });

    expect(result.mode).toBe("colony-serial-fanin-packet");
    expect(result.dispatchAllowed).toBe(false);
    expect(result.processStartAllowed).toBe(false);
    expect(result.decision).toBe("pass");
    expect(result.recommendation).toBe("promote-evidence");
    expect(result.blockers).toEqual([]);
    expect(result.workerSummaries[0]?.cacheStatusInterpretation).toBe("not-applicable");
    expect(result.workerSummaries[1]?.evidenceTouchedFiles).toEqual([worker02.expectedArtifact]);
    expect(result.batchOutcomePacket.mode).toBe("agent-run-batch-outcome-packet");
    expect(result.batchOutcomePacket.decision).toBe("pass");
    expect(result.batchOutcomePacket.workerSummaries[1]?.touchedFileCount).toBe(0);
  });

  it("blocks declared-file mutation for a read-only worker", () => {
    const result = buildColonySerialFanInPacket({
      planId,
      workers: [
        worker01,
        {
          ...worker02,
          touchedFiles: [worker02.declaredFiles[0]],
        },
      ],
    });

    expect(result.decision).toBe("block");
    expect(result.blockers.join("\n")).toContain("read-only-declared-files-touched");
  });

  it("blocks invalid outcome id format", () => {
    const result = buildColonySerialFanInPacket({
      planId,
      workers: [
        {
          ...worker01,
          requiredOutcomeId: "outcome-serial-subagent-bootstrap-001-worker-01-scope-scan",
        },
        worker02,
      ],
    });

    expect(result.decision).toBe("block");
    expect(result.blockers.join("\n")).toContain("invalid-outcome-id");
  });

  it("blocks explicit invalid requiredOutcomeId in requiredOutcomeIds", () => {
    const result = buildColonySerialFanInPacket({
      planId,
      requiredOutcomeIds: ["outcome-serial-subagent-bootstrap-001:worker-01-scope-scan"],
      workers: [worker01, worker02],
    });

    expect(result.decision).toBe("block");
    expect(result.recommendation).toBe("block-promotion");
    expect(result.blockers.join("\n")).toContain("invalid-required-outcome-id:outcome-serial-subagent-bootstrap-001:worker-01-scope-scan");
  });

  it("blocks explicit requiredOutcomeIds missing from worker list", () => {
    const result = buildColonySerialFanInPacket({
      planId,
      requiredOutcomeIds: ["outcome:serial-subagent-bootstrap-001:worker-03-missing"],
      workers: [worker01, worker02],
    });

    expect(result.decision).toBe("block");
    expect(result.recommendation).toBe("block-promotion");
    expect(result.recommendationCode).toBe("colony-serial-fanin-block");
    expect(result.blockers.join("\n")).toContain("missing-required-outcome:outcome:serial-subagent-bootstrap-001:worker-03-missing");
  });

  it("returns partial for non-canonical cache status with complete evidence", () => {
    const result = buildColonySerialFanInPacket({
      planId,
      requiredOutcomeIds: [worker01.requiredOutcomeId, worker02.requiredOutcomeId],
      workers: [
        { ...worker01, cacheStatus: "reviewed-by-operator" },
        { ...worker02, cacheStatus: "reviewed-by-operator" },
      ],
    });

    expect(result.decision).toBe("partial");
    expect(result.recommendation).toBe("ask-operator");
    expect(result.recommendationCode).toBe("colony-serial-fanin-partial");
    expect(result.blockers).toEqual([]);
    expect(result.warnings.join("\n")).toContain("operator-reviewed");
    expect(result.workerSummaries[0]?.cacheStatusInterpretation).toBe("operator-reviewed");
    expect(result.workerSummaries[1]?.cacheStatusInterpretation).toBe("operator-reviewed");
    expect(result.batchOutcomePacket.decision).toBe("partial");
    expect(result.batchOutcomePacket.recommendation).toBe("ask-operator");
    expect(result.batchOutcomePacket.recommendationCode).toBe("agent-run-batch-outcome-partial");
  });

  it("exposes colony_serial_fanin_packet as report-only surface", () => {
    const tools: Array<{ name: string; execute: (toolCallId: string, params: Record<string, unknown>) => { details: unknown } }> = [];
    registerColonyPlanPacketSurface({
      registerTool(tool: unknown) {
        const typed = tool as { name: string; execute: (toolCallId: string, params: Record<string, unknown>) => { details: unknown } };
        tools.push(typed);
      },
    } as never);

    const tool = tools.find((row) => row.name === "colony_serial_fanin_packet");
    const result = tool?.execute("call", {
      plan_id: planId,
      workers: [
        {
          worker_packet_id: worker01.workerPacketId,
          required_outcome_id: worker01.requiredOutcomeId,
          expected_artifact: worker01.expectedArtifact,
          artifact_present: true,
          artifact_bytes: worker01.artifactBytes,
          artifact_status: "PASS",
          process_state: "completed",
          contract_decision: "pass",
          file_contract: "read-only",
          declared_files: worker01.declaredFiles,
          touched_files: [],
          output_bytes: worker01.outputBytes,
          cache_status: "unknown",
        },
        {
          worker_packet_id: worker02.workerPacketId,
          required_outcome_id: worker02.requiredOutcomeId,
          expected_artifact: worker02.expectedArtifact,
          artifact_present: true,
          artifact_bytes: worker02.artifactBytes,
          artifact_status: "PASS",
          process_state: "completed",
          contract_decision: "pass",
          file_contract: "read-only",
          declared_files: worker02.declaredFiles,
          touched_files: worker02.touchedFiles,
          output_bytes: worker02.outputBytes,
          cache_status: "unknown",
        },
      ],
    });

    const details = (result?.details ?? {}) as Record<string, unknown>;
    expect(details.mode).toBe("colony-serial-fanin-packet");
    expect(details.dispatchAllowed).toBe(false);
    expect(details.processStartAllowed).toBe(false);
    expect(details.decision).toBe("pass");
  });
});
