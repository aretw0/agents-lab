import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import providerReadinessExtension, { buildProviderReadinessMatrix } from "../../extensions/provider-readiness";

function makeWorkspace(settings: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-provider-readiness-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify(settings));
  return dir;
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
