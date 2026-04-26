import { describe, expect, it, vi } from "vitest";
import guardrailsCore from "../../extensions/guardrails-core";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    sendUserMessage: vi.fn(),
  } as unknown as Parameters<typeof guardrailsCore>[0];
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
      ctx: any,
    ) => Promise<{ details?: Record<string, unknown> }>;
  };
}

describe("guardrails-core macro-refactor tools", () => {
  it("registers macro refactor tools and command", () => {
    const pi = makeMockPi();
    guardrailsCore(pi);

    const tools = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([t]) => t?.name);
    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(([name]) => name);

    expect(tools).toContain("refactor_rename_symbol");
    expect(tools).toContain("refactor_organize_imports");
    expect(tools).toContain("refactor_format_target");
    expect(commands).toContain("macro-refactor");
  });

  it("returns deterministic fallback when apply is requested", async () => {
    const pi = makeMockPi();
    guardrailsCore(pi);
    const renameTool = getTool(pi, "refactor_rename_symbol");

    const result = await renameTool.execute(
      "tc-rename-1",
      { symbol: "OldName", to: "NewName", scope: "workspace", dryRun: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect((result.details as any)?.operation).toBe("refactor_rename_symbol");
    expect((result.details as any)?.reason).toBe("engine-unavailable");
    expect((result.details as any)?.supported).toBe(false);
    expect((result.details as any)?.applied).toBe(false);
  });
});
