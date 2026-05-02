import { describe, expect, it } from "vitest";
import {
  BASH_GUARD_POLICIES,
  detectHighRiskPiRootRecursiveScan,
  detectHighRiskSessionLogScan,
  detectHighRiskWideDuScan,
  detectHighRiskWideFindScan,
  detectHighRiskWideRecursiveLsScan,
  detectSourceMapBlastRadiusScan,
  detectUpstreamPiPackageMutation,
  evaluateBashGuardPolicies,
  isUpstreamPiPackagePath,
} from "../../extensions/guardrails-core";

describe("guardrails-core bash guard policies", () => {
  it("keeps bash guard detections in the extracted policy module", () => {
    expect(BASH_GUARD_POLICIES.map((policy) => policy.id)).toEqual([
      "command-sensitive-shell-marker-check",
      "upstream-pi-package-mutation",
      "source-map-blast-radius-scan",
      "wide-du-scan",
      "wide-find-scan",
      "wide-recursive-ls-scan",
      "pi-root-recursive-scan",
      "session-log-scan",
    ]);

    expect(detectHighRiskSessionLogScan('grep -RIn "quota" ~/.pi/agent/sessions')).toBe(true);
    expect(detectHighRiskSessionLogScan('grep -RIl "quota" ~/.pi/agent/sessions')).toBe(false);

    expect(detectHighRiskPiRootRecursiveScan('grep -RIn "quota" .pi')).toBe(true);
    expect(detectHighRiskPiRootRecursiveScan('grep -RIl "quota" .pi')).toBe(false);

    expect(detectUpstreamPiPackageMutation("rm -rf node_modules/@mariozechner/pi-coding-agent/dist")).toBe(true);
    expect(detectUpstreamPiPackageMutation("echo patch > node_modules/@mariozechner/pi-coding-agent/dist/cli.js")).toBe(true);
    expect(detectUpstreamPiPackageMutation("grep -n app.interrupt node_modules/@mariozechner/pi-coding-agent/dist/core/keybindings.js")).toBe(false);
    expect(isUpstreamPiPackagePath("node_modules/@mariozechner/pi-coding-agent/dist/cli.js", "/repo")).toBe(true);
    expect(isUpstreamPiPackagePath("node_modules/@davidorex/pi-project-workflows/index.js", "/repo")).toBe(false);

    expect(detectHighRiskWideDuScan("du -sh")).toBe(true);
    expect(detectHighRiskWideDuScan("du -sh .")).toBe(true);
    expect(detectHighRiskWideDuScan("du -sh / 2>/dev/null")).toBe(true);
    expect(detectHighRiskWideDuScan("du -sh .git .tmp")).toBe(false);
    expect(detectHighRiskWideDuScan("du -h --max-depth=1 .")).toBe(false);

    expect(detectHighRiskWideFindScan("find . -type f")).toBe(true);
    expect(detectHighRiskWideFindScan("find / -name '*.log'")).toBe(true);
    expect(detectHighRiskWideFindScan("find .project -type f")).toBe(false);
    expect(detectHighRiskWideFindScan("find . -maxdepth 2 -type f")).toBe(false);

    expect(detectHighRiskWideRecursiveLsScan("ls -R")).toBe(true);
    expect(detectHighRiskWideRecursiveLsScan("ls -R .")).toBe(true);
    expect(detectHighRiskWideRecursiveLsScan("ls -R .project")).toBe(false);

    expect(detectSourceMapBlastRadiusScan('grep -RIn "sourceContent" node_modules')).toBe(true);
    expect(detectSourceMapBlastRadiusScan('grep -RIn --exclude="*.map" "sourceContent" node_modules')).toBe(false);
    expect(detectSourceMapBlastRadiusScan('rg -n "sourceContent" node_modules -g "!*.map"')).toBe(false);
    expect(detectSourceMapBlastRadiusScan('grep -n "sourceContent" node_modules/pkg/dist/index.js.map')).toBe(true);
    expect(detectSourceMapBlastRadiusScan('grep -RIl "sourceContent" node_modules')).toBe(false);

    expect(evaluateBashGuardPolicies("cmd.exe /c node -e \"const markers=['line\nline'];\"")?.id).toBe(
      "command-sensitive-shell-marker-check",
    );
    expect(evaluateBashGuardPolicies('grep -RIn "quota" ~/.pi/agent/sessions')?.id).toBe("session-log-scan");
    expect(evaluateBashGuardPolicies('grep -RIn "quota" .pi')?.id).toBe("pi-root-recursive-scan");
    expect(evaluateBashGuardPolicies('grep -RIn "sourceContent" node_modules')?.id).toBe("source-map-blast-radius-scan");
    expect(evaluateBashGuardPolicies("du -sh .")?.id).toBe("wide-du-scan");
    expect(evaluateBashGuardPolicies("du -sh .git .tmp")).toBeUndefined();
    expect(evaluateBashGuardPolicies("find . -type f")?.id).toBe("wide-find-scan");
    expect(evaluateBashGuardPolicies("find .project -type f")).toBeUndefined();
    expect(evaluateBashGuardPolicies("ls -R .")?.id).toBe("wide-recursive-ls-scan");
    expect(evaluateBashGuardPolicies("ls -R .project")).toBeUndefined();
    expect(evaluateBashGuardPolicies("rm -rf node_modules/@mariozechner/pi-coding-agent/dist")?.id).toBe("upstream-pi-package-mutation");
    expect(evaluateBashGuardPolicies("git status")).toBeUndefined();
  });
});
