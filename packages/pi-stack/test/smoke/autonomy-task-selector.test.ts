import { describe, expect, it } from "vitest";
import { selectAutonomyLaneTask } from "../../extensions/guardrails-core-autonomy-task-selector";
import type { ProjectTaskItem } from "../../extensions/colony-pilot-task-sync";

function task(partial: Partial<ProjectTaskItem> & { id: string }): ProjectTaskItem {
  return {
    id: partial.id,
    description: partial.description ?? "[P2] task",
    status: partial.status ?? "planned",
    depends_on: partial.depends_on,
    files: partial.files,
    milestone: partial.milestone,
  };
}

describe("autonomy task selector", () => {
  it("prefers in-progress work over planned work, then priority and id", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-P0-PLANNED", description: "[P0] planned", status: "planned" }),
      task({ id: "TASK-P1-A", description: "[P1] in progress a", status: "in-progress" }),
      task({ id: "TASK-P0-INPROG", description: "[P0] in progress", status: "in-progress" }),
    ]);

    expect(result.ready).toBe(true);
    expect(result.nextTaskId).toBe("TASK-P0-INPROG");
    expect(result.selectionPolicy).toContain("status(in-progress>planned)");
  });

  it("requires dependencies to be completed", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-A", status: "planned", depends_on: ["TASK-MISSING"] }),
      task({ id: "TASK-B", status: "planned", description: "[P2] fallback" }),
    ]);

    expect(result.nextTaskId).toBe("TASK-B");
    expect(result.totals.blockedByDependencies).toBe(1);
  });

  it("skips protected scopes by default for unattended lanes", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-CI", status: "in-progress", description: "[P0] update ci", files: [".github/workflows/test.yml"] }),
      task({ id: "TASK-LOCAL", status: "planned", description: "[P1] local gate" }),
      task({ id: "TASK-SETTINGS", status: "planned", description: "[P0] settings", files: [".pi/settings.json"] }),
    ]);

    expect(result.ready).toBe(true);
    expect(result.nextTaskId).toBe("TASK-LOCAL");
    expect(result.totals.skippedProtectedScope).toBe(2);
  });

  it("treats GitHub Actions and remote execution as protected autonomy scope", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-ACTIONS", status: "planned", description: "[P0] introduce GitHub Actions remote compute" }),
      task({ id: "TASK-LOCAL", status: "planned", description: "[P1] local unattended loop" }),
    ]);

    expect(result.nextTaskId).toBe("TASK-LOCAL");
    expect(result.totals.skippedProtectedScope).toBe(1);
  });

  it("treats research and external influence tasks as protected autonomy scope", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-RESEARCH", status: "planned", description: "[P1] avaliar influência de https://example.com" }),
      task({ id: "TASK-LOCAL", status: "planned", description: "[P2] local unattended loop" }),
    ]);

    expect(result.nextTaskId).toBe("TASK-LOCAL");
    expect(result.totals.skippedProtectedScope).toBe(1);
  });

  it("can include protected scopes only when explicitly authorized", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-CI", status: "planned", description: "[P0] update ci", files: [".github/workflows/test.yml"] }),
      task({ id: "TASK-LOCAL", status: "planned", description: "[P1] local gate" }),
    ], { includeProtectedScopes: true });

    expect(result.nextTaskId).toBe("TASK-CI");
    expect(result.selectionPolicy).toContain("protected-scopes-included");
  });

  it("skips rationale-sensitive tasks that lack rationale evidence by default", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-HARDEN", status: "in-progress", description: "[P0] hardening slice", notes: "validated with smoke" }),
      task({ id: "TASK-LOCAL", status: "planned", description: "[P1] local gate" }),
    ]);

    expect(result.nextTaskId).toBe("TASK-LOCAL");
    expect(result.totals.skippedMissingRationale).toBe(1);
    expect(result.selectionPolicy).toContain("missing-rationale-skipped");
  });

  it("can include missing-rationale tasks only when explicitly authorized", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-HARDEN", status: "in-progress", description: "[P0] hardening slice", notes: "validated with smoke" }),
      task({ id: "TASK-LOCAL", status: "planned", description: "[P1] local gate" }),
    ], { includeMissingRationale: true });

    expect(result.nextTaskId).toBe("TASK-HARDEN");
    expect(result.selectionPolicy).toContain("missing-rationale-included");
  });

  it("respects focus task ids before drifting to unrelated eligible work", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-OTHER", status: "planned", description: "[P0] outside focus" }),
      task({ id: "TASK-FOCUS", status: "planned", description: "[P2] focused local" }),
    ], { focusTaskIds: ["TASK-FOCUS"], focusSource: "explicit" });

    expect(result.ready).toBe(true);
    expect(result.nextTaskId).toBe("TASK-FOCUS");
    expect(result.totals.skippedFocusMismatch).toBe(1);
    expect(result.selectionPolicy).toContain("focus(explicit:TASK-FOCUS)");
  });

  it("reports completed focus before selecting a new unrelated task", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-OTHER", status: "planned", description: "[P0] outside focus" }),
      task({ id: "TASK-FOCUS", status: "completed", description: "[P1] done" }),
    ], { focusTaskIds: ["TASK-FOCUS"], focusSource: "handoff" });

    expect(result.ready).toBe(false);
    expect(result.reason).toBe("focus-complete");
    expect(result.nextTaskId).toBeUndefined();
    expect(result.recommendation).toContain("choose the next focus explicitly");
  });

  it("blocks unrelated eligible work when focus has no eligible task", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-OTHER", status: "planned", description: "[P0] outside focus" }),
      task({ id: "TASK-BLOCKED", status: "planned", description: "[P1] blocked focus", depends_on: ["TASK-MISSING"] }),
    ], { focusTaskIds: ["TASK-BLOCKED"], focusSource: "handoff" });

    expect(result.ready).toBe(false);
    expect(result.reason).toBe("focus-mismatch");
    expect(result.nextTaskId).toBeUndefined();
    expect(result.recommendation).toContain("do not drift");
  });

  it("filters by milestone", () => {
    const result = selectAutonomyLaneTask([
      task({ id: "TASK-A", milestone: "later", status: "planned" }),
      task({ id: "TASK-B", milestone: "now", status: "planned" }),
    ], { milestone: "now" });

    expect(result.nextTaskId).toBe("TASK-B");
    expect(result.milestone).toBe("now");
  });
});
