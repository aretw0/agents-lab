import { describe, expect, it } from "vitest";
import {
  buildAgentRunSdkProviderModelArenaArtifactPacket,
  buildAgentRunSdkProviderModelArenaCalibrationPacket,
  buildAgentRunSdkProviderModelArenaPacket,
} from "../../extensions/guardrails-core-exports";

const PRIMARY_PROVIDER_MODEL_REF = "provider-a/model-alpha";
const SECONDARY_PROVIDER_MODEL_REF = "provider-b/model-beta";
const ARENA_SMOKE_ID = "arena-primary-model-smoke";
const ARENA_EXPANDED_ID = "arena-expanded-primary-model-smoke";
const ARENA_MUTATION_ID = "arena-mutation-primary-model-smoke";
const ARENA_CALIBRATION_ID = "arena-secondary-model-calibration";

describe("agent run SDK arena packets", () => {
  it("builds provider model arena packets without dispatch", () => {
    const arenaPacket = buildAgentRunSdkProviderModelArenaPacket({
      arenaId: ARENA_SMOKE_ID,
      providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
      envelopes: ["readonly-one-file", "mutation-one-file-marker"],
      maxCalls: 2,
      timeoutMs: 90_000,
      maxEstimatedCostUsd: 0.25,
      budgetDecision: "ok",
      budgetEvidence: "manual test budget evidence",
    });
    expect(arenaPacket).toMatchObject({
      mode: "agent-run-sdk-provider-model-arena-packet",
      dispatchAllowed: false,
      paidModelCallsAllowed: false,
      decision: "ready-for-operator-decision",
    });
    expect(arenaPacket.arenaSpec.promotionScope).toBe("provider-model-envelope");
    expect(arenaPacket.canaries).toHaveLength(2);
    expect(arenaPacket.canaries.map((canary) => canary.envelope)).toEqual(["readonly-one-file", "mutation-one-file-marker"]);
    expect(arenaPacket.canaries[1]?.packet.sdkMaturity.rung).toBe("validated-one-file-mutation");
    expect(arenaPacket.promotionContract.join("\n")).toContain("passing one provider/model does not promote another provider/model");
    expect(arenaPacket.budgetContract.join("\n")).toContain("never starts paid/model calls by itself");
    expect(arenaPacket.priorArtContract.join("\n")).toContain("do not benchmark in isolation");
    expect(arenaPacket.priorArtContract.join("\n")).toContain("external prior art");
    expect(arenaPacket.nextActions.join("\n")).toContain("collect prior-art references");
    expect(arenaPacket.summary).toContain("paidCalls=no");

    const expandedArenaPacket = buildAgentRunSdkProviderModelArenaPacket({
      arenaId: ARENA_EXPANDED_ID,
      providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
      envelopes: [
        "readonly-three-file-risk-table",
        "readonly-source-backed-evidence-synthesis",
        "readonly-web-research-tool-contract-review",
      ],
      maxCalls: 3,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.75,
      budgetDecision: "ok",
      budgetEvidence: "manual expanded suite budget evidence",
    });
    expect(expandedArenaPacket.decision).toBe("ready-for-operator-decision");
    expect(expandedArenaPacket.canaries.map((canary) => canary.envelope)).toEqual([
      "readonly-three-file-risk-table",
      "readonly-source-backed-evidence-synthesis",
      "readonly-web-research-tool-contract-review",
    ]);
    expect(expandedArenaPacket.canaries[0]?.declaredFiles).toEqual(["package.json", "packages/pi-stack/package.json", ".github/workflows/publish.yml"]);
    expect(expandedArenaPacket.canaries[0]?.maturityNotes).toContain("generic risk table");
    expect(expandedArenaPacket.canaries[0]?.protectedScope).toBe(false);
    expect(expandedArenaPacket.canaries[1]?.declaredFiles).toContain("docs/research/source-backed-pnpm-supply-chain-evidence-2026-05.md");
    expect(expandedArenaPacket.canaries[2]?.packet.runSpec.goal).toContain("do not use web");
    expect(expandedArenaPacket.suiteManifest).toMatchObject({
      mode: "report-only-suite",
      suiteId: ARENA_EXPANDED_ID,
      parallelism: 1,
      runIds: [
        `${ARENA_EXPANDED_ID}-readonly-three-file-risk-table`,
        `${ARENA_EXPANDED_ID}-readonly-source-backed-evidence-synthesis`,
        `${ARENA_EXPANDED_ID}-readonly-web-research-tool-contract-review`,
      ],
    });
    expect(expandedArenaPacket.suiteManifest.envelopes[1]?.maturityNotes).toContain("parent-curated source-backed synthesis");
    expect(expandedArenaPacket.suiteManifest.envelopes[1]?.protectedScope).toBe(false);
    expect(expandedArenaPacket.suiteManifest.stopOn).toContain("unexpected-touched-file");
    expect(expandedArenaPacket.suiteManifest.fanInValidation.join("\n")).toContain("terminal outcome packet");
    expect(expandedArenaPacket.nextActions.join("\n")).toContain("report-only suite manifest");
    expect(expandedArenaPacket.summary).toContain("envelopes=3");

    const mutationArenaPacket = buildAgentRunSdkProviderModelArenaPacket({
      arenaId: ARENA_MUTATION_ID,
      providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
      envelopes: ["mutation-one-file-doc-marker", "mutation-one-file-test-fixture", "mutation-one-file-code-constant"],
      maxCalls: 3,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.75,
      budgetDecision: "ok",
      budgetEvidence: "manual one-file mutation suite budget evidence",
    });
    expect(mutationArenaPacket.decision).toBe("ready-for-operator-decision");
    expect(mutationArenaPacket.canaries.map((canary) => canary.fileContract)).toEqual(["mutation", "mutation", "mutation"]);
    expect(mutationArenaPacket.canaries.every((canary) => canary.packet.sdkMaturity.rung === "validated-one-file-mutation")).toBe(true);
    expect(mutationArenaPacket.canaries[1]?.declaredFiles).toEqual(["packages/pi-stack/test/smoke/guardrails-agent-run-sdk.test.ts"]);
    expect(mutationArenaPacket.canaries[2]?.maturityNotes).toContain("generic one-file code/config mutation");
    expect(mutationArenaPacket.suiteManifest.envelopes[0]?.validation).toContain("touched files must stay within declared files");
    expect(mutationArenaPacket.scorecardTemplate.artifactPath).toBe(`.pi/reports/${ARENA_MUTATION_ID}.scorecard.json`);
    expect(mutationArenaPacket.scorecardTemplate.rows).toHaveLength(3);
    expect(mutationArenaPacket.scorecardTemplate.rows[0]).toMatchObject({
      providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
      envelope: "mutation-one-file-doc-marker",
      processState: "pending",
      contractDecision: "pending",
    });
    expect(mutationArenaPacket.scorecardTemplate.requiredFields).toContain("contractDecision");
    expect(mutationArenaPacket.fanInPlan).toMatchObject({
      artifactPath: `.pi/reports/${ARENA_MUTATION_ID}.fanin.json`,
      expectedRunIds: [
        `${ARENA_MUTATION_ID}-mutation-one-file-doc-marker`,
        `${ARENA_MUTATION_ID}-mutation-one-file-test-fixture`,
        `${ARENA_MUTATION_ID}-mutation-one-file-code-constant`,
      ],
    });
    expect(mutationArenaPacket.fanInPlan.requiredOutcomePackets[0]).toContain("agent_run_outcome_packet");
    expect(mutationArenaPacket.fanInPlan.failClosedOn).toContain("contract-failure");
    expect(mutationArenaPacket.serialSuiteDispatchPlan).toMatchObject({
      mode: "structured-approval-serial-suite-preview",
      dispatchAllowed: false,
      executeSupported: false,
      operatorApprovalPrompt: `approve arena serial suite ${ARENA_MUTATION_ID}`,
      runOrder: [
        `${ARENA_MUTATION_ID}-mutation-one-file-doc-marker`,
        `${ARENA_MUTATION_ID}-mutation-one-file-test-fixture`,
        `${ARENA_MUTATION_ID}-mutation-one-file-code-constant`,
      ],
    });
    expect(mutationArenaPacket.serialSuiteDispatchPlan.preflightChecks.join("\n")).toContain("structured operator approval");
    expect(mutationArenaPacket.serialSuiteDispatchPlan.blockedUntil.join("\n")).toContain("serial-suite executor exists");
    expect(mutationArenaPacket.suiteArtifactPlan).toMatchObject({
      mode: "report-only-artifact-write-preview",
      writeAllowed: false,
      applySupported: false,
      artifacts: [
        {
          kind: "suite-manifest",
          path: `.pi/reports/${ARENA_MUTATION_ID}.manifest.json`,
          sourceField: "suiteManifest",
          requiredBeforePromotion: true,
        },
        {
          kind: "scorecard-template",
          path: `.pi/reports/${ARENA_MUTATION_ID}.scorecard.json`,
          sourceField: "scorecardTemplate",
          requiredBeforePromotion: true,
        },
        {
          kind: "fanin-plan",
          path: `.pi/reports/${ARENA_MUTATION_ID}.fanin.json`,
          sourceField: "fanInPlan",
          requiredBeforePromotion: true,
        },
      ],
    });
    expect(mutationArenaPacket.suiteArtifactPlan.operatorSteps.join("\n")).toContain("do not start workers");
    expect(mutationArenaPacket.suiteArtifactPlan.operatorSteps.join("\n")).toContain("future models prove capabilities independently");

    const artifactPacket = buildAgentRunSdkProviderModelArenaArtifactPacket({
      arenaId: ARENA_MUTATION_ID,
      providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
      envelopes: ["mutation-one-file-doc-marker", "mutation-one-file-test-fixture", "mutation-one-file-code-constant"],
      maxCalls: 3,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.75,
      budgetDecision: "ok",
      budgetEvidence: "manual one-file mutation suite budget evidence",
    });
    expect(artifactPacket).toMatchObject({
      mode: "agent-run-sdk-provider-model-arena-artifact-packet",
      decision: "preview",
      writeAllowed: false,
      dispatchAllowed: false,
      applyRequested: false,
      structuredOperatorApproval: false,
    });
    expect(artifactPacket.artifactPreviews.map((artifact) => artifact.kind)).toEqual(["suite-manifest", "scorecard-template", "fanin-plan"]);
    expect(artifactPacket.artifactPreviews[0]?.path).toBe(`.pi/reports/${ARENA_MUTATION_ID}.manifest.json`);
    expect(artifactPacket.artifactPreviews.every((artifact) => artifact.bytes > 0)).toBe(true);
    expect(artifactPacket.nextActions.join("\n")).toContain("do not start workers");

    const blockedArtifactApply = buildAgentRunSdkProviderModelArenaArtifactPacket({
      arenaId: ARENA_MUTATION_ID,
      providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
      envelopes: ["mutation-one-file-doc-marker"],
      maxCalls: 1,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.25,
      budgetDecision: "ok",
      budgetEvidence: "manual one-file mutation suite budget evidence",
      apply: true,
    });
    expect(blockedArtifactApply.decision).toBe("blocked");
    expect(blockedArtifactApply.writeAllowed).toBe(false);
    expect(blockedArtifactApply.blockers).toContain("structured-operator-approval-missing");

    const confirmedArtifactApply = buildAgentRunSdkProviderModelArenaArtifactPacket({
      arenaId: ARENA_MUTATION_ID,
      providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
      envelopes: ["mutation-one-file-doc-marker"],
      maxCalls: 1,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.25,
      budgetDecision: "ok",
      budgetEvidence: "manual one-file mutation suite budget evidence",
      apply: true,
      operatorApproval: structuredApproval(),
    });
    expect(confirmedArtifactApply).toMatchObject({
      decision: "ready-to-apply",
      authorization: "explicit-operator",
      writeAllowed: true,
      dispatchAllowed: false,
      paidModelCallsAllowed: false,
      structuredOperatorApproval: true,
    });
    expect(confirmedArtifactApply.summary).toContain("write=yes");
    expect(mutationArenaPacket.nextActions.join("\n")).toContain("serialSuiteDispatchPlan only as a preview");
    expect(mutationArenaPacket.nextActions.join("\n")).toContain("suiteArtifactPlan before persisting");
    expect(mutationArenaPacket.promotionContract.join("\n")).toContain("does not promote multi-file mutation");

    const arenaBlocked = buildAgentRunSdkProviderModelArenaPacket({
      arenaId: "arena-blocked",
      providerModelRef: PRIMARY_PROVIDER_MODEL_REF,
      envelopes: ["readonly-one-file", "unknown-envelope"],
      maxCalls: 1,
      timeoutMs: 90_000,
      maxEstimatedCostUsd: 0,
      budgetDecision: "unknown",
    });
    expect(arenaBlocked.decision).toBe("blocked");
    expect(arenaBlocked.blockers).toContain("unknown-envelope");
    expect(arenaBlocked.blockers).toContain("max-estimated-cost-missing");
    expect(arenaBlocked.blockers).toContain("budget-evidence-missing");
  });

  it("prepares provider/model calibration without inheriting baseline evidence or dispatching calls", () => {
    const calibration = buildAgentRunSdkProviderModelArenaCalibrationPacket({
      arenaId: ARENA_CALIBRATION_ID,
      providerModelRef: SECONDARY_PROVIDER_MODEL_REF,
      readinessDecision: "ready",
      readinessEvidence: "provider_readiness=ready budget=ok source=operator-check",
      baselineProviderModelRefs: [PRIMARY_PROVIDER_MODEL_REF],
      envelopes: ["readonly-one-file", "readonly-source-backed-evidence-synthesis"],
      maxCalls: 2,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.25,
      budgetDecision: "ok",
      budgetEvidence: `manual budget evidence for ${SECONDARY_PROVIDER_MODEL_REF}`,
    });

    expect(calibration).toMatchObject({
      mode: "agent-run-sdk-provider-model-arena-calibration-packet",
      decision: "ready-for-operator-decision",
      dispatchAllowed: false,
      paidModelCallsAllowed: false,
      writeAllowed: false,
      readiness: {
        decision: "ready",
      },
      calibrationPlan: {
        providerModelRef: SECONDARY_PROVIDER_MODEL_REF,
        noInheritedEvidence: true,
      },
      comparisonPlan: {
        baselineProviderModelRefs: [PRIMARY_PROVIDER_MODEL_REF],
        promotionScope: "provider-model-envelope",
      },
    });
    expect(calibration.calibrationPlan.envelopes).toEqual(["readonly-one-file", "readonly-source-backed-evidence-synthesis"]);
    expect(calibration.nextActions.join("\n")).toContain("do not inherit baseline capability evidence");
    expect(calibration.summary).toContain("paidCalls=no");

    const blocked = buildAgentRunSdkProviderModelArenaCalibrationPacket({
      arenaId: "arena-missing-readiness",
      providerModelRef: SECONDARY_PROVIDER_MODEL_REF,
      readinessDecision: "unknown",
      envelopes: ["readonly-one-file"],
      maxCalls: 1,
      timeoutMs: 45_000,
      maxEstimatedCostUsd: 0.25,
      budgetDecision: "ok",
      budgetEvidence: "manual budget evidence",
    });
    expect(blocked.decision).toBe("blocked");
    expect(blocked.blockers).toContain("provider-readiness-not-ready:unknown");
    expect(blocked.blockers).toContain("provider-readiness-evidence-missing");
  });
});

function structuredApproval(): Record<string, unknown> {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
  };
}
