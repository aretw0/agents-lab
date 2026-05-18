import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operator confirmation runtime wiring", () => {
  it("records trusted UI confirmation evidence for guardrails-core UI confirms without enabling overrides", () => {
    const auditSource = readFileSync("packages/pi-stack/extensions/guardrails-core-confirmation-audit.ts", "utf8");
    const readRuntimeSource = readFileSync("packages/pi-stack/extensions/guardrails-core-read-path-runtime.ts", "utf8");

    expect(auditSource).toContain("recordTrustedOperatorConfirmationUiDecision");
    expect(auditSource).toContain("appendTrustedUiConfirmationEvidence");
    expect(auditSource).toContain("guardrails-core.operator-confirmation-ui-decision");
    expect(auditSource).toContain("canOverrideMonitorBlock: result.canOverrideMonitorBlock");
    expect(auditSource).toContain("authorization: result.authorization");
    expect(readRuntimeSource).toContain('scope: "outside-project-read"');
    expect(readRuntimeSource).toContain('scope: "sensitive-path-read"');
    expect(readRuntimeSource).toContain("STRUCTURED_STATE_READ_REDIRECTS");
    expect(readRuntimeSource).toContain("é estado estruturado");
    expect(readRuntimeSource).toContain("agent_run_status, agent_run_log_tail, agent_run_follow ou agent_run_outcome_packet");
  });
});
