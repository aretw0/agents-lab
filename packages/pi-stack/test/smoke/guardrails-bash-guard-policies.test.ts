import { describe, expect, it } from "vitest";
import {
  BASH_GUARD_POLICIES,
  detectHighRiskPiRootRecursiveScan,
  detectHighRiskSessionLogScan,
  evaluateBashGuardPolicies,
} from "../../extensions/guardrails-core";

describe("guardrails-core bash guard policies", () => {
  it("keeps bash guard detections in the extracted policy module", () => {
    expect(BASH_GUARD_POLICIES.map((policy) => policy.id)).toEqual([
      "command-sensitive-shell-marker-check",
      "pi-root-recursive-scan",
      "session-log-scan",
    ]);

    expect(detectHighRiskSessionLogScan('grep -RIn "quota" ~/.pi/agent/sessions')).toBe(true);
    expect(detectHighRiskSessionLogScan('grep -RIl "quota" ~/.pi/agent/sessions')).toBe(false);

    expect(detectHighRiskPiRootRecursiveScan('grep -RIn "quota" .pi')).toBe(true);
    expect(detectHighRiskPiRootRecursiveScan('grep -RIl "quota" .pi')).toBe(false);

    expect(evaluateBashGuardPolicies("cmd.exe /c node -e \"const markers=['line\nline'];\"")?.id).toBe(
      "command-sensitive-shell-marker-check",
    );
    expect(evaluateBashGuardPolicies('grep -RIn "quota" ~/.pi/agent/sessions')?.id).toBe("session-log-scan");
    expect(evaluateBashGuardPolicies('grep -RIn "quota" .pi')?.id).toBe("pi-root-recursive-scan");
    expect(evaluateBashGuardPolicies("git status")).toBeUndefined();
  });
});
