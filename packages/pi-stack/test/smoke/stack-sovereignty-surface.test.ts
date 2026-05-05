import { describe, expect, it, vi } from "vitest";
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
});
