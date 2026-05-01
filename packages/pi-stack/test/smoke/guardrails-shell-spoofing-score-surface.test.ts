import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerGuardrailsShellSpoofingScoreSurface } from "../../extensions/guardrails-core-shell-spoofing-score-surface";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: unknown,
    onUpdate?: unknown,
    ctx?: { cwd: string },
  ) => { details: Record<string, unknown> };
};

function seedWorkspace(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "shell-spoofing-score-"));
  mkdirSync(path.join(cwd, "docs", "guides"), { recursive: true });
  mkdirSync(path.join(cwd, "packages", "pi-stack", "test", "smoke"), { recursive: true });

  writeFileSync(
    path.join(cwd, "docs", "guides", "control-plane-operating-doctrine.md"),
    "Evite comandos CACHE=...; echo $CACHE porque podem interpolar $VAR; prefira safe_marker_check.",
    "utf8",
  );

  const testFiles = [
    "guardrails-bash-guard-policies.test.ts",
    "guardrails-validation-method.test.ts",
    "guardrails-marker-check.test.ts",
    "guardrails-validation-method-surface.test.ts",
  ];
  for (const name of testFiles) {
    writeFileSync(path.join(cwd, "packages", "pi-stack", "test", "smoke", name), "// smoke placeholder\n", "utf8");
  }

  return cwd;
}

describe("guardrails shell spoofing score surface", () => {
  it("registers report-only shell_spoofing_coverage_score tool", () => {
    const cwd = seedWorkspace();
    const tools: RegisteredTool[] = [];
    const seeded = [
      { name: "safe_marker_check" },
      { name: "validation_method_plan" },
      { name: "tool_hygiene_scorecard" },
    ];

    registerGuardrailsShellSpoofingScoreSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
      getAllTools() { return [...seeded as any[], ...tools as any[]]; },
    } as never);

    const tool = tools.find((row) => row.name === "shell_spoofing_coverage_score");
    const result = tool?.execute("call-test", {}, undefined, undefined, { cwd });

    expect(result?.details.mode).toBe("shell-spoofing-coverage-score");
    expect(result?.details.recommendationCode).toBe("shell-spoofing-coverage-strong");
    expect(result?.details.dispatchAllowed).toBe(false);
    expect(result?.details.authorization).toBe("none");
    expect(result?.details.summary).toContain("shell-spoofing-coverage:");
  });
});
