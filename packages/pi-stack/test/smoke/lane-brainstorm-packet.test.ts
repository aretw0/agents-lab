import { describe, expect, it } from "vitest";
import { rankBrainstormIdeas, scoreBrainstormIdea } from "../../extensions/lane-brainstorm-packet";

describe("lane brainstorm packet scorer", () => {
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

  it("normalizes unknown levels to medium", () => {
    const scored = scoreBrainstormIdea({ id: "idea-x", theme: "x", value: "weird", risk: "nope", effort: "unknown" });
    expect(scored.value).toBe("medium");
    expect(scored.risk).toBe("medium");
    expect(scored.effort).toBe("medium");
    expect(scored.score).toBe(0);
  });
});
