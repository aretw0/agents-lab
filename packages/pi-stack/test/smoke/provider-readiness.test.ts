import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import providerReadinessExtension, { buildProviderReadinessMatrix, readProviderReadinessTailLines } from "../../extensions/provider-readiness";

function makeWorkspace(settings: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-provider-readiness-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify(settings));
  return dir;
}

function seedProviderSessionForReadiness(cwd: string, costUsd: number, model = "gpt-5.3-codex-spark"): void {
  const stamp = new Date().toISOString();
  const sessionRoot = join(cwd, ".sandbox", "pi-agent", "sessions");
  mkdirSync(sessionRoot, { recursive: true });
  const sessionFile = join(sessionRoot, "2026-06-02T00-00-00-000Z-readiness.jsonl");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({
        type: "session",
        timestamp: stamp,
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: "probe",
        },
      }),
      JSON.stringify({
        type: "message",
        provider: "openai-codex",
        model,
        timestamp: stamp,
        message: {
          role: "assistant",
          usage: {
            input: 10,
            output: 5,
            totalTokens: 15,
            cost: {
              total: costUsd,
            },
          },
        },
      }),
    ].join("\n"),
  );
}

function withProviderReadinessTelemetryIsolation<T>(cwd: string, usageCostUsd?: number, callback: () => Promise<T>): Promise<T> {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousBillingPath = process.env.PI_COPILOT_BILLING_PATH;
  const isolateDir = mkdtempSync(join(tmpdir(), "pi-provider-readiness-agent-"));

  process.env.PI_CODING_AGENT_DIR = isolateDir;
  process.env.PI_COPILOT_BILLING_PATH = join(isolateDir, "missing-billing.json");
  if (usageCostUsd !== undefined) {
    seedProviderSessionForReadiness(cwd, usageCostUsd);
  }

  const done = async (): Promise<void> => {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }

    if (previousBillingPath === undefined) {
      delete process.env.PI_COPILOT_BILLING_PATH;
    } else {
      process.env.PI_COPILOT_BILLING_PATH = previousBillingPath;
    }

    await rmSync(isolateDir, { recursive: true, force: true });
  };

  return callback().finally(done);
}

function makeMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  } as unknown as Parameters<typeof providerReadinessExtension>[0];
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

describe("provider-readiness matrix", () => {
  it("reads only a bounded session tail for runtime signals", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-provider-readiness-tail-"));
    try {
      const file = join(dir, "session.jsonl");
      writeFileSync(
        file,
        [
          JSON.stringify({ message: { provider: "openai-codex", errorMessage: "401 unauthorized" } }),
          "x".repeat(5_000),
          JSON.stringify({ message: { provider: "dashscope", errorMessage: "429 rate limit" } }),
        ].join("\n"),
      );

      const lines = readProviderReadinessTailLines(file, 1_000);
      expect(lines.join("\n")).not.toContain("unauthorized");
      expect(lines.join("\n")).toContain("rate limit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retorna unconfigured quando nenhum routeModelRef está presente", async () => {
    const dir = makeWorkspace({});
    try {
      const matrix = await buildProviderReadinessMatrix(dir);
      expect(matrix.entries).toHaveLength(0);
      expect(matrix.summary.ready).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marca provider como ready quando tem model ref e sem budget config", async () => {
    const dir = makeWorkspace({
      piStack: {
        quotaVisibility: {
          routeModelRefs: {
            "github-copilot": "github-copilot/claude-sonnet-4.6",
          },
        },
      },
    });
    try {
      const matrix = await buildProviderReadinessMatrix(dir);
      const entry = matrix.entries.find((e) => e.provider === "github-copilot");
      expect(entry).toBeDefined();
      expect(entry!.modelRef).toBe("github-copilot/claude-sonnet-4.6");
      expect(entry!.readiness).toBe("ready");
      expect(entry!.budgetState).toBe("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers model-specific budget state for configured provider/model refs", async () => {
    const dir = makeWorkspace({
      piStack: {
        quotaVisibility: {
          routeModelRefs: {
            "openai-codex": "openai-codex/gpt-5.3-codex-spark",
          },
          providerBudgets: {
            "openai-codex/gpt-5.3-codex-spark": {
              period: "weekly",
              unit: "tokens-cost",
              weeklyQuotaCostUsd: 10,
              warnPct: 70,
              hardPct: 95,
            },
            "openai-codex": {
              period: "weekly",
              unit: "tokens-cost",
              weeklyQuotaCostUsd: 1,
              warnPct: 70,
              hardPct: 95,
            },
          },
        },
      },
    });
    try {
      await withProviderReadinessTelemetryIsolation(dir, 1, async () => {
        const matrix = await buildProviderReadinessMatrix(dir);
        const entry = matrix.entries.find((e) => e.provider === "openai-codex");
        expect(entry).toBeDefined();
        expect(entry!.modelRef).toBe("openai-codex/gpt-5.3-codex-spark");
        expect(entry!.budgetState).toBe("ok");
        expect(entry!.budgetScope).toBe("provider-model");
        expect(entry!.notes).toContain("Model-specific budget state: OK.");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses provider-level caps unless a provider-model budget is configured", async () => {
    const dir = makeWorkspace({
      piStack: {
        quotaVisibility: {
          routeModelRefs: {
            "openai-codex": "openai-codex/gpt-5.3-codex-spark",
          },
          providerBudgets: {
            "openai-codex": {
              period: "weekly",
              unit: "tokens-cost",
              weeklyQuotaCostUsd: 0.001,
              warnPct: 1,
              hardPct: 1,
            },
          },
        },
      },
    });
    try {
      await withProviderReadinessTelemetryIsolation(dir, 0.002, async () => {
        const matrix = await buildProviderReadinessMatrix(dir);
        const entry = matrix.entries.find((e) => e.provider === "openai-codex");
        expect(entry).toBeDefined();
        expect(entry!.modelRef).toBe("openai-codex/gpt-5.3-codex-spark");
        expect(entry!.readiness).toBe("blocked");
        expect(entry!.budgetState).toBe("blocked");
        expect(entry!.budgetScope).toBe("provider");
        expect(entry!.notes.join("\n")).toContain("Budget state: BLOCKED");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marca provider como unconfigured quando tem budget mas não tem model ref", async () => {
    const dir = makeWorkspace({
      piStack: {
        quotaVisibility: {
          routeModelRefs: {},
          providerBudgets: {
            "openai-codex": {
              period: "monthly",
              unit: "tokens-cost",
              monthlyQuotaCostUsd: 10,
              warnPct: 70,
              hardPct: 95,
            },
          },
        },
      },
    });
    try {
      const matrix = await buildProviderReadinessMatrix(dir);
      const entry = matrix.entries.find((e) => e.provider === "openai-codex");
      expect(entry).toBeDefined();
      expect(entry!.readiness).toBe("unconfigured");
      expect(entry!.modelRef).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("provider_readiness_matrix emits summary-first content with details preserved", async () => {
    const dir = makeWorkspace({
      piStack: {
        quotaVisibility: {
          routeModelRefs: {
            "github-copilot": "github-copilot/claude-sonnet-4.6",
          },
        },
      },
    });
    try {
      const pi = makeMockPi();
      providerReadinessExtension(pi);
      const tool = getTool(pi, "provider_readiness_matrix");
      const result = await tool.execute(
        "tc-provider-readiness-matrix",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd: dir },
      );

      expect((result.details as any)?.summary?.ready).toBe(1);
      expect(String(result.content?.[0]?.text ?? "")).toContain("provider-readiness-matrix: ready=1");
      expect(String(result.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
      expect(String(result.content?.[0]?.text ?? "")).not.toContain('\"entries\"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("summary e recommendation refletem estado dos providers", async () => {
    const dir = makeWorkspace({
      piStack: {
        quotaVisibility: {
          routeModelRefs: {
            "github-copilot": "github-copilot/claude-sonnet-4.6",
            "openai-codex": "openai-codex/gpt-5.3-codex",
          },
        },
      },
    });
    try {
      const matrix = await buildProviderReadinessMatrix(dir);
      expect(matrix.summary.ready).toBe(2);
      expect(matrix.summary.blocked).toBe(0);
      expect(matrix.recommendation).toContain("ready");
      expect(matrix.generatedAtIso).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
