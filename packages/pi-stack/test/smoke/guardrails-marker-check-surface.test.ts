import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerGuardrailsMarkerCheckSurface } from "../../extensions/guardrails-core-marker-check-surface";

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, ctx?: { cwd: string }) => { details: Record<string, unknown> };
};

describe("guardrails marker check surface", () => {
  it("checks project files without shell quoting", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "marker-check-surface-"));
    mkdirSync(path.join(cwd, "docs"), { recursive: true });
    writeFileSync(path.join(cwd, "docs", "guide.md"), "Manutenção do repositório Git\n", "utf8");

    const tools: RegisteredTool[] = [];
    registerGuardrailsMarkerCheckSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const tool = tools.find((item) => item.name === "safe_marker_check");
    const result = tool?.execute("call-test", {
      path: "docs/guide.md",
      markers: ["manutencao do repositorio git"],
      normalize_accents: true,
      case_sensitive: false,
    }, undefined, undefined, { cwd });

    expect(result?.details.ok).toBe(true);
    expect(result?.details.summary).toBe("marker-check: ok=yes matched=1/1 missing=none commandSensitive=none");
  });

  it("blocks paths outside the workspace", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "marker-check-path-"));
    const tools: RegisteredTool[] = [];
    registerGuardrailsMarkerCheckSurface({
      registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    } as never);

    const tool = tools.find((item) => item.name === "safe_marker_check");
    const result = tool?.execute("call-test", {
      path: "../outside.md",
      markers: ["anything"],
    }, undefined, undefined, { cwd });

    expect(result?.details.ok).toBe(false);
    expect(result?.details.error).toBe("path-outside-workspace-or-empty");
  });
});
