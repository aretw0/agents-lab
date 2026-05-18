import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import handoffAdvisorExtension from "../../extensions/handoff-advisor";
import quotaVisibilityExtension from "../../extensions/quota-visibility";

describe("operator approval route gates", () => {
  it("blocks handoff advisor model switches without structured approval", async () => {
    const cwd = mkdtempProject("handoff-approval-");
    try {
      const setModel = vi.fn(async () => true);
      const pi = registerExtension(handoffAdvisorExtension, setModel);
      const tool = findTool(pi, "handoff_advisor");

      const result = await tool.execute(
        "tc-handoff-no-approval",
        { execute: true },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd, modelRegistry: { find: vi.fn() } },
      );

      expect(result.details?.structuredOperatorApproval).toBe(false);
      expect(result.details?.blockers).toContain("structured-operator-approval-missing");
      expect(setModel).not.toHaveBeenCalled();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("blocks quota route model switches without structured approval", async () => {
    const cwd = mkdtempProject("quota-route-approval-");
    try {
      const setModel = vi.fn(async () => true);
      const pi = registerExtension(quotaVisibilityExtension, setModel);
      const tool = findTool(pi, "quota_visibility_route");

      const result = await tool.execute(
        "tc-quota-route-no-approval",
        { execute: true },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd, modelRegistry: { find: vi.fn() } },
      );

      expect(result.details?.structuredOperatorApproval).toBe(false);
      expect(result.details?.blockers).toContain("structured-operator-approval-missing");
      expect(setModel).not.toHaveBeenCalled();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function mkdtempProject(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  return cwd;
}

function registerExtension(register: (pi: never) => void, setModel: ReturnType<typeof vi.fn>) {
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    setModel,
  };
  register(pi as never);
  return pi;
}

function findTool(pi: ReturnType<typeof registerExtension>, name: string) {
  const call = pi.registerTool.mock.calls.find(([tool]) => tool?.name === name);
  expect(call, `expected ${name} to be registered`).toBeTruthy();
  return call?.[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: { cwd: string; modelRegistry: { find: ReturnType<typeof vi.fn> } },
    ) => Promise<{ details?: Record<string, unknown>; content?: Array<{ text?: string }> }>;
  };
}
