import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("human confirmation runtime wiring", () => {
  it("records trusted UI confirmation evidence for guardrails-core UI confirms without enabling overrides", () => {
    const auditSource = readFileSync("packages/pi-stack/extensions/guardrails-core-confirmation-audit.ts", "utf8");
    const readRuntimeSource = readFileSync("packages/pi-stack/extensions/guardrails-core-read-path-runtime.ts", "utf8");

    expect(auditSource).toContain("recordTrustedHumanConfirmationUiDecision");
    expect(auditSource).toContain("appendTrustedUiConfirmationEvidence");
    expect(auditSource).toContain("guardrails-core.human-confirmation-ui-decision");
    expect(auditSource).toContain("canOverrideMonitorBlock: result.canOverrideMonitorBlock");
    expect(auditSource).toContain("authorization: result.authorization");
    expect(readRuntimeSource).toContain('scope: "outside-project-read"');
    expect(readRuntimeSource).toContain('scope: "sensitive-path-read"');
  });
});
