import { describe, expect, it } from "vitest";
import {
  buildLaneBrainstormPacket,
  buildLaneBrainstormSeedPreview,
  rankBrainstormIdeas,
  scoreBrainstormIdea,
} from "../../extensions/lane-brainstorm-packet";

describe("lane brainstorm packet module", () => {
  it("scores and ranks ideas by value/risk/effort", () => {
    const ranked = rankBrainstormIdeas([
      { id: "idea-a", theme: "a", value: "high", risk: "low", effort: "low" },
      { id: "idea-b", theme: "b", value: "medium", risk: "high", effort: "high" },
      { id: "idea-c", theme: "c", value: "high", risk: "medium", effort: "medium" },
    ]);

    expect(ranked.map((item) => item.id)).toEqual(["idea-a", "idea-c", "idea-b"]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? -999);
  });

  it("uses deterministic tie-breakers", () => {
    const ranked = rankBrainstormIdeas([
      { id: "idea-z", theme: "z", value: "medium", risk: "medium", effort: "medium" },
      { id: "idea-a", theme: "a", value: "medium", risk: "medium", effort: "medium" },
    ]);

    expect(ranked.map((item) => item.id)).toEqual(["idea-a", "idea-z"]);
  });

  it("deduplicates by id and respects maxItems", () => {
    const ranked = rankBrainstormIdeas([
      { id: "idea-a", theme: "a1", value: "high", risk: "low", effort: "low" },
      { id: "idea-a", theme: "a2", value: "low", risk: "high", effort: "high" },
      { id: "idea-b", theme: "b", value: "high", risk: "low", effort: "low" },
    ], 1);

    expect(ranked).toHaveLength(1);
    expect(new Set(ranked.map((item) => item.id)).size).toBe(1);
  });

  it("clips max ideas to deterministic upper bound", () => {
    const ideas = Array.from({ length: 70 }, (_, idx) => ({
      id: `idea-${idx + 1}`,
      theme: `theme-${idx + 1}`,
      value: "medium" as const,
      risk: "medium" as const,
      effort: "medium" as const,
    }));
    const ranked = rankBrainstormIdeas(ideas, 999);
    expect(ranked).toHaveLength(50);
  });

  it("normalizes unknown levels to medium", () => {
    const scored = scoreBrainstormIdea({ id: "idea-x", theme: "x", value: "weird", risk: "nope", effort: "unknown" });
    expect(scored.value).toBe("medium");
    expect(scored.risk).toBe("medium");
    expect(scored.effort).toBe("medium");
    expect(scored.score).toBe(0);
  });

  it("builds ready packet with report-only invariants", () => {
    const packet = buildLaneBrainstormPacket({
      goal: "desinflar",
      ideas: [{ id: "idea-a", theme: "dedupe", value: "high", risk: "low", effort: "low" }],
      maxIdeas: 5,
      maxSlices: 1,
      selection: {
        ready: true,
        recommendationCode: "execute-bounded-slice",
        recommendation: "execute bounded slice for TASK-1",
        eligibleTaskIds: ["TASK-1"],
      },
    });

    expect(packet.decision).toBe("ready-for-human-review");
    expect(packet.recommendationCode).toBe("seed-local-safe-lane");
    expect(packet.dispatchAllowed).toBe(false);
    expect(packet.mutationAllowed).toBe(false);
    expect(packet.authorization).toBe("none");
    expect(packet.mode).toBe("report-only");
    expect(packet.selectedSlices).toHaveLength(1);
  });

  it("falls back to eligible task slices when ideas are invalid", () => {
    const packet = buildLaneBrainstormPacket({
      ideas: [{ id: "", theme: "" }],
      maxSlices: 99,
      selection: {
        ready: true,
        recommendationCode: "execute-bounded-slice",
        recommendation: "execute bounded slice",
        eligibleTaskIds: ["TASK-1", "TASK-2", "TASK-3"],
      },
    });

    expect(packet.selectedSlices).toHaveLength(3);
    expect(packet.selectedSlices[0]?.sourceTaskId).toBe("TASK-1");
  });

  it("builds visible seeding preview that always requires human confirmation", () => {
    const packet = buildLaneBrainstormPacket({
      ideas: [{ id: "idea-a", theme: "dedupe outputs", value: "high", risk: "low", effort: "low" }],
      maxSlices: 1,
      selection: {
        ready: true,
        recommendationCode: "execute-bounded-slice",
        recommendation: "execute bounded slice",
        eligibleTaskIds: ["TASK-1"],
      },
    });

    const preview = buildLaneBrainstormSeedPreview({ packet, source: "human" });

    expect(preview.decision).toBe("needs-human-seeding-decision");
    expect(preview.recommendationCode).toBe("brainstorm-seeding-preview");
    expect(preview.nextAction).toContain("review proposals");
    expect(preview.confirmationRequired).toBe(true);
    expect(preview.dispatchAllowed).toBe(false);
    expect(preview.mutationAllowed).toBe(false);
    expect(preview.authorization).toBe("none");
    expect(preview.mode).toBe("report-only");
    expect(preview.proposals).toHaveLength(1);
    expect(preview.source).toBe("human");
  });

  it("keeps seeding preview blocked when brainstorm packet is blocked", () => {
    const packet = buildLaneBrainstormPacket({
      selection: {
        ready: false,
        recommendationCode: "local-stop-protected-focus-required",
        recommendation: "local stop condition",
        eligibleTaskIds: [],
      },
    });

    const preview = buildLaneBrainstormSeedPreview({ packet });
    expect(preview.decision).toBe("blocked");
    expect(preview.recommendationCode).toBe("brainstorm-seeding-blocked");
    expect(preview.nextAction).toBe(packet.nextAction);
    expect(preview.proposals).toHaveLength(0);
    expect(preview.confirmationRequired).toBe(true);
  });
});
