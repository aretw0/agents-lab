import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  toSessionWorkspaceKey,
  parseSignals,
  parseModelChanges,
  parseTimeline,
  readJsonlLines,
  runQuery,
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
});
