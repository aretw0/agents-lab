import { describe, expect, it } from "vitest";
import { buildLocalBatchManifestPacket } from "../../extensions/guardrails-core-exports";

describe("guardrails local batch contract", () => {
  it("builds a no-execution local batch manifestation packet", () => {
    const profilePacket = {
      decision: "ready-for-operator-decision" as const,
      profile: "bounded-batch-candidate" as const,
      dispatchAllowed: false as const,
      mutationAllowed: false as const,
      authorization: "none" as const,
      mode: "report-only" as const,
    };
    const ready = buildLocalBatchManifestPacket({
      profilePacket,
      manifestation: "explicit-local-batch",
      subject: "release hardening",
      focusTaskId: "TASK-BUD-1049",
      localSafeScope: true,
      sliceLimit: 4,
      timeBudgetKnown: true,
      costBudgetKnown: true,
      validationGateKnown: true,
      rollbackPlanKnown: true,
      checkpointPlanned: true,
      stopConditions: ["validation fails", "protected scope appears"],
    });
    const blocked = buildLocalBatchManifestPacket({
      profilePacket: { ...profilePacket, decision: "blocked" },
      manifestation: "generic",
      localSafeScope: false,
      timeBudgetKnown: false,
      costBudgetKnown: true,
      validationGateKnown: false,
      rollbackPlanKnown: false,
      checkpointPlanned: false,
      protectedScopeRequested: true,
      schedulerRequested: true,
      remoteOrOffloadRequested: true,
      githubActionsRequested: true,
      workerRequested: true,
    });

    expect(ready).toMatchObject({
      effect: "none",
      mode: "manifest-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      mutationAllowed: false,
      executorApproved: false,
      batchExecutionAllowed: false,
      workerDispatchAllowed: false,
      requiresOperatorDecision: true,
      decision: "ready-for-operator-decision",
      manifestation: "explicit-local-batch",
      sliceLimit: 4,
      reasons: ["manifest-explicit", "contracts-present", "execution-still-not-authorized"],
    });
    expect(ready.summary).toBe("local-batch-manifest-packet: decision=ready-for-operator-decision batch=no dispatch=no worker=no slices=4 reasons=manifest-explicit,contracts-present authorization=none");
    expect(blocked).toMatchObject({
      decision: "blocked",
      dispatchAllowed: false,
      batchExecutionAllowed: false,
      workerDispatchAllowed: false,
      blockedRequests: ["protected-scope", "scheduler", "remote-or-offload", "github-actions", "worker"],
    });
    expect(blocked.reasons).toEqual(expect.arrayContaining([
      "profile-packet-not-ready",
      "manifestation-generic",
      "subject-missing",
      "focus-task-missing",
      "local-safe-scope-missing",
      "worker-requested-needs-lower-gate",
    ]));
    expect(blocked.summary).toContain("blockedRequests=protected-scope|scheduler|remote-or-offload|github-actions|worker");
  });
});
