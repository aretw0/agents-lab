import { describe, expect, it } from "vitest";
import {
  buildColonyPlanPacket,
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
      expectedArtifact: "reports/colony-scan/worker-01.json",
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
      expectedArtifact: "reports/colony-scan/worker-02.json",
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
});
