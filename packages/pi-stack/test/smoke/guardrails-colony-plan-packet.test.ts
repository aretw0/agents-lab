import { describe, expect, it } from "vitest";
import {
  buildColonyPlanPacket,
  buildColonyWorkerStartPacket,
  ColonyPlanBudgetDecision,
} from "../../extensions/guardrails-core-colony-plan";
import { registerColonyPlanPacketSurface } from "../../extensions/guardrails-core-colony-plan-surface";

describe("colony plan packet", () => {
  const baseWorkers = [
    {
      id: "w-01",
      objective: "derive role coverage and stop conditions",
      declaredFiles: ["packages/pi-stack/extensions/colony-pilot.ts", "packages/pi-stack/extensions/colony-pilot-model-policy.ts"],
      allowedTools: ["read", "grep", "git"],
      allowedCapabilities: ["evidence-synthesis", "scope-readonly"],
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      budgetEvidencePolicy: "warn" as ColonyPlanBudgetDecision,
      budgetEvidence: "provider advisory ok for local evidence packet",
      stopConditions: ["stop if model override mismatch", "stop on contract drift"],
      expectedArtifact: ".project/reports/colony-scan/worker-01.json",
    },
    {
      id: "w-02",
      objective: "prepare local-safe follow-up verification",
      declaredFiles: ["packages/pi-stack/extensions/colony-pilot-runtime.ts"],
      allowedTools: ["read", "grep"],
      allowedCapabilities: ["runtime-evidence", "smoke-check"],
      budgetEvidencePolicy: "warn" as ColonyPlanBudgetDecision,
      budgetEvidence: "provider advisory ok for runtime follow-up",
      stopConditions: ["stop if missing runtime artifact", "stop on dirty git state"],
      expectedArtifact: ".project/reports/colony-scan/worker-02.json",
    },
  ];

  it("builds a bounded ready packet with 2-5 workers and fail-closed fan-in policy", () => {
    const result = buildColonyPlanPacket({
      planId: "colonies-2026-06",
      objective: "stabilize colony boundary",
      validationKnown: true,
      rollbackPlanKnown: true,
      stopConditionsClear: true,
      workers: baseWorkers,
    });

    expect(result.mode).toBe("colony-plan-packet");
    expect(result.authorization).toBe("none");
    expect(result.decision).toBe("ready-for-operator-decision");
    expect(result.workerCount).toBe(2);
    expect(result.workers).toHaveLength(2);
    expect(result.workers[0]?.packetId).toBe("w-01");
    expect(result.workers[0]?.outcomeContract.expectedArtifact).toBe(result.workers[0]?.expectedArtifact);
    expect(result.workers[0]?.outcomeContract.requiredArtifact).toBe(result.workers[0]?.expectedArtifact);
    expect(result.workers[0]?.outcomeContract.requiredScope.length).toBeGreaterThan(0);
    expect(result.joinPolicy.mode).toBe("fail-closed");
    expect(result.joinPolicy.requiredOutcomeIds).toHaveLength(2);
    expect(result.joinPolicy.failClosedWhen).toContain("missing any required worker outcome");
    expect(result.batchExecutionAllowed).toBe(false);
    expect(result.workerDispatchAllowed).toBe(false);
    expect(result.dispatchAllowed).toBe(false);
    expect(result.summary).toContain("dispatch=no");
  });

  it("blocks plans that are outside the 2-5 worker range", () => {
    const oneWorker = buildColonyPlanPacket({
      planId: "colonies-2026-06-one",
      objective: "single-worker edge",
      validationKnown: true,
      rollbackPlanKnown: true,
      stopConditionsClear: true,
      workers: [baseWorkers[0]],
    });

    expect(oneWorker.decision).toBe("blocked");
    expect(oneWorker.blockers.some((reason) => reason.startsWith("workers-missing:"))).toBe(true);

    const manyWorkers = buildColonyPlanPacket({
      planId: "colonies-2026-06-many",
      objective: "overflow edge",
      validationKnown: true,
      rollbackPlanKnown: true,
      stopConditionsClear: true,
      workers: Array.from({ length: 6 }, (_, index) => ({
        ...baseWorkers[0],
        id: `worker-${index + 1}`,
        objective: `worker ${index + 1} objective`,
      })),
    });

    expect(manyWorkers.decision).toBe("blocked");
    expect(manyWorkers.blockers.some((reason) => reason.startsWith("workers-exceed-max:"))).toBe(true);
  });

  it("never dispatches and is exposed as a report-only surface tool", () => {
    const tools: Array<{ name: string; execute: (toolCallId: string, params: Record<string, unknown>) => { details: unknown } }> = [];
    registerColonyPlanPacketSurface({
      registerTool(tool: unknown) {
        const typed = tool as { name: string; execute: (toolCallId: string, params: Record<string, unknown>) => { details: unknown } };
        tools.push(typed);
      },
    } as never);

    const tool = tools.find((row) => row.name === "colony_plan_packet");
    const result = tool?.execute("call", {
      plan_id: "colonies-tool-2026-06",
      objective: "tool smoke check",
      validation_known: true,
      rollback_plan_known: true,
      stop_conditions_clear: true,
      workers: [
        {
          packet_id: "s1",
          objective: "tool worker one",
          declared_files: ["packages/pi-stack/extensions/colony-pilot.ts"],
          stop_conditions: ["stop on dry-run mismatch"],
          expected_artifact: "reports/tool-worker-1.json",
        },
        {
          packet_id: "s2",
          objective: "tool worker two",
          declared_files: ["packages/pi-stack/extensions/colony-pilot-model-policy.ts"],
          stop_conditions: ["stop on missing model state"],
          expected_artifact: "reports/tool-worker-2.json",
        },
      ],
    });

    const details = (result?.details ?? {}) as Record<string, unknown>;
    expect(details.decision).toBe("ready-for-operator-decision");
    expect(details.dispatchAllowed).toBe(false);
    expect(details.workerDispatchAllowed).toBe(false);
    expect(details.batchExecutionAllowed).toBe(false);
  });

  it("bridges one worker packet to a serial agent invocation spec without dispatch", () => {
    const result = buildColonyWorkerStartPacket({
      planId: "serial-subagent-bootstrap-001",
      workerPacketId: "worker-01-scope-scan",
      objective: baseWorkers[0].objective,
      declaredFiles: baseWorkers[0].declaredFiles,
      providerModelRef: baseWorkers[0].providerModelRef,
      budgetEvidencePolicy: baseWorkers[0].budgetEvidencePolicy,
      budgetEvidence: baseWorkers[0].budgetEvidence,
      stopConditions: baseWorkers[0].stopConditions,
      expectedArtifact: baseWorkers[0].expectedArtifact,
    });

    expect(result.mode).toBe("colony-worker-start-packet");
    expect(result.dispatchAllowed).toBe(false);
    expect(result.processStartAllowed).toBe(false);
    expect(result.batchExecutionAllowed).toBe(false);
    expect(result.serialOnly).toBe(true);
    expect(result.requiredOutcomeId).toBe("outcome:serial-subagent-bootstrap-001:worker-01-scope-scan");
    expect(result.agentInvocationSpecPacket.mode).toBe("agent-invocation-spec-packet");
    expect(result.agentInvocationSpecPacket.dispatchAllowed).toBe(false);
    expect(result.agentInvocationSpecPacket.invocationSpec.declaredFiles).toEqual(baseWorkers[0].declaredFiles);
    expect(result.agentInvocationSpecPacket.invocationSpec.profile).toBe("read-only-review");
    expect(result.nextActions.join("\n")).toContain("agent_run_outcome_packet");
  });

  it("defaults colony artifacts to .project/reports when omitted", () => {
    const plan = buildColonyPlanPacket({
      planId: "serial-subagent-bootstrap-001",
      objective: "derive default artifact paths",
      validationKnown: true,
      rollbackPlanKnown: true,
      stopConditionsClear: true,
      workers: [
        { ...baseWorkers[0], expectedArtifact: undefined },
        { ...baseWorkers[1], expectedArtifact: undefined },
      ],
    });
    const worker = buildColonyWorkerStartPacket({
      planId: "serial-subagent-bootstrap-001",
      workerPacketId: "worker-01-scope-scan",
      objective: baseWorkers[0].objective,
      declaredFiles: baseWorkers[0].declaredFiles,
      providerModelRef: baseWorkers[0].providerModelRef,
      budgetEvidencePolicy: baseWorkers[0].budgetEvidencePolicy,
      budgetEvidence: baseWorkers[0].budgetEvidence,
      stopConditions: baseWorkers[0].stopConditions,
    });

    expect(plan.workers[0]?.expectedArtifact).toBe(".project/reports/colony-serial-subagent-bootstrap-001-worker-1.json");
    expect(plan.workers[1]?.expectedArtifact).toBe(".project/reports/colony-serial-subagent-bootstrap-001-worker-2.json");
    expect(worker.expectedArtifact).toBe(".project/reports/colony-serial-subagent-bootstrap-001-worker-01-scope-scan.json");
  });

  it("preserves explicit legacy reports artifact paths", () => {
    const explicitArtifact = "reports/colony-subagent/worker-01-scope-scan.json";
    const worker = buildColonyWorkerStartPacket({
      planId: "serial-subagent-bootstrap-001",
      workerPacketId: "worker-01-scope-scan",
      objective: baseWorkers[0].objective,
      declaredFiles: baseWorkers[0].declaredFiles,
      providerModelRef: baseWorkers[0].providerModelRef,
      budgetEvidencePolicy: baseWorkers[0].budgetEvidencePolicy,
      budgetEvidence: baseWorkers[0].budgetEvidence,
      stopConditions: baseWorkers[0].stopConditions,
      expectedArtifact: explicitArtifact,
    });

    expect(worker.expectedArtifact).toBe(explicitArtifact);
    expect(worker.agentInvocationSpecPacket.invocationSpec.goal).toContain(explicitArtifact);
  });

  it("exposes colony_worker_start_packet as report-only surface", () => {
    const tools: Array<{ name: string; execute: (toolCallId: string, params: Record<string, unknown>) => { details: unknown } }> = [];
    registerColonyPlanPacketSurface({
      registerTool(tool: unknown) {
        const typed = tool as { name: string; execute: (toolCallId: string, params: Record<string, unknown>) => { details: unknown } };
        tools.push(typed);
      },
    } as never);

    const tool = tools.find((row) => row.name === "colony_worker_start_packet");
    const result = tool?.execute("call", {
      plan_id: "serial-subagent-bootstrap-001",
      worker_packet_id: "worker-01-scope-scan",
      objective: baseWorkers[0].objective,
      declared_files: baseWorkers[0].declaredFiles,
      provider_model_ref: baseWorkers[0].providerModelRef,
      budget_evidence_policy: baseWorkers[0].budgetEvidencePolicy,
      budget_evidence: baseWorkers[0].budgetEvidence,
      stop_conditions: baseWorkers[0].stopConditions,
      expected_artifact: baseWorkers[0].expectedArtifact,
    });

    const details = (result?.details ?? {}) as Record<string, unknown>;
    expect(details.mode).toBe("colony-worker-start-packet");
    expect(details.dispatchAllowed).toBe(false);
    expect(details.processStartAllowed).toBe(false);
  });
});
