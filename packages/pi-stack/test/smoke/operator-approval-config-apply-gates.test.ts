import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerColonyPilotToolSurface } from "../../extensions/colony-pilot-tool-surface";
import { registerContextWatchdogCheckpointBootstrapSurface } from "../../extensions/context-watchdog-checkpoint-bootstrap-surface";

describe("operator approval config apply gates", () => {
  it("blocks colony baseline apply without structured operator approval", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "colony-baseline-approval-"));
    try {
      const pi = makeMockPi();
      registerColonyPilotToolSurface(pi as never, makeColonyRuntime() as never);
      const tool = findTool(pi, "colony_pilot_baseline");

      const result = await tool.execute(
        "tc-colony-baseline-no-approval",
        { apply: true },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect(result.details?.applied).toBe(false);
      expect(result.details?.structuredOperatorApproval).toBe(false);
      expect(result.details?.blockers).toContain("structured-operator-approval-missing");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("blocks context watch bootstrap apply without structured operator approval", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-bootstrap-approval-"));
    try {
      const pi = makeMockPi();
      const applyPreset = vi.fn();
      registerContextWatchdogCheckpointBootstrapSurface(pi as never, {
        isReloadRequiredForSourceUpdate: () => false,
        applyPreset,
      });
      const tool = findTool(pi, "context_watch_bootstrap");

      const result = await tool.execute(
        "tc-context-bootstrap-no-approval",
        { apply: true, preset: "control-plane" },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect(result.details?.applied).toBe(false);
      expect(result.details?.structuredOperatorApproval).toBe(false);
      expect(result.details?.blockers).toContain("structured-operator-approval-missing");
      expect(applyPreset).not.toHaveBeenCalled();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function makeMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    getAllTools: vi.fn(() => []),
  };
}

function makeColonyRuntime() {
  return {
    state: {},
    getModelPolicyConfig: vi.fn(() => ({})),
    getBudgetPolicyConfig: vi.fn(() => ({})),
    getDeliveryPolicyConfig: vi.fn(() => ({})),
    getProviderBudgetGateCache: vi.fn(() => ({})),
    getCandidateRetentionConfig: vi.fn(() => ({})),
    getOutputPolicyConfig: vi.fn(() => ({})),
    getPreflightConfig: vi.fn(() => ({})),
    setPreflightCache: vi.fn(),
  };
}

function findTool(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = pi.registerTool.mock.calls.find(([tool]) => tool?.name === name);
  expect(call, `expected ${name} to be registered`).toBeTruthy();
  return call?.[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: { cwd: string },
    ) => Promise<{ details?: Record<string, unknown>; content?: Array<{ text?: string }> }>;
  };
}
