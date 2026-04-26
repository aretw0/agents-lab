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

describe("guardrails-core safe mutation tools", () => {
  it("registers safe mutation tool surfaces", () => {
    const pi = makeMockPi();
    guardrailsCore(pi);

    const calls = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls;
    const names = calls.map(([tool]) => tool?.name);
    expect(names).toContain("safe_mutate_large_file");
    expect(names).toContain("structured_query_plan");

    const safeMutateTool = calls.find(([tool]) => tool?.name === "safe_mutate_large_file")?.[0] as any;
    const anchorAnyOf = safeMutateTool?.parameters?.properties?.anchorState?.anyOf ?? [];
    const anchorLiterals = anchorAnyOf
      .map((item: any) => item?.const)
      .filter((value: unknown) => typeof value === "string");
    expect(anchorLiterals).toEqual(["unique", "missing", "ambiguous"]);
  });

  it("returns deterministic large-file and query plans", async () => {
    const pi = makeMockPi();
    guardrailsCore(pi);

    const largeFileTool = getTool(pi, "safe_mutate_large_file");
    const largeFile = await largeFileTool.execute(
      "tc-safe-1",
      { touchedLines: 80, maxTouchedLines: 120, anchorState: "unique", dryRun: false, confirmed: true },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect((largeFile.details as any)?.applied).toBe(true);
    expect((largeFile.details as any)?.decision).toBe("allow-apply");

    const queryTool = getTool(pi, "structured_query_plan");
    const query = await queryTool.execute(
      "tc-safe-2",
      { query: "DELETE FROM tasks", forbidMutation: true },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect((query.details as any)?.blocked).toBe(true);
    expect((query.details as any)?.reason).toBe("blocked:mutation-forbidden");
  });
});
