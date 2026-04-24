import { describe, expect, it } from "vitest";
import {
  buildBehaviorRouteSystemPrompt,
  classifyBehaviorRoute,
} from "../../extensions/guardrails-core-behavior-routing";

describe("guardrails-core behavior routing", () => {
  it("selects github skill for PR/issues workflow prompts", () => {
    const decision = classifyBehaviorRoute(
      "check GitHub pull request status and open issue for failing actions workflow",
    );

    expect(decision.kind).toBe("matched");
    expect(decision.match?.skill).toBe("github");
    expect((decision.match?.score ?? 0) >= 2).toBe(true);
  });

  it("selects web-browser for web automation prompts", () => {
    const decision = classifyBehaviorRoute(
      "open web page, click login and capture screenshot for evidence",
    );

    expect(decision.kind).toBe("matched");
    expect(decision.match?.skill).toBe("web-browser");
  });

  it("selects pi-project for board/.project prompts", () => {
    const decision = classifyBehaviorRoute(
      "update .project tasks.json and verification.json with board notes",
    );

    expect(decision.kind).toBe("matched");
    expect(decision.match?.skill).toBe("pi-project");
  });

  it("keeps safe fallback when confidence is low", () => {
    const decision = classifyBehaviorRoute("hello there");
    expect(decision.kind).toBe("none");
    expect(decision.match).toBeUndefined();
  });

  it("builds deterministic system prompt lines for selected skill", () => {
    const lines = buildBehaviorRouteSystemPrompt({
      skill: "github",
      score: 5,
      confidence: "high",
      reasons: ["github", "pull request"],
    });

    expect(lines.join("\n")).toContain("selected_skill: github");
    expect(lines.join("\n")).toContain("confidence=high");
    expect(lines.join("\n")).toContain("fallback");
  });
});
