import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import contextWatchdogExtension from "../../extensions/context-watchdog";
import { registerGuardrailsAutonomyLaneSurface } from "../../extensions/guardrails-core-autonomy-lane-surface";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  } as const;
}

function getRegisteredTool(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === name);
  if (!call) throw new Error(`tool not found: ${name}`);
  return call[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: (update: unknown) => void,
      ctx?: { cwd: string },
    ) => Promise<{ details?: Record<string, unknown>; content?: Array<{ text?: string }> }> | { details?: Record<string, unknown>; content?: Array<{ text?: string }> };
  };
}

describe("control-plane recommendation contract", () => {
  it("autonomy_lane_status exposes stable recommendationCode/nextAction for protected-only local stop", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ctrl-plane-rec-autonomy-"));
    try {
      mkdirSync(path.join(cwd, ".project"), { recursive: true });
      writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({
        tasks: [
          { id: "TASK-PROTECTED", description: "[P0] revisar colony promotion candidate", status: "planned" },
        ],
      }), "utf8");

      const pi = makeMockPi();
      registerGuardrailsAutonomyLaneSurface(pi as never);
      const tool = getRegisteredTool(pi, "autonomy_lane_status");
      const result = tool.execute("tc-autonomy-status", {}, undefined, undefined, { cwd }) as { details?: Record<string, unknown> };

      expect(result.details?.ready).toBe(false);
      expect(result.details?.recommendationCode).toBe("local-stop-protected-focus-required");
      expect(typeof result.details?.nextAction).toBe("string");
      expect((result.details?.nextAction as string).length).toBeGreaterThan(10);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("context_watch_continuation_readiness emits structured recommendation fields", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ctrl-plane-rec-context-"));
    try {
      mkdirSync(path.join(cwd, ".project"), { recursive: true });
      writeFileSync(path.join(cwd, ".project", "handoff.json"), JSON.stringify({
        timestamp: new Date().toISOString(),
        current_tasks: ["TASK-PROTECTED"],
        blockers: [],
      }), "utf8");
      writeFileSync(path.join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [
        { id: "TASK-PROTECTED", status: "in-progress", description: "Protected lane", files: [".github/workflows/ci.yml"] },
      ] }), "utf8");

      const pi = makeMockPi();
      contextWatchdogExtension(pi as never);
      const tool = getRegisteredTool(pi, "context_watch_continuation_readiness");
      const result = await tool.execute("tc-context-readiness", {}, undefined as unknown as AbortSignal, () => {}, { cwd }) as { details?: Record<string, unknown> };

      const code = result.details?.recommendationCode;
      expect(typeof code).toBe("string");
      expect([
        "local-stop-no-local-safe-next-step",
        "refresh-focus-checkpoint",
        "local-audit-blocked",
        "continue-local",
      ]).toContain(code);
      expect(typeof result.details?.nextAction).toBe("string");
      expect((result.details?.nextAction as string).length).toBeGreaterThan(10);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("project_intake_plan keeps concise decision payload with explicit guardrails", () => {
    const pi = makeMockPi();
    registerGuardrailsAutonomyLaneSurface(pi as never);
    const tool = getRegisteredTool(pi, "project_intake_plan");

    const result = tool.execute("tc-intake", {
      dominant_artifacts: Array.from({ length: 100 }, (_, i) => `artifact-${i + 1}-${"x".repeat(50)}`),
      has_build_files: true,
      has_tests: true,
      has_ci: true,
      repository_scale: "large",
    }) as { details?: Record<string, unknown>; content?: Array<{ text?: string }> };

    expect(result.details?.recommendationCode).toBe("intake-plan-first-slice");
    expect((result.details?.nextAction as string).length).toBeLessThanOrEqual(140);
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.mutationAllowed).toBe(false);
    expect(result.details?.authorization).toBe("none");
    expect((result.content?.[0]?.text ?? "").length).toBeLessThanOrEqual(1200);
  });
});
