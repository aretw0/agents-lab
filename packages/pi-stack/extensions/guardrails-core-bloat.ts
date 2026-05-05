import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface BloatSmellConfig {
  enabled: boolean;
  notifyOnTrigger: boolean;
  cooldownMs: number;
  text: {
    enabled: boolean;
    chars: number;
    lines: number;
    repeatedLineRatio: number;
  };
  code: {
    enabled: boolean;
    changedLines: number;
    hunks: number;
    filesTouched: number;
  };
}

export const DEFAULT_BLOAT_SMELL_CONFIG: BloatSmellConfig = {
  enabled: true,
  notifyOnTrigger: false,
  cooldownMs: 90_000,
  text: {
    enabled: true,
    chars: 1200,
    lines: 24,
    repeatedLineRatio: 0.35,
  },
  code: {
    enabled: true,
    changedLines: 120,
    hunks: 8,
    filesTouched: 5,
  },
};

export function resolveBloatSmellConfig(cwd: string): BloatSmellConfig {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return DEFAULT_BLOAT_SMELL_CONFIG;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.bloatSmell ?? {};
    const textCfg = cfg?.text ?? {};
    const codeCfg = cfg?.code ?? {};
    const cooldownMsRaw = Number(cfg?.cooldownMs);
    const charsRaw = Number(textCfg?.chars);
    const linesRaw = Number(textCfg?.lines);
    const repeatedRaw = Number(textCfg?.repeatedLineRatio);
    const changedLinesRaw = Number(codeCfg?.changedLines);
    const hunksRaw = Number(codeCfg?.hunks);
    const filesTouchedRaw = Number(codeCfg?.filesTouched);

    return {
      enabled: cfg?.enabled !== false,
      notifyOnTrigger: cfg?.notifyOnTrigger === true,
      cooldownMs: Number.isFinite(cooldownMsRaw)
        ? Math.max(5_000, Math.min(600_000, Math.floor(cooldownMsRaw)))
        : DEFAULT_BLOAT_SMELL_CONFIG.cooldownMs,
      text: {
        enabled: textCfg?.enabled !== false,
        chars: Number.isFinite(charsRaw)
          ? Math.max(200, Math.min(12_000, Math.floor(charsRaw)))
          : DEFAULT_BLOAT_SMELL_CONFIG.text.chars,
        lines: Number.isFinite(linesRaw)
          ? Math.max(8, Math.min(300, Math.floor(linesRaw)))
          : DEFAULT_BLOAT_SMELL_CONFIG.text.lines,
        repeatedLineRatio: Number.isFinite(repeatedRaw)
          ? Math.max(0.1, Math.min(0.9, repeatedRaw))
          : DEFAULT_BLOAT_SMELL_CONFIG.text.repeatedLineRatio,
      },
      code: {
        enabled: codeCfg?.enabled !== false,
        changedLines: Number.isFinite(changedLinesRaw)
          ? Math.max(20, Math.min(10_000, Math.floor(changedLinesRaw)))
          : DEFAULT_BLOAT_SMELL_CONFIG.code.changedLines,
        hunks: Number.isFinite(hunksRaw)
          ? Math.max(1, Math.min(200, Math.floor(hunksRaw)))
          : DEFAULT_BLOAT_SMELL_CONFIG.code.hunks,
        filesTouched: Number.isFinite(filesTouchedRaw)
          ? Math.max(1, Math.min(200, Math.floor(filesTouchedRaw)))
          : DEFAULT_BLOAT_SMELL_CONFIG.code.filesTouched,
      },
    };
  } catch {
    return DEFAULT_BLOAT_SMELL_CONFIG;
  }
}

export function shouldEmitBloatSmellSignal(
  lastAtMs: number,
  previousKey: string | undefined,
  nextKey: string,
  nowMs: number,
  cooldownMs: number,
): boolean {
  if (!nextKey) return false;
  if (previousKey !== nextKey) return true;
  if (lastAtMs <= 0) return true;
  return (nowMs - lastAtMs) >= Math.max(0, Math.floor(cooldownMs));
}

export function extractAssistantTextFromTurnMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const row = message as Record<string, unknown>;
  if (row.role !== "assistant") return "";

  const chunks: string[] = [];
  if (typeof row.text === "string" && row.text.trim().length > 0) {
    chunks.push(row.text.trim());
  }

  const content = row.content;
  if (typeof content === "string" && content.trim().length > 0) {
    chunks.push(content.trim());
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const type = typeof p.type === "string" ? p.type.toLowerCase() : "";
      const text = typeof p.text === "string" ? p.text : "";
      if ((type === "text" || type === "output_text" || type === "markdown") && text.trim().length > 0) {
        chunks.push(text.trim());
      }
    }
  }

  const parts = row.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const text = typeof p.text === "string" ? p.text : "";
      if (text.trim().length > 0) chunks.push(text.trim());
    }
  }

  return chunks.join("\n").trim();
}

function countMeaningfulLines(text: string): number {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return 0;
  return normalized.split("\n").length;
}

export function estimateCodeBloatFromEditInput(input: unknown): {
  changedLines: number;
  hunks: number;
  filesTouched: number;
} {
  const row = input as Record<string, unknown> | undefined;
  const edits = Array.isArray(row?.edits) ? (row.edits as unknown[]) : [];

  let changedLines = 0;
  let hunks = 0;
  for (const raw of edits) {
    if (!raw || typeof raw !== "object") continue;
    const editRow = raw as Record<string, unknown>;
    const oldText = typeof editRow.oldText === "string" ? editRow.oldText : "";
    const newText = typeof editRow.newText === "string" ? editRow.newText : "";
    const oldLines = countMeaningfulLines(oldText);
    const newLines = countMeaningfulLines(newText);
    changedLines += Math.max(1, oldLines, newLines);
    hunks += 1;
  }

  return {
    changedLines,
    hunks,
    filesTouched: 1,
  };
}

export function estimateCodeBloatFromWriteInput(input: unknown): {
  changedLines: number;
  hunks: number;
  filesTouched: number;
} {
  const row = input as Record<string, unknown> | undefined;
  const content = typeof row?.content === "string" ? row.content : "";
  const lines = countMeaningfulLines(content);
  return {
    changedLines: lines,
    hunks: lines > 0 ? 1 : 0,
    filesTouched: 1,
  };
}

export function buildTextBloatStatusLabel(assessment: {
  metrics: { chars: number; lines: number; repeatedLineRatio: number };
}): string {
  return `[bloat] text chars=${assessment.metrics.chars} lines=${assessment.metrics.lines} rep=${assessment.metrics.repeatedLineRatio.toFixed(2)}`;
}

export function buildCodeBloatStatusLabel(assessment: {
  metrics: { changedLines: number; hunks: number; filesTouched: number };
}): string {
  return `[bloat] code lines=${assessment.metrics.changedLines} hunks=${assessment.metrics.hunks} files=${assessment.metrics.filesTouched}`;
}

export function summarizeAssumptionText(text: string, maxChars: number): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  const max = Math.max(20, Math.floor(maxChars));
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

export interface TextBloatSmellAssessment {
  triggered: boolean;
  reasons: string[];
  recommendation: string;
  metrics: {
    chars: number;
    lines: number;
    repeatedLineRatio: number;
  };
}

export interface CodeBloatSmellAssessment {
  triggered: boolean;
  reasons: string[];
  recommendation: string;
  metrics: {
    changedLines: number;
    hunks: number;
    filesTouched: number;
  };
}

export interface WideSingleFileSliceAssessment {
  triggered: boolean;
  reasons: string[];
  recommendation: string;
  metrics: {
    changedLines: number;
    hunks: number;
    filesTouched: number;
  };
}

export function evaluateTextBloatSmell(
  text: string,
  thresholds?: Partial<{ chars: number; lines: number; repeatedLineRatio: number }>,
): TextBloatSmellAssessment {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const chars = normalized.trim().length;
  const linesRaw = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const lines = linesRaw.length;
  const uniqueCount = new Set(linesRaw.map((line) => line.toLowerCase())).size;
  const repeatedLineRatio = lines > 0 ? (lines - uniqueCount) / lines : 0;

  const charsThreshold = Math.max(200, Math.floor(Number(thresholds?.chars ?? 1200)));
  const linesThreshold = Math.max(8, Math.floor(Number(thresholds?.lines ?? 24)));
  const repeatedLineRatioThreshold = Number.isFinite(Number(thresholds?.repeatedLineRatio))
    ? Math.max(0.1, Math.min(0.9, Number(thresholds?.repeatedLineRatio ?? 0.35)))
    : 0.35;

  const reasons: string[] = [];
  if (chars >= charsThreshold) reasons.push(`high-char-count:${chars}`);
  if (lines >= linesThreshold) reasons.push(`high-line-count:${lines}`);
  if (repeatedLineRatio >= repeatedLineRatioThreshold) {
    reasons.push(`high-repetition:${repeatedLineRatio.toFixed(2)}`);
  }

  return {
    triggered: reasons.length > 0,
    reasons,
    recommendation: reasons.length > 0
      ? "text-bloat advisory: keep key claim first, trim repetition, and split into concise bullets/sections."
      : "text-bloat: healthy",
    metrics: {
      chars,
      lines,
      repeatedLineRatio,
    },
  };
}

export function evaluateCodeBloatSmell(
  metricsInput: { changedLines: number; hunks: number; filesTouched?: number },
  thresholds?: Partial<{ changedLines: number; hunks: number; filesTouched: number }>,
): CodeBloatSmellAssessment {
  const changedLines = Math.max(0, Math.floor(Number(metricsInput?.changedLines ?? 0)));
  const hunks = Math.max(0, Math.floor(Number(metricsInput?.hunks ?? 0)));
  const filesTouched = Math.max(0, Math.floor(Number(metricsInput?.filesTouched ?? 1)));

  const changedLinesThreshold = Math.max(20, Math.floor(Number(thresholds?.changedLines ?? 120)));
  const hunksThreshold = Math.max(1, Math.floor(Number(thresholds?.hunks ?? 8)));
  const filesTouchedThreshold = Math.max(1, Math.floor(Number(thresholds?.filesTouched ?? 5)));

  const reasons: string[] = [];
  if (changedLines >= changedLinesThreshold) reasons.push(`high-changed-lines:${changedLines}`);
  if (hunks >= hunksThreshold) reasons.push(`high-hunks:${hunks}`);
  if (filesTouched >= filesTouchedThreshold) reasons.push(`high-files-touched:${filesTouched}`);

  return {
    triggered: reasons.length > 0,
    reasons,
    recommendation: reasons.length > 0
      ? "code-bloat advisory: split into micro-slices; when the active task explicitly authorizes anti-bloat/refactor, cohesive extraction is in-scope, but backlog/policy tangents still need separate focus."
      : "code-bloat: healthy",
    metrics: {
      changedLines,
      hunks,
      filesTouched,
    },
  };
}

export function evaluateWideSingleFileSlice(
  metricsInput: { changedLines: number; hunks: number; filesTouched?: number },
  thresholds?: Partial<{ changedLines: number; hunks: number }>,
): WideSingleFileSliceAssessment {
  const changedLines = Math.max(0, Math.floor(Number(metricsInput?.changedLines ?? 0)));
  const hunks = Math.max(0, Math.floor(Number(metricsInput?.hunks ?? 0)));
  const filesTouched = Math.max(0, Math.floor(Number(metricsInput?.filesTouched ?? 1)));

  const changedLinesThreshold = Math.max(20, Math.floor(Number(thresholds?.changedLines ?? 40)));
  const hunksThreshold = Math.max(2, Math.floor(Number(thresholds?.hunks ?? 3)));

  const reasons: string[] = [];
  if (filesTouched !== 1) {
    reasons.push(`files-touched:${filesTouched}`);
  }
  if (changedLines >= changedLinesThreshold) {
    reasons.push(`wide-lines:${changedLines}`);
  }
  if (hunks >= hunksThreshold) {
    reasons.push(`wide-hunks:${hunks}`);
  }

  const triggered = filesTouched === 1 && changedLines >= changedLinesThreshold && hunks >= hunksThreshold;

  return {
    triggered,
    reasons: triggered ? reasons.filter((reason) => reason.startsWith("wide-")) : reasons,
    recommendation: triggered
      ? "slice-wide advisory: split this file change into micro-slices; authorized anti-bloat/refactor extraction is in-scope, but unrelated backlog/policy changes still need separate focus."
      : "slice-width: healthy",
    metrics: {
      changedLines,
      hunks,
      filesTouched,
    },
  };
}

export function buildWideSingleFileSliceStatusLabel(assessment: WideSingleFileSliceAssessment): string {
  return `[slice] wide-file lines=${assessment.metrics.changedLines} hunks=${assessment.metrics.hunks}`;
}
