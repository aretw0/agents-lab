import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("human confirmation runtime wiring", () => {
  it("records trusted UI confirmation evidence for guardrails-core UI confirms without enabling overrides", () => {
    const source = readFileSync("packages/pi-stack/extensions/guardrails-core.ts", "utf8");

    expect(source).toContain("recordTrustedHumanConfirmationUiDecision");
    expect(source).toContain("appendTrustedUiConfirmationEvidence");
    expect(source).toContain("guardrails-core.human-confirmation-ui-decision");
    expect(source).toContain("canOverrideMonitorBlock: result.canOverrideMonitorBlock");
    expect(source).toContain("authorization: result.authorization");
    expect(source).toContain('scope: "outside-project-read"');
    expect(source).toContain('scope: "sensitive-path-read"');
  });
});
