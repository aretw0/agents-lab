import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sessionAnalyticsExtension, {
  toSessionWorkspaceKey,
  parseSignals,
  parseModelChanges,
  parseTimeline,
  readJsonlLines,
  runQuery,
  parseGalvanizationCandidates,
  parseDelegationMixScore,
  parseAutoAdvanceHardIntentTelemetry,
  normalizeSessionAnalyticsToolParams,
} from "../../extensions/session-analytics";

describe("session-analytics — toSessionWorkspaceKey", () => {
  it("converte path Windows com drive letter", () => {
    const key = toSessionWorkspaceKey("C:\\Users\\aretw\\Documents\\GitHub\\agents-lab");
    expect(key).toBe("--C--Users-aretw-Documents-GitHub-agents-lab--");
  });

  it("converte path Windows sem drive (path relativo ao drive atual)", () => {
    // path.resolve on Windows prepends current drive — test the structure
    const key = toSessionWorkspaceKey("C:\\Users\\pi\\projects\\myrepo");
    expect(key).toBe("--C--Users-pi-projects-myrepo--");
  });

  it("substitui caracteres especiais por hifens", () => {
    const key = toSessionWorkspaceKey("C:\\my project\\some@dir");
    expect(key).toMatch(/^--C--my-project-some-dir--$/);
  });
});

describe("session-analytics — parseSignals", () => {
  it("extrai COLONY_SIGNAL de mensagens", () => {
    const records = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Task done [COLONY_SIGNAL:COMPLETE] and [COLONY_SIGNAL:TASK_DONE]" }],
        },
      },
      {
        type: "message",
        message: { role: "assistant", content: "[COLONY_SIGNAL:COMPLETE] again" },
      },
    ];
    const signals = parseSignals(records);
    const completeEntry = signals.find((s) => s.signal === "COMPLETE");
    const taskDoneEntry = signals.find((s) => s.signal === "TASK_DONE");
    expect(completeEntry?.count).toBe(2);
    expect(taskDoneEntry?.count).toBe(1);
  });

  it("ignora records que nao sao do tipo message", () => {
    const records = [
      { type: "model_change", provider: "openai", modelId: "gpt-4" },
      { type: "session", id: "abc" },
    ];
    expect(parseSignals(records)).toHaveLength(0);
  });

  it("retorna lista vazia para records sem sinais", () => {
    const records = [
      { type: "message", message: { role: "user", content: "hello world" } },
    ];
    expect(parseSignals(records)).toHaveLength(0);
  });

  it("ordena por nome do sinal alfabeticamente", () => {
    const records = [
      { type: "message", message: { role: "assistant", content: "[COLONY_SIGNAL:WORKING] [COLONY_SIGNAL:LAUNCHED]" } },
    ];
    const signals = parseSignals(records);
    expect(signals[0].signal).toBe("LAUNCHED");
    expect(signals[1].signal).toBe("WORKING");
  });
});

describe("session-analytics — parseModelChanges", () => {
  it("extrai model_change events", () => {
    const records = [
      { type: "model_change", timestamp: "2026-04-16T10:00:00Z", provider: "openai", modelId: "gpt-4" },
      { type: "model_change", timestamp: "2026-04-16T11:00:00Z", provider: "anthropic", modelId: "claude-sonnet" },
      { type: "message", message: { role: "user", content: "hi" } },
    ];
    const changes = parseModelChanges(records);
    expect(changes).toHaveLength(2);
    expect(changes[0].provider).toBe("openai");
    expect(changes[1].provider).toBe("anthropic");
  });

  it("retorna lista vazia quando nao ha model_change", () => {
    const records = [{ type: "session", id: "x" }, { type: "message", message: {} }];
    expect(parseModelChanges(records)).toHaveLength(0);
  });
});

describe("session-analytics — parseTimeline", () => {
  it("inclui colony_signal events no timeline", () => {
    const records = [
      {
        type: "message",
        timestamp: "2026-04-16T10:00:00Z",
        message: { role: "assistant", content: "done [COLONY_SIGNAL:COMPLETE]" },
      },
    ];
    const events = parseTimeline(records, 100);
    const sigEvent = events.find((e) => e.type === "colony_signal");
    expect(sigEvent).toBeDefined();
    expect(sigEvent?.signal).toBe("COMPLETE");
  });

  it("respeita o limite de eventos", () => {
    const records = Array.from({ length: 20 }, (_, i) => ({
      type: "message",
      timestamp: `2026-04-16T${String(i).padStart(2, "0")}:00:00Z`,
      message: { role: "user", content: `message ${i}` },
    }));
    const events = parseTimeline(records, 5);
    expect(events.length).toBeLessThanOrEqual(5);
  });

  it("inclui model_change no timeline", () => {
    const records = [
      { type: "model_change", timestamp: "2026-04-16T10:00:00Z", provider: "anthropic", modelId: "claude" },
    ];
    const events = parseTimeline(records, 10);
    expect(events.some((e) => e.type === "model_change")).toBe(true);
  });
});

describe("session-analytics — readJsonlLines (bounded tail scan)", () => {
  it("lê janela de cauda para evitar varredura crua de arquivo gigante", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-analytics-tail-"));
    try {
      const file = join(dir, "sample.jsonl");
      const rows = Array.from({ length: 3000 }, (_, i) =>
        JSON.stringify({ type: "message", timestamp: `${i}`, message: { role: "user", content: `m-${i}` } }),
      );
      writeFileSync(file, `${rows.join("\n")}\n`, "utf8");

      const parsed = readJsonlLines(file, { maxTailBytes: 120, maxLineChars: 2000, maxRecordsPerFile: 5000 });
      expect(parsed.stats.tailWindowApplied).toBe(true);
      expect(parsed.records.length).toBeGreaterThan(0);

      const payload = JSON.stringify(parsed.records);
      expect(payload).toContain("m-2999");
      expect(payload).not.toContain("m-0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignora linhas monstruosas acima do limite configurado", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-analytics-long-line-"));
    try {
      const file = join(dir, "sample.jsonl");
      const hugeLine = "x".repeat(5000);
      const lines = [
        JSON.stringify({ type: "message", timestamp: "1", message: { role: "user", content: "ok-a" } }),
        hugeLine,
        JSON.stringify({ type: "message", timestamp: "2", message: { role: "assistant", content: "ok-b" } }),
      ];
      writeFileSync(file, `${lines.join("\n")}\n`, "utf8");

      const parsed = readJsonlLines(file, { maxTailBytes: 20_000, maxLineChars: 1000, maxRecordsPerFile: 100 });
      expect(parsed.stats.skippedLongLines).toBe(1);
      expect(parsed.stats.parseErrors).toBe(0);
      expect(parsed.stats.recordsParsed).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("session-analytics — local sandbox session discovery", () => {
  it("consulta sessões locais .sandbox antes de depender do diretório global", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-analytics-local-"));
    try {
      const key = toSessionWorkspaceKey(dir);
      const sessionDir = join(dir, ".sandbox", "pi-agent", "sessions", key);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        join(sessionDir, "local.jsonl"),
        `${JSON.stringify({
          type: "message",
          timestamp: new Date().toISOString(),
          message: {
            role: "toolResult",
            toolName: "bash",
            content: [{ type: "text", text: "x".repeat(25_000) }],
          },
        })}\n`,
        "utf8",
      );

      const result = runQuery(dir, "outliers", 24, undefined, 5, 20_000);
      const data = result.data as { outliers: Array<{ toolName?: string; textChars: number }> };

      expect(result.filesScanned).toBe(1);
      expect(data.outliers[0]?.toolName).toBe("bash");
      expect(data.outliers[0]?.textChars).toBe(25_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normaliza parâmetros camelCase do harness no execute do tool", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-analytics-tool-"));
    const oldCwd = process.cwd();
    let registeredTool: {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: { cwd: string },
      ) => { details: ReturnType<typeof runQuery> };
    } | undefined;
    try {
      const key = toSessionWorkspaceKey(dir);
      const sessionDir = join(dir, ".sandbox", "pi-agent", "sessions", key);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        join(sessionDir, "local.jsonl"),
        `${JSON.stringify({
          type: "message",
          timestamp: new Date().toISOString(),
          message: {
            role: "toolResult",
            toolName: "bash",
            content: [{ type: "text", text: "y".repeat(25_000) }],
          },
        })}\n`,
        "utf8",
      );
      sessionAnalyticsExtension({
        registerTool(tool: unknown) { registeredTool = tool as typeof registeredTool; },
        registerCommand() {},
      } as never);
      process.chdir(dir);

      const output = registeredTool?.execute(
        "call-test",
        { queryType: "outliers", lookbackHours: 2, limit: 3, minChars: 20_000 },
        undefined,
        undefined,
        { cwd: dir },
      );
      const data = output?.details.data as { outliers: Array<{ textChars: number }> };

      expect(output?.details.queryType).toBe("outliers");
      expect(output?.details.lookbackHours).toBe(2);
      expect(data.outliers[0]?.textChars).toBe(25_000);
    } finally {
      process.chdir(oldCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normaliza payloads aninhados do harness", () => {
    const normalized = normalizeSessionAnalyticsToolParams({
      input: {
        query_type: "outliers",
        lookback_hours: 2,
        limit: 3,
        min_chars: 20_000,
      },
    });

    expect(normalized.queryType).toBe("outliers");
    expect(normalized.hours).toBe(2);
    expect(normalized.limit).toBe(3);
    expect(normalized.minChars).toBe(20_000);
  });
});

describe("session-analytics — galvanization discovery", () => {
  it("classifica padrões repetitivos com evidência de consumo e roadmap de mitigação", () => {
    const records = [
      {
        type: "message",
        timestamp: "2026-04-24T10:00:00Z",
        _sessionFile: "s1.jsonl",
        message: { role: "user", content: "Rodar /quota-visibility status e me resumir" },
      },
      {
        type: "message",
        timestamp: "2026-04-24T10:00:10Z",
        _sessionFile: "s1.jsonl",
        message: {
          role: "assistant",
          content: "ok",
          usage: { inputTokens: 300, outputTokens: 120, cost: { total: 0.015 } },
        },
      },
      {
        type: "message",
        timestamp: "2026-04-24T11:00:00Z",
        _sessionFile: "s2.jsonl",
        message: { role: "user", content: "Rodar /quota-visibility status e me resumir" },
      },
      {
        type: "message",
        timestamp: "2026-04-24T11:00:10Z",
        _sessionFile: "s2.jsonl",
        message: {
          role: "assistant",
          content: "ok",
          usage: { inputTokens: 320, outputTokens: 110, cost: { total: 0.016 } },
        },
      },
    ];

    const result = parseGalvanizationCandidates(records, 5);
    expect(result.candidates.length).toBeGreaterThan(0);

    const top = result.candidates[0];
    expect(top.occurrences).toBeGreaterThanOrEqual(2);
    expect(top.evidence.tokens).toBeGreaterThan(0);
    expect(top.pathway.safetyGates.length).toBeGreaterThan(0);
    expect(result.roadmap.baseline.tokens).toBeGreaterThan(0);
    expect(result.roadmap.mitigationPotential.tokensSaved).toBeGreaterThan(0);
  });
});

describe("session-analytics — delegation mix score", () => {
  it("classifica mix local/manual/simple-delegate/swarm e retorna decisão ready quando há diversidade", () => {
    const records = [
      { type: "message", timestamp: "2026-05-03T01:00:00Z", message: { role: "user", content: "seguir local-safe e checkpoint" } },
      { type: "message", timestamp: "2026-05-03T01:01:00Z", message: { role: "user", content: "delegar para subagent com slice pequeno" } },
      { type: "message", timestamp: "2026-05-03T01:02:00Z", message: { role: "user", content: "vou fazer manualmente a revisão" } },
      { type: "tool_call", timestamp: "2026-05-03T01:03:00Z", toolName: "ant_colony" },
      { type: "message", timestamp: "2026-05-03T01:04:00Z", message: { role: "assistant", content: "[COLONY_SIGNAL:COMPLETE]" } },
    ];

    const score = parseDelegationMixScore(records, 24, 1);
    expect(score.decision).toBe("ready");
    expect(score.recommendationCode).toBe("delegation-mix-ready-diverse");
    expect(score.totals.diversityModes).toBeGreaterThanOrEqual(3);
    expect(score.totals.simpleDelegate).toBeGreaterThan(0);
    expect(score.totals.swarm).toBeGreaterThan(0);
    expect(score.dispatchAllowed).toBe(false);
    expect(score.authorization).toBe("none");
  });

  it("expõe tool delegation_mix_score em modo report-only/read-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-analytics-mix-tool-"));
    const oldCwd = process.cwd();
    let tools: Array<{ name?: string; execute?: (...args: any[]) => any }> = [];
    try {
      const key = toSessionWorkspaceKey(dir);
      const sessionsDir = join(dir, ".sandbox", "pi-agent", "sessions", key);
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(
        join(sessionsDir, "mix.jsonl"),
        [
          JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: "local-safe micro-slice" } }),
          JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: "delegar para subagent" } }),
        ].join("\n") + "\n",
        "utf8",
      );

      sessionAnalyticsExtension({
        registerTool(tool: unknown) { tools.push(tool as { name?: string; execute?: (...args: any[]) => any }); },
        registerCommand() {},
      } as never);
      process.chdir(dir);

      const tool = tools.find((tool) => tool.name === "delegation_mix_score");
      const output = tool?.execute?.("tc-delegation-mix-score", { lookback_hours: 24 }, undefined, undefined, { cwd: dir });

      expect(output?.details?.mode).toBe("delegation-mix-score");
      expect(output?.details?.decision).toBe("needs-evidence");
      expect(output?.details?.recommendationCode).toBe("delegation-mix-needs-evidence-swarm-missing");
      expect(output?.details?.dispatchAllowed).toBe(false);
      expect(output?.details?.authorization).toBe("none");
      expect(output?.details?.mutationAllowed).toBe(false);
      expect(String(output?.content?.[0]?.text ?? "")).toContain("delegation-mix-score:");
    } finally {
      process.chdir(oldCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("session-analytics — auto-advance hard-intent telemetry", () => {
  it("classifica eventos eligible e blocked com reason codes", () => {
    const records = [
      {
        type: "message",
        timestamp: "2026-05-03T03:00:00Z",
        message: { role: "assistant", content: "auto-advance hard-intent: execute bounded slice for TASK-NEXT" },
      },
      {
        type: "message",
        timestamp: "2026-05-03T03:01:00Z",
        message: {
          role: "assistant",
          content: "hard-intent auto-advance fail-closed; choose next focus explicitly (reload-required-or-dirty,validation-gate-unknown).",
        },
      },
      {
        type: "message",
        timestamp: "2026-05-03T03:02:00Z",
        message: { role: "assistant", content: "auto-advance hard-intent: execute bounded slice for TASK-ANOTHER" },
      },
    ];

    const telemetry = parseAutoAdvanceHardIntentTelemetry(records, 24, 1);
    expect(telemetry.mode).toBe("auto-advance-hard-intent-telemetry");
    expect(telemetry.decision).toBe("ready");
    expect(telemetry.totals.totalEvents).toBe(3);
    expect(telemetry.totals.eligibleEvents).toBe(2);
    expect(telemetry.totals.blockedEvents).toBe(1);
    expect(telemetry.blockedReasons.some((row) => row.reason === "reload-required-or-dirty")).toBe(true);
    expect(telemetry.dispatchAllowed).toBe(false);
    expect(telemetry.authorization).toBe("none");
  });

  it("expõe tool auto_advance_hard_intent_telemetry em modo report-only/read-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-analytics-auto-advance-tool-"));
    const oldCwd = process.cwd();
    let tools: Array<{ name?: string; execute?: (...args: any[]) => any }> = [];
    try {
      const key = toSessionWorkspaceKey(dir);
      const sessionsDir = join(dir, ".sandbox", "pi-agent", "sessions", key);
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(
        join(sessionsDir, "auto-advance.jsonl"),
        [
          JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message: { role: "assistant", content: "auto-advance hard-intent: execute bounded slice" } }),
          JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message: { role: "assistant", content: "hard-intent auto-advance fail-closed; choose next focus explicitly (validation-gate-unknown)." } }),
        ].join("\n") + "\n",
        "utf8",
      );

      sessionAnalyticsExtension({
        registerTool(tool: unknown) { tools.push(tool as { name?: string; execute?: (...args: any[]) => any }); },
        registerCommand() {},
      } as never);
      process.chdir(dir);

      const tool = tools.find((tool) => tool.name === "auto_advance_hard_intent_telemetry");
      const output = tool?.execute?.("tc-auto-advance-telemetry", { lookback_hours: 24 }, undefined, undefined, { cwd: dir });

      expect(output?.details?.mode).toBe("auto-advance-hard-intent-telemetry");
      expect(output?.details?.totals?.totalEvents).toBeGreaterThan(0);
      expect(output?.details?.dispatchAllowed).toBe(false);
      expect(output?.details?.authorization).toBe("none");
      expect(output?.details?.mutationAllowed).toBe(false);
      expect(String(output?.content?.[0]?.text ?? "")).toContain("auto-advance-hard-intent-telemetry:");
    } finally {
      process.chdir(oldCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("session-analytics — runQuery (sem sessoes reais)", () => {
  it("retorna resultado vazio quando nao ha arquivos de sessao", () => {
    const result = runQuery("/nonexistent/path", "summary", 24, undefined, 50);
    expect(result.queryType).toBe("summary");
    expect(result.filesScanned).toBe(0);
    expect(result.scan.maxTailBytes).toBeGreaterThan(0);
    const d = result.data as Record<string, unknown>;
    expect(d["sessionsFound"]).toBe(0);
  });

  it("resultado de signals tem estrutura correta mesmo sem sessoes", () => {
    const result = runQuery("/nonexistent/path", "signals", 24, undefined, 50);
    expect(result.queryType).toBe("signals");
    expect(result.scan.parseErrors).toBe(0);
    const d = result.data as Record<string, unknown>;
    expect(d["signals"]).toEqual([]);
    expect(d["totalSignals"]).toBe(0);
  });

  it("resultado de galvanization retorna estrutura roadmap mesmo sem sessoes", () => {
    const result = runQuery("/nonexistent/path", "galvanization", 24, undefined, 50);
    expect(result.queryType).toBe("galvanization");
    const d = result.data as Record<string, unknown>;
    expect(Array.isArray(d["candidates"])).toBe(true);
    expect(d["classificationModel"]).toBe("deterministic-v1");
  });
});
