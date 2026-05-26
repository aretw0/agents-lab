import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAfkMaterialReadinessSnapshot } from "../../extensions/context-watchdog-afk-material";
import {
  buildTurnBoundaryDecisionPacket,
  resolveContextWatchContinuationRecommendation,
  TURN_BOUNDARY_DIRECTION_PROMPT,
} from "../../extensions/context-watchdog-continuation";

describe("context-watchdog continuation recommendation", () => {
  function withTasks(tasks: Array<Record<string, unknown>>, run: (cwd: string) => void) {
    const cwd = mkdtempSync(join(tmpdir(), "afk-material-readiness-"));
    try {
      mkdirSync(join(cwd, ".project"), { recursive: true });
      writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks }), "utf8");
      run(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  it("returns continue-local when readiness is true", () => {
    const result = resolveContextWatchContinuationRecommendation({
      ready: true,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: [],
    });

    expect(result.recommendationCode).toBe("continue-local");
    expect(result.nextActionCode).toBe("continue-bounded-local-safe-slice");
    expect(result.nextAction.length).toBeGreaterThan(10);
  });

  it("returns local-stop-no-local-safe-next-step when local-safe next step is missing", () => {
    const result = resolveContextWatchContinuationRecommendation({
      ready: false,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: ["no-local-safe-next-step"],
    });

    expect(result.recommendationCode).toBe("local-stop-no-local-safe-next-step");
    expect(result.nextActionCode).toBe("resolve-local-stop-condition");
    expect(result.nextAction).toContain("local stop condition");
  });

  it("returns refresh-focus-checkpoint for stale/invalid focus contexts", () => {
    const result = resolveContextWatchContinuationRecommendation({
      ready: false,
      focusTasks: "none-listed",
      staleFocusCount: 1,
      localAuditReasons: ["candidate:invalid"],
    });

    expect(result.recommendationCode).toBe("refresh-focus-checkpoint");
    expect(result.nextActionCode).toBe("refresh-focus-checkpoint");
  });

  it("returns local-audit-blocked for generic blocked conditions", () => {
    const result = resolveContextWatchContinuationRecommendation({
      ready: false,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: ["validation:invalid"],
    });

    expect(result.recommendationCode).toBe("local-audit-blocked");
    expect(result.nextActionCode).toBe("resolve-local-audit-blockers");
  });

  it("exposes stable AFK material next action codes", () => {
    withTasks([
      { id: "TASK-1", status: "planned", acceptance_criteria: ["smoke test"] },
      { id: "TASK-2", status: "planned", acceptance_criteria: ["vitest"] },
    ], (cwd) => {
      const healthy = buildAfkMaterialReadinessSnapshot(cwd, "TASK-1", 2, 3);
      expect([healthy.decision, healthy.recommendationCode, healthy.nextActionCode]).toEqual([
        "continue",
        "afk-material-continue-stock-healthy",
        "continue-bounded-afk-slice",
      ]);

      const lowStock = buildAfkMaterialReadinessSnapshot(cwd, "TASK-1", 3, 4);
      expect([lowStock.decision, lowStock.recommendationCode, lowStock.nextActionCode]).toEqual([
        "seed-backlog",
        "afk-material-seed-backlog-low-stock",
        "seed-backlog-material",
      ]);

      const blocked = buildAfkMaterialReadinessSnapshot(cwd, "TASK-3", 2, 3);
      expect([blocked.decision, blocked.recommendationCode, blocked.nextActionCode]).toEqual([
        "blocked",
        "afk-material-blocked-focus-invalid",
        "fix-focus-validation",
      ]);
    });
  });

  it("builds checkpoint packet when focus must be refreshed", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: false,
      focusTasks: "none-listed",
      staleFocusCount: 1,
      localAuditReasons: ["candidate:invalid"],
    });

    expect(packet.decision).toBe("checkpoint");
    expect(packet.reasonCode).toBe("turn-boundary-checkpoint-refresh-focus");
    expect(packet.operatorActionRequired).toBe(false);
    expect(packet.nextAutoStepCode).toBe("write-focus-checkpoint");
    expect(packet.nextAutoStep).toContain("checkpoint");
    expect(packet.directionPrompt).toBe(TURN_BOUNDARY_DIRECTION_PROMPT);
    expect(packet.directionPreview.recommendedOptionId).toBe("similar-lane");
    expect(packet.directionPreview.options.map((option) => option.id)).toEqual(["similar-lane", "next-high-value"]);
    expect(packet.directionPreview.options.map((option) => option.suitability)).toEqual(["recommended", "viable"]);
    expect(packet.summary).toContain("directionPrompt=similar-lane-or-next-value");
    expect(packet.summary).toContain("directionRecommended=similar-lane");
    expect(packet.summary).toContain("directionOptions=similar-lane:recommended,next-high-value:viable");
    expect(packet.summary).toContain("localSafeMayContinue=yes");
    expect(packet.localSafeMayContinue).toBe(true);
  });

  it("builds pause packet without operator action when local-safe next step is missing", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: false,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: ["no-local-safe-next-step"],
    });

    expect(packet.decision).toBe("pause");
    expect(packet.reasonCode).toBe("turn-boundary-pause-local-stop");
    expect(packet.operatorActionRequired).toBe(false);
    expect(packet.nextAutoStepCode).toBe("resolve-local-stop-condition");
    expect(packet.nextAutoStep).toContain("local stop condition");
    expect(packet.directionPreview.recommendedOptionId).toBe("next-high-value");
    expect(packet.directionPreview.options.map((option) => `${option.id}:${option.suitability}`)).toEqual([
      "similar-lane:blocked",
      "next-high-value:recommended",
    ]);
    expect(packet.summary).toContain("directionOptions=similar-lane:blocked,next-high-value:recommended");
    expect(packet.summary).toContain("localSafeMayContinue=no");
    expect(packet.localSafeMayContinue).toBe(false);
  });

  it("builds ask-operator packet when protected/validation blockers are present", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: false,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: ["protected-scopes:invalid", "validation:invalid"],
    });

    expect(packet.decision).toBe("ask-operator");
    expect(packet.reasonCode).toBe("turn-boundary-ask-operator-decision-required");
    expect(packet.operatorActionRequired).toBe(true);
    expect(packet.nextAutoStepCode).toBe("request-operator-decision");
    expect(packet.nextAutoStep).toContain("operator decision");
    expect(packet.directionPrompt).toBe(TURN_BOUNDARY_DIRECTION_PROMPT);
    expect(packet.directionPreview.recommendedOptionId).toBe("next-high-value");
    expect(packet.directionPreview.options.map((option) => `${option.id}:${option.suitability}`)).toEqual([
      "similar-lane:blocked",
      "next-high-value:recommended",
    ]);
    const nextLane = packet.directionPreview.options.find((option) => option.id === "next-high-value");
    expect(nextLane?.nextStep).toContain("report-only packet");
    expect(packet.summary).toContain("directionOptions=similar-lane:blocked,next-high-value:recommended");
    expect(packet.summary).toContain("localSafeMayContinue=no");
    expect(packet.localSafeMayContinue).toBe(false);
  });

  it("uses growth go signal to recommend next-high-value direction when local blockers are clear", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: [],
      growthMaturity: {
        safetyScore: 90,
        calibrationScore: 88,
        throughputScore: 86,
        simplicityScore: 87,
        debtBudgetOk: true,
        criticalBlockers: 0,
      },
    });

    expect(packet.decision).toBe("continue");
    expect(packet.nextAutoStepCode).toBe("continue-bounded-local-safe-slice");
    expect(packet.growthMaturity?.decision).toBe("go");
    expect(packet.directionPreview.recommendedOptionId).toBe("next-high-value");
    expect(packet.directionPreview.options.map((option) => `${option.id}:${option.suitability}`)).toEqual([
      "similar-lane:viable",
      "next-high-value:recommended",
    ]);
    expect(packet.summary).toContain("directionOptions=similar-lane:viable,next-high-value:recommended");
    expect(packet.summary).toContain("growthDecision=go");
  });

  it("uses handoff-style growth snapshot fallback when explicit score input is absent", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: [],
      growthMaturitySnapshot: {
        decision: "go",
        score: 89,
        recommendationCode: "growth-maturity-go-expand-bounded",
        freshness: "fresh",
      },
    });

    expect(packet.decision).toBe("continue");
    expect(packet.growthMaturity?.decision).toBe("go");
    expect(packet.growthMaturity?.score).toBe(89);
    expect(packet.growthMaturity?.recommendationCode).toBe("growth-maturity-go-expand-bounded");
    expect(packet.growthSource).toBe("handoff");
    expect(packet.growthFresh).toBe("fresh");
    expect(packet.directionPreview.recommendedOptionId).toBe("next-high-value");
    expect(packet.summary).toContain("growthDecision=go");
    expect(packet.summary).toContain("growthSource=handoff");
  });

  it("keeps direction conservative when handoff growth is go but snapshot is stale", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: [],
      growthMaturitySnapshot: {
        decision: "go",
        score: 88,
        recommendationCode: "growth-maturity-go-expand-bounded",
        freshness: "stale",
      },
    });

    expect(packet.growthMaturity?.decision).toBe("go");
    expect(packet.growthSource).toBe("handoff");
    expect(packet.growthFresh).toBe("stale");
    expect(packet.directionPreview.recommendedOptionId).toBe("similar-lane");
    expect(packet.summary).toContain("growthFresh=stale");
    expect(packet.summary).toContain("directionOptions=similar-lane:recommended,next-high-value:viable");
  });

  it("fails closed to needs-evidence when handoff snapshot lacks a valid decision", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: [],
      growthMaturitySnapshot: {
        score: 92,
        recommendationCode: "growth-maturity-go-expand-bounded",
        freshness: "stale",
      },
    });

    expect(packet.decision).toBe("continue");
    expect(packet.growthMaturity?.decision).toBe("needs-evidence");
    expect(packet.growthSource).toBe("handoff");
    expect(packet.growthFresh).toBe("stale");
    expect(packet.directionPreview.recommendedOptionId).toBe("similar-lane");
    expect(packet.nextAutoStep).toContain("growth maturity guidance=needs-evidence");
    expect(packet.summary).toContain("growthDecision=needs-evidence");
  });

  it("includes growth maturity snapshot and fail-closed needs-evidence guidance when scores are incomplete", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-1",
      staleFocusCount: 0,
      localAuditReasons: [],
      growthMaturity: {
        safetyScore: 90,
      },
    });

    expect(packet.decision).toBe("continue");
    expect(packet.growthMaturity?.decision).toBe("needs-evidence");
    expect(packet.growthMaturity?.recommendationCode).toBe("growth-maturity-needs-evidence");
    expect(packet.growthSource).toBe("explicit");
    expect(packet.directionPreview.recommendedOptionId).toBe("similar-lane");
    expect(packet.nextAutoStep).toContain("growth maturity guidance=needs-evidence");
    expect(packet.summary).toContain("growthDecision=needs-evidence");
    expect(packet.summary).toContain("growthCode=growth-maturity-needs-evidence");
  });

  it("builds a context-rich final-turn brief instead of ids-only options", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-BUD-1063",
      staleFocusCount: 0,
      localAuditReasons: [],
    });

    expect(packet.finalTurnBrief.recommendedDecision).toContain("Consolidate the current lane");
    expect(packet.finalTurnBrief.recommendedNextSteps.join("\n")).toContain("task title/context");
    for (const option of packet.finalTurnBrief.optionBriefs) {
      expect(option.title).not.toBe(option.id);
      expect(option.context.length).toBeGreaterThan(20);
      expect(option.whyItMatters.length).toBeGreaterThan(20);
      expect(option.currentState.length).toBeGreaterThan(10);
      expect(option.recommendedAction.length).toBeGreaterThan(20);
    }
    expect(packet.finalTurnBrief.optionBriefs.map((option) => option.id)).toEqual(["similar-lane", "next-high-value"]);
  });

  it("keeps continuation signal consolidated in the existing boundary packet", () => {
    const packet = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-BUD-1063",
      staleFocusCount: 0,
      localAuditReasons: [],
    }) as Record<string, unknown>;

    expect(packet.summary).toContain("localSafeMayContinue=yes");
    expect(packet.localSafeMayContinue).toBe(true);
    expect(packet.finalTurnBrief).toBeDefined();
    expect(packet.operatorBrief).toBeUndefined();
    expect(packet.continuityContract).toBeUndefined();
  });

  it("adds reload ritual only for clean runtime changes, not docs-only changes", () => {
    const runtimePacket = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-BUD-1063",
      staleFocusCount: 0,
      localAuditReasons: [],
      recentChange: { runtimeChanged: true, gitClean: true },
    });
    expect(runtimePacket.finalTurnBrief.reloadRitual.required).toBe(true);
    expect(runtimePacket.finalTurnBrief.reloadRitual.action).toContain("/reload");

    const docsPacket = buildTurnBoundaryDecisionPacket({
      ready: true,
      focusTasks: "TASK-BUD-1063",
      staleFocusCount: 0,
      localAuditReasons: [],
      recentChange: { runtimeChanged: false, docsOnly: true, gitClean: true },
    });
    expect(docsPacket.finalTurnBrief.reloadRitual.required).toBe(false);
    expect(docsPacket.finalTurnBrief.reloadRitual.reason).toContain("Only documentation changed");
  });
});
