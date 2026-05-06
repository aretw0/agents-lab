import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeHandoffScore,
  isAvailable,
  selectNextProvider,
  resolveHandoffModelRef,
  buildHandoffAdvisory,
  type ProviderHandoffScore,
} from "../../extensions/handoff-advisor";

describe("handoff-advisor — computeHandoffScore", () => {
  it("ok + ready = 0 (melhor possivel)", () => {
    expect(computeHandoffScore("ok", "ready")).toBe(0);
  });

  it("blocked em qualquer dimensao = alto score", () => {
    expect(computeHandoffScore("blocked", "ready")).toBeGreaterThanOrEqual(10);
    expect(computeHandoffScore("ok", "blocked")).toBeGreaterThanOrEqual(10);
  });

  it("warning + ready < blocked + ready", () => {
    expect(computeHandoffScore("warning", "ready")).toBeLessThan(computeHandoffScore("blocked", "ready"));
  });

  it("ok + degraded < ok + blocked", () => {
    expect(computeHandoffScore("ok", "degraded")).toBeLessThan(computeHandoffScore("ok", "blocked"));
  });

  it("unknown + unconfigured = score intermediario", () => {
    const s = computeHandoffScore("unknown", "unconfigured");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(20);
  });
});

describe("handoff-advisor — isAvailable", () => {
  it("ok + ready = disponivel", () => {
    expect(isAvailable("ok", "ready")).toBe(true);
  });

  it("warning + ready = disponivel (ainda usavel)", () => {
    expect(isAvailable("warning", "ready")).toBe(true);
  });

  it("blocked + ready = nao disponivel", () => {
    expect(isAvailable("blocked", "ready")).toBe(false);
  });

  it("ok + blocked = nao disponivel", () => {
    expect(isAvailable("ok", "blocked")).toBe(false);
  });

  it("ok + unconfigured = nao disponivel (sem routeModelRef)", () => {
    expect(isAvailable("ok", "unconfigured")).toBe(false);
  });

  it("ok + degraded = disponivel (degradado mas usavel)", () => {
    expect(isAvailable("ok", "degraded")).toBe(true);
  });
});

describe("handoff-advisor — selectNextProvider", () => {
  const makeCandidates = (specs: Array<[string, string, string, boolean]>): ProviderHandoffScore[] =>
    specs.map(([provider, budgetState, readiness, available]) => ({
      provider,
      modelRef: `${provider}/model-1`,
      budgetState: budgetState as ProviderHandoffScore["budgetState"],
      readiness: readiness as ProviderHandoffScore["readiness"],
      score: computeHandoffScore(budgetState, readiness),
      available,
    }));

  it("seleciona o melhor candidato disponivel", () => {
    const candidates = makeCandidates([
      ["provider-a", "warning", "ready", true],
      ["provider-b", "ok", "ready", true],
      ["provider-c", "blocked", "ready", false],
    ]);
    const result = selectNextProvider(candidates, undefined);
    expect(result?.provider).toBe("provider-b"); // lowest score
  });

  it("exclui o provider atual dos candidatos", () => {
    const candidates = makeCandidates([
      ["provider-a", "ok", "ready", true],
      ["provider-b", "ok", "ready", true],
    ]);
    const result = selectNextProvider(candidates, "provider-a");
    expect(result?.provider).toBe("provider-b");
  });

  it("retorna null quando nenhum candidato disponivel alem do atual", () => {
    const candidates = makeCandidates([
      ["provider-a", "ok", "ready", true],
      ["provider-b", "blocked", "ready", false],
    ]);
    const result = selectNextProvider(candidates, "provider-a");
    expect(result).toBeNull();
  });

  it("retorna null em lista vazia", () => {
    expect(selectNextProvider([], undefined)).toBeNull();
  });

  it("desempate por nome de provider (alfabetico)", () => {
    const candidates = makeCandidates([
      ["provider-z", "ok", "ready", true],
      ["provider-a", "ok", "ready", true],
    ]);
    // Both score 0, tie-broken by name
    const result = selectNextProvider(candidates, undefined);
    expect(result?.provider).toBe("provider-a");
  });
});

// ---------------------------------------------------------------------------
// resolveHandoffModelRef (execute path — pure helper)
// ---------------------------------------------------------------------------

function writeQuotaFixture(cwd: string, provider: string): void {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({
      piStack: {
        quotaVisibility: {
          defaultDays: 7,
          routeModelRefs: { [provider]: `${provider}/model-1` },
          providerBudgets: {
            [provider]: {
              period: "monthly",
              unit: "tokens-cost",
              monthlyQuotaTokens: 10,
              monthlyQuotaCostUsd: 0.01,
              warnPct: 50,
              hardPct: 80,
            },
          },
        },
      },
    }),
    "utf8",
  );

  const sessionRoot = join(cwd, ".sandbox", "pi-agent", "sessions", "workspace");
  mkdirSync(sessionRoot, { recursive: true });
  const stamp = new Date().toISOString();
  writeFileSync(
    join(sessionRoot, "2020-01-01T00-00-00-000Z_resumed.jsonl"),
    [
      JSON.stringify({ type: "session", timestamp: "2020-01-01T00:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        timestamp: stamp,
        provider,
        model: "model-1",
        message: { role: "assistant" },
        usage: { input: 20, output: 5, totalTokens: 25, cost: { total: 1 } },
      }),
    ].join("\n"),
    "utf8",
  );
}

describe("handoff-advisor — quota evidence integration", () => {
  it("usa cwd ao avaliar orçamento para sessões sandbox retomadas", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "handoff-quota-"));
    try {
      const provider = "test-handoff-provider";
      writeQuotaFixture(cwd, provider);

      const advisory = await buildHandoffAdvisory(cwd, provider);

      expect(advisory.currentState).toBe("block");
      expect(advisory.blockedProviders).toContain(provider);
      expect(advisory.candidates.find((c) => c.provider === provider)?.budgetState).toBe("blocked");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("handoff-advisor — resolveHandoffModelRef", () => {
  it("retorna modelRef configurado para o provider", () => {
    const refs = { "openai": "openai/gpt-5", "anthropic": "anthropic/claude-4" };
    expect(resolveHandoffModelRef("openai", refs)).toBe("openai/gpt-5");
    expect(resolveHandoffModelRef("anthropic", refs)).toBe("anthropic/claude-4");
  });

  it("retorna undefined quando provider nao esta em routeModelRefs", () => {
    const refs = { "openai": "openai/gpt-5" };
    expect(resolveHandoffModelRef("gemini", refs)).toBeUndefined();
  });

  it("retorna undefined para routeModelRefs vazio", () => {
    expect(resolveHandoffModelRef("anthropic", {})).toBeUndefined();
  });

  it("nao confunde providers com nomes similares", () => {
    const refs = { "openai": "openai/gpt-5", "openai-codex": "openai-codex/codex-3" };
    expect(resolveHandoffModelRef("openai", refs)).toBe("openai/gpt-5");
    expect(resolveHandoffModelRef("openai-codex", refs)).toBe("openai-codex/codex-3");
  });
});
