import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

describe("guardrails-core structured_io_json tool", () => {
  it("registers structured_io_json tool", () => {
    const pi = makeMockPi();
    guardrailsCore(pi);
    const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([t]) => t?.name === "structured_io_json");
    expect(call).toBeTruthy();
    const tool = call?.[0] as any;
    const operationAnyOf = tool?.parameters?.properties?.operation?.anyOf ?? [];
    const operationLiterals = operationAnyOf
      .map((item: any) => item?.const)
      .filter((value: unknown) => typeof value === "string");
    expect(operationLiterals).toEqual(["read", "set", "remove"]);
  });

  it("keeps set operation dry-run by default and applies when dryRun=false", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-structured-tool-"));
    const path = join(cwd, "data.json");
    writeFileSync(path, JSON.stringify({ a: { b: 1 } }, null, 2), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
    const tool = getTool(pi, "structured_io_json");

    const dry = await tool.execute(
      "tc-1",
      { path: "data.json", selector: "a.b", operation: "set", payload: 2 },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );
    expect((dry.details as any)?.applied).toBe(false);
    expect((dry.details as any)?.reason).toBe("ok-preview");

    const unchanged = JSON.parse(readFileSync(path, "utf8"));
    expect(unchanged.a.b).toBe(1);

    const apply = await tool.execute(
      "tc-2",
      { path: "data.json", selector: "a.b", operation: "set", payload: 2, dryRun: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );
    expect((apply.details as any)?.applied).toBe(true);
    expect((apply.details as any)?.reason).toBe("ok-applied");

    const changed = JSON.parse(readFileSync(path, "utf8"));
    expect(changed.a.b).toBe(2);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("supports root selector for replacing whole JSON document", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-structured-tool-"));
    const path = join(cwd, "data.json");
    writeFileSync(path, JSON.stringify({ a: 1 }, null, 2), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
    const tool = getTool(pi, "structured_io_json");

    const apply = await tool.execute(
      "tc-root",
      { path: "data.json", selector: "$", operation: "set", payload: { b: 2 }, dryRun: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );
    expect((apply.details as any)?.applied).toBe(true);

    const changed = JSON.parse(readFileSync(path, "utf8"));
    expect(changed).toEqual({ b: 2 });

    const blocked = await tool.execute(
      "tc-root-remove",
      { path: "data.json", selector: "$", operation: "remove", dryRun: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );
    expect((blocked.details as any)?.blocked).toBe(true);
    expect((blocked.details as any)?.reason).toBe("root-remove-unsupported");

    rmSync(cwd, { recursive: true, force: true });
  });
});
