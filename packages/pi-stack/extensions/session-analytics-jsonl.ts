import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface SessionJsonlScanLimits {
  maxTailBytes: number;
  maxLineChars: number;
  maxRecordsPerFile: number;
}

export interface SessionJsonlFileScanStats {
  filePath: string;
  fileSizeBytes: number;
  bytesRead: number;
  tailWindowApplied: boolean;
  droppedLeadingPartialLine: boolean;
  recordsParsed: number;
  parseErrors: number;
  skippedLongLines: number;
  recordsCapped: boolean;
  readError?: string;
}

export interface SessionJsonlReadResult {
  records: unknown[];
  stats: SessionJsonlFileScanStats;
}

export const DEFAULT_SESSION_JSONL_SCAN_LIMITS: SessionJsonlScanLimits = {
  maxTailBytes: 2_000_000,
  maxLineChars: 200_000,
  maxRecordsPerFile: 5_000,
};

export function clampScanLimits(overrides?: Partial<SessionJsonlScanLimits>): SessionJsonlScanLimits {
  const maxTailBytesRaw = Number(overrides?.maxTailBytes);
  const maxLineCharsRaw = Number(overrides?.maxLineChars);
  const maxRecordsPerFileRaw = Number(overrides?.maxRecordsPerFile);
  return {
    maxTailBytes:
      Number.isFinite(maxTailBytesRaw) && maxTailBytesRaw > 0
        ? Math.max(64_000, Math.min(10_000_000, Math.floor(maxTailBytesRaw)))
        : DEFAULT_SESSION_JSONL_SCAN_LIMITS.maxTailBytes,
    maxLineChars:
      Number.isFinite(maxLineCharsRaw) && maxLineCharsRaw > 0
        ? Math.max(2_000, Math.min(2_000_000, Math.floor(maxLineCharsRaw)))
        : DEFAULT_SESSION_JSONL_SCAN_LIMITS.maxLineChars,
    maxRecordsPerFile:
      Number.isFinite(maxRecordsPerFileRaw) && maxRecordsPerFileRaw > 0
        ? Math.max(100, Math.min(20_000, Math.floor(maxRecordsPerFileRaw)))
        : DEFAULT_SESSION_JSONL_SCAN_LIMITS.maxRecordsPerFile,
  };
}

export function readJsonlLines(
  filePath: string,
  overrides?: Partial<SessionJsonlScanLimits>,
): SessionJsonlReadResult {
  const limits = clampScanLimits(overrides);
  const emptyStats: SessionJsonlFileScanStats = {
    filePath,
    fileSizeBytes: 0,
    bytesRead: 0,
    tailWindowApplied: false,
    droppedLeadingPartialLine: false,
    recordsParsed: 0,
    parseErrors: 0,
    skippedLongLines: 0,
    recordsCapped: false,
  };

  try {
    const st = statSync(filePath);
    const fileSizeBytes = Number.isFinite(st.size) ? Math.max(0, Math.floor(st.size)) : 0;
    if (fileSizeBytes <= 0) {
      return { records: [], stats: { ...emptyStats, fileSizeBytes } };
    }

    const bytesToRead = Math.min(fileSizeBytes, limits.maxTailBytes);
    const startOffset = Math.max(0, fileSizeBytes - bytesToRead);
    const buf = Buffer.alloc(bytesToRead);

    const fd = openSync(filePath, "r");
    let readBytes = 0;
    try {
      readBytes = readSync(fd, buf, 0, bytesToRead, startOffset);
    } finally {
      closeSync(fd);
    }

    let text = buf.subarray(0, readBytes).toString("utf8");
    let droppedLeadingPartialLine = false;
    if (startOffset > 0) {
      const firstBreak = text.indexOf("\n");
      if (firstBreak >= 0) {
        text = text.slice(firstBreak + 1);
        droppedLeadingPartialLine = true;
      }
    }

    const records: unknown[] = [];
    let parseErrors = 0;
    let skippedLongLines = 0;
    let recordsCapped = false;

    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      if (line.length > limits.maxLineChars) {
        skippedLongLines += 1;
        continue;
      }
      try {
        records.push(JSON.parse(line));
      } catch {
        parseErrors += 1;
      }
      if (records.length >= limits.maxRecordsPerFile) {
        recordsCapped = true;
        break;
      }
    }

    return {
      records,
      stats: {
        filePath,
        fileSizeBytes,
        bytesRead: readBytes,
        tailWindowApplied: startOffset > 0,
        droppedLeadingPartialLine,
        recordsParsed: records.length,
        parseErrors,
        skippedLongLines,
        recordsCapped,
      },
    };
  } catch (error) {
    return {
      records: [],
      stats: {
        ...emptyStats,
        readError: error instanceof Error ? error.message : String(error ?? "unknown-error"),
      },
    };
  }
}
