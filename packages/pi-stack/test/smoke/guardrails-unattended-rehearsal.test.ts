import { describe, expect, it } from "vitest";
import {
  evaluateUnattendedRehearsalGate,
  formatUnattendedRehearsalSliceEvidence,
} from "../../extensions/guardrails-core-unattended-rehearsal";

describe("guardrails unattended rehearsal gate", () => {
  it("formats compact stable slice evidence", () => {
    expect(formatUnattendedRehearsalSliceEvidence({
      slice: 2,
      focus: "TASK-BUD-172",
      gate: "cmd.exe /c npm run focal smoke",
      commit: "abc1234",
      drift: false,
      next: "slice 3",
    })).toBe("slice=2 focus=TASK-BUD-172 gate=cmd.exe-/c-npm-run-focal-smoke commit=abc1234 drift=no next=slice-3");
  });

  it("requires multiple clean local slices before remote/offload canary", () => {
    const result = evaluateUnattendedRehearsalGate({
      completedLocalSlices: 2,
      focusPreserved: true,
      focalSmokeGreen: true,
      smallCommits: true,
      handoffFresh: true,
      protectedScopeAutoSelections: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.decision).toBe("continue-local");
    expect(result.blockers).toContain("insufficient-local-slices");
    expect(result.recommendation).toContain("continue local-first");
  });

  it("allows controlled canary only after all maturity criteria are met", () => {
    const result = evaluateUnattendedRehearsalGate({
      completedLocalSlices: 3,
      focusPreserved: true,
      focalSmokeGreen: true,
      smallCommits: true,
      handoffFresh: true,
      protectedScopeAutoSelections: 0,
    });

    expect(result).toMatchObject({
      ready: true,
      decision: "ready-for-canary",
      score: 6,
      requiredScore: 6,
      blockers: [],
    });
  });

  it("blocks escalation when protected scope drift or unresolved blockers appear", () => {
    const result = evaluateUnattendedRehearsalGate({
      completedLocalSlices: 4,
      focusPreserved: true,
      focalSmokeGreen: true,
      smallCommits: true,
      handoffFresh: true,
      protectedScopeAutoSelections: 1,
      unresolvedBlockers: 1,
    });

    expect(result.ready).toBe(false);
    expect(result.decision).toBe("blocked");
    expect(result.blockers).toEqual(expect.arrayContaining([
      "protected-scope-auto-selected",
      "unresolved-blockers",
    ]));
  });
});
