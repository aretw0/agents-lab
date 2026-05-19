import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import stackSovereigntyExtension from "../../extensions/stack-sovereignty";

function makeWorkspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), "stack-sovereignty-surface-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ packages: [{ source: "C:/repo/packages/pi-stack" }] }, null, 2),
    "utf8",
  );
  return cwd;
}

function makeMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  } as unknown as Parameters<typeof stackSovereigntyExtension>[0];
}

function makeQualityWorkspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), "stack-quality-surface-"));
  mkdirSync(join(cwd, "docs", "research", "data", "run", "raw"), { recursive: true });
  mkdirSync(join(cwd, "docs", "guides"), { recursive: true });
  writeFileSync(join(cwd, "large.ts"), "one\ntwo\nthree\nfour", "utf8");
  writeFileSync(join(cwd, "docs", "research", "data", "run", "raw", "a.log"), "raw", "utf8");
  writeFileSync(join(cwd, "docs", "guides", "control-plane-glossary.md"), "Decision packet for human approval.", "utf8");
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  return cwd;
}

function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
    ([tool]) => tool?.name === name,
  );
  if (!call) throw new Error(`tool not found: ${name}`);
  return call[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: { cwd: string },
    ) => Promise<{ content?: Array<{ text?: string }>; details?: Record<string, unknown> }>;
  };
}

describe("stack sovereignty surface", () => {
  it("stack_sovereignty_status emits summary-first content with details preserved", async () => {
    const cwd = makeWorkspace();
    try {
      const pi = makeMockPi();
      stackSovereigntyExtension(pi);
      const tool = getTool(pi, "stack_sovereignty_status");
      const result = await tool.execute(
        "tc-stack-sovereignty-status",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect((result.details as any)?.summary).toBeTruthy();
      expect((result.details as any)?.schedulerGovernance?.snapshot).toBeTruthy();
      expect(String(result.content?.[0]?.text ?? "")).toContain("stack-sovereignty:");
      expect(String(result.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
      expect(String(result.content?.[0]?.text ?? "")).not.toContain('\"capabilities\"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("stack_quality_audit exposes distributed quality gates", async () => {
    const cwd = makeQualityWorkspace();
    try {
      const pi = makeMockPi();
      stackSovereigntyExtension(pi);
      const tool = getTool(pi, "stack_quality_audit");
      const result = await tool.execute(
        "tc-stack-quality-audit",
        { maxLines: 3 },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      const details = result.details as any;
      expect(details.summary.complexityBlocking).toBe(1);
      expect(details.summary.bloatViolations).toBe(1);
      expect(details.summary.discourseFindings).toBe(1);
      expect(String(result.content?.[0]?.text ?? "")).toContain("stack-quality:");
      expect(String(result.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("stack_quality_audit reports subaudit errors without crashing outside git workspaces", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stack-quality-no-git-"));
    try {
      const pi = makeMockPi();
      stackSovereigntyExtension(pi);
      const tool = getTool(pi, "stack_quality_audit");
      const result = await tool.execute(
        "tc-stack-quality-no-git",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      const details = result.details as any;
      expect(details.summary.errors).toBeGreaterThan(0);
      expect(details.errors[0].audit).toBeTruthy();
      expect(String(result.content?.[0]?.text ?? "")).toContain("errors=");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
