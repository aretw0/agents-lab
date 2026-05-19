/**
 * @capability-id stack-sovereignty-governance
 * @capability-criticality high
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const DEFAULT_BLOAT_THRESHOLDS = {
  largeResearchDataBytes: 1024 * 1024,
  localRawLogBytes: 1024 * 1024,
};

export const DEFAULT_MAX_COMPLEXITY_LINES = 1000;

const MAX_COMPLEXITY_SCAN_BYTES = 2 * 1024 * 1024;
const MAX_DISCOURSE_SCAN_BYTES = 1024 * 1024;

const LARGE_TRACKED_STATE_FILES = new Set([
  ".project/issues.json",
  ".project/tasks.json",
  ".project/verification.json",
  "pnpm-lock.yaml",
]);

const DISCOURSE_RULES = [
  {
    id: "legacy-human-term",
    severity: "warning",
    pattern: /\b(human|humano|humana|human-in-the-loop)\b/i,
    message: "prefer canonical operator/operador terminology outside historical research",
  },
  {
    id: "aspirational-release-claim",
    severity: "warning",
    pattern: /\b(farol|maturad[ao]s?|maturidade plena|release maturada|fábrica pronta)\b/i,
    message: "mark aspirational language as roadmap unless backed by a gate or runtime evidence",
  },
  {
    id: "loaded-pragmatic-label",
    severity: "warning",
    pattern: /\bPRAGMATIC\b/,
    message: "avoid uppercase semantic labels unless they map to a documented runtime contract",
  },
];

export function normalizeRepoPath(input) {
  return String(input ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function listTrackedFiles(cwd = process.cwd(), args = ["ls-files"]) {
  const out = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function listTrackedFilesZero(cwd = process.cwd()) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return splitZeroList(out);
}

function splitZeroList(value) {
  return String(value ?? "").split("\u0000").filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function listChangedFiles(cwd = process.cwd(), base = "HEAD") {
  const changed = splitZeroList(execFileSync("git", ["diff", "--name-only", "-z", "--diff-filter=ACMRT", base, "--"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  const untracked = splitZeroList(execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  return unique([...changed, ...untracked]);
}

function isResearchDataPath(filePath) {
  return normalizeRepoPath(filePath).startsWith("docs/research/data/");
}

function isRawLogPath(filePath) {
  const p = normalizeRepoPath(filePath);
  return isResearchDataPath(p) && (p.includes("/raw/") || p.endsWith(".log"));
}

export function classifyTrackedBloat(files, thresholds = DEFAULT_BLOAT_THRESHOLDS) {
  const rows = Array.isArray(files) ? files : [];
  const violations = [];
  const warnings = [];

  for (const row of rows) {
    const filePath = normalizeRepoPath(typeof row === "string" ? row : row?.path);
    const bytes = Number(typeof row === "string" ? 0 : row?.bytes ?? 0);
    if (!filePath) continue;

    if (isRawLogPath(filePath)) {
      violations.push({ path: filePath, reason: "tracked-raw-research-log", bytes });
      continue;
    }

    if (isResearchDataPath(filePath) && bytes >= thresholds.largeResearchDataBytes) {
      violations.push({ path: filePath, reason: "tracked-large-research-data", bytes });
      continue;
    }

    if (filePath.startsWith(".project/") && bytes >= 1024 * 1024) {
      warnings.push({ path: filePath, reason: "large-canonical-board-file", bytes });
    }
  }

  return { scannedCount: rows.length, violations, warnings };
}

function trackedRows(cwd) {
  return listTrackedFiles(cwd).map((filePath) => {
    const fullPath = path.join(cwd, filePath);
    let bytes = 0;
    try {
      bytes = statSync(fullPath).size;
    } catch {
      bytes = 0;
    }
    return { path: filePath, bytes };
  });
}

function walkFiles(rootDir) {
  if (!existsSync(rootDir)) return [];
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) out.push(fullPath);
    }
  }
  return out;
}

function localRawLogAdvisories(cwd, trackedSet, thresholds = DEFAULT_BLOAT_THRESHOLDS) {
  const root = path.join(cwd, "docs", "research", "data");
  return walkFiles(root)
    .map((fullPath) => {
      const rel = normalizeRepoPath(path.relative(cwd, fullPath));
      if (!isRawLogPath(rel) || trackedSet.has(rel)) return undefined;
      const bytes = statSync(fullPath).size;
      if (bytes < thresholds.localRawLogBytes) return undefined;
      return { path: rel, reason: "local-ignored-raw-log", bytes };
    })
    .filter(Boolean)
    .sort((a, b) => b.bytes - a.bytes);
}

export function buildRepoBloatReport(cwd = process.cwd(), thresholds = DEFAULT_BLOAT_THRESHOLDS) {
  const rows = trackedRows(cwd);
  const trackedSet = new Set(rows.map((row) => normalizeRepoPath(row.path)));
  const classified = classifyTrackedBloat(rows, thresholds);
  return {
    cwd,
    trackedCount: rows.length,
    ...classified,
    localAdvisories: localRawLogAdvisories(cwd, trackedSet, thresholds),
  };
}

function shouldSkipComplexity(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (
    normalized.startsWith("node_modules/") ||
    normalized.startsWith(".sandbox/") ||
    normalized.startsWith(".pi/agent/") ||
    normalized.startsWith(".pi/reports/")
  ) {
    return true;
  }

  const ext = path.extname(normalized).toLowerCase();
  const binaryExt = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".mp4", ".mov",
  ]);

  return binaryExt.has(ext);
}

function largeFileExceptionNote(filePath) {
  const normalized = normalizeRepoPath(filePath);
  const matched = [...LARGE_TRACKED_STATE_FILES].find((allowed) => normalized === allowed || normalized.endsWith(`/${allowed}`));
  if (!matched) return undefined;
  if (matched === "pnpm-lock.yaml") return "allowed:lockfile";
  return "allowed:canonical-state";
}

function countLines(text) {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}

export function scanFiles(files, maxLines = DEFAULT_MAX_COMPLEXITY_LINES, cwd = process.cwd()) {
  const findings = [];

  for (const file of files) {
    if (shouldSkipComplexity(file)) continue;
    const fullPath = path.isAbsolute(file) ? file : path.join(cwd, file);
    const reportPath = path.isAbsolute(file) ? file : normalizeRepoPath(file);

    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_COMPLEXITY_SCAN_BYTES) {
      findings.push({ file: reportPath, lines: null, size: st.size, note: "skipped:too-large" });
      continue;
    }

    let text;
    try {
      text = readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }

    const lines = countLines(text);
    if (lines > maxLines) {
      findings.push({ file: reportPath, lines, size: st.size, note: largeFileExceptionNote(reportPath) ?? "over-limit" });
    }
  }

  findings.sort((a, b) => {
    const la = a.lines ?? -1;
    const lb = b.lines ?? -1;
    return lb - la;
  });

  return findings;
}

export function buildRepoComplexityReport(cwd = process.cwd(), options = {}) {
  const maxLines = Number.isFinite(Number(options.maxLines)) && Number(options.maxLines) > 0
    ? Math.floor(Number(options.maxLines))
    : DEFAULT_MAX_COMPLEXITY_LINES;
  const changed = Boolean(options.changed);
  const base = String(options.base ?? "HEAD");
  const files = changed ? listChangedFiles(cwd, base) : listTrackedFilesZero(cwd);
  const findings = scanFiles(files, maxLines, cwd);
  const blockingFindings = findings.filter((finding) => finding.note === "over-limit");
  const allowedFindings = findings.filter((finding) => finding.note !== "over-limit");

  return {
    cwd,
    maxLines,
    changed,
    base,
    total: findings.length,
    blockingCount: blockingFindings.length,
    allowedCount: allowedFindings.length,
    findings,
    blockingFindings,
    allowedFindings,
  };
}

function isDiscourseSurface(filePath) {
  const p = normalizeRepoPath(filePath);
  if (p.endsWith("packages/pi-stack/extensions/stack-quality-audit.mjs")) return false;
  if (p.startsWith("docs/archive/")) return false;
  if (p.startsWith("docs/research/data/")) return false;
  if (p.startsWith("docs/guides/")) return true;
  if (p.startsWith("docs/primitives/")) return true;
  if (p.startsWith("docs/architecture/")) return true;
  if (/^packages\/[^/]+\/docs\/guides\//.test(p)) return false;
  if (/^packages\/[^/]+\/(skills|docs)\//.test(p)) return true;
  if (p.startsWith("packages/pi-stack/extensions/") && /\.(ts|mjs|md)$/.test(p)) return true;
  return false;
}

function shouldScanDiscourseText(filePath) {
  const p = normalizeRepoPath(filePath);
  return /\.(md|mdx|txt|ts|tsx|js|mjs|json)$/.test(p);
}

function stripMarkdownCode(line) {
  return String(line ?? "").replace(/`[^`]*`/g, "");
}

export function classifyDiscourseText(filePath, text, rules = DISCOURSE_RULES) {
  const findings = [];
  const normalized = normalizeRepoPath(filePath);
  if (!isDiscourseSurface(normalized) || !shouldScanDiscourseText(normalized)) return findings;

  const lines = String(text ?? "").split(/\r?\n/);
  let inCodeFence = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const prose = stripMarkdownCode(line);
    for (const rule of rules) {
      if (!rule.pattern.test(prose)) continue;
      findings.push({
        path: normalized,
        line: index + 1,
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        excerpt: line.trim().slice(0, 180),
      });
    }
  }
  return findings;
}

export function buildRepoDiscourseReport(cwd = process.cwd()) {
  const files = listTrackedFiles(cwd);
  const findings = [];
  let scannedCount = 0;

  for (const filePath of files) {
    const normalized = normalizeRepoPath(filePath);
    if (!isDiscourseSurface(normalized) || !shouldScanDiscourseText(normalized)) continue;

    const fullPath = path.join(cwd, normalized);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_DISCOURSE_SCAN_BYTES) continue;

    scannedCount += 1;
    findings.push(...classifyDiscourseText(normalized, readFileSync(fullPath, "utf8")));
  }

  const byRule = {};
  const byFile = {};
  for (const finding of findings) {
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
    byFile[finding.path] = (byFile[finding.path] ?? 0) + 1;
  }
  const topFiles = Object.entries(byFile)
    .map(([filePath, count]) => ({ path: filePath, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 12);

  return {
    cwd,
    scannedCount,
    findingCount: findings.length,
    byRule,
    topFiles,
    findings,
  };
}

function captureAudit(name, run) {
  try {
    return { value: run() };
  } catch (error) {
    return {
      error: {
        audit: name,
        message: String(error?.message ?? error),
      },
    };
  }
}

export function buildRepoQualityAudit(cwd = process.cwd(), options = {}) {
  const errors = [];
  const complexityResult = options.complexity === false
    ? {}
    : captureAudit("complexity", () => buildRepoComplexityReport(cwd, {
      maxLines: options.maxLines,
      changed: options.changed,
      base: options.base,
    }));
  const bloatResult = options.bloat === false ? {} : captureAudit("bloat", () => buildRepoBloatReport(cwd));
  const discourseResult = options.discourse === false ? {} : captureAudit("discourse", () => buildRepoDiscourseReport(cwd));
  if (complexityResult.error) errors.push(complexityResult.error);
  if (bloatResult.error) errors.push(bloatResult.error);
  if (discourseResult.error) errors.push(discourseResult.error);

  const complexity = complexityResult.value;
  const bloat = bloatResult.value;
  const discourse = discourseResult.value;
  const summary = {
    errors: errors.length,
    complexityBlocking: complexity?.blockingCount ?? 0,
    complexityAllowed: complexity?.allowedCount ?? 0,
    bloatViolations: bloat?.violations?.length ?? 0,
    bloatWarnings: bloat?.warnings?.length ?? 0,
    localBloatAdvisories: bloat?.localAdvisories?.length ?? 0,
    discourseFindings: discourse?.findingCount ?? 0,
  };

  return {
    cwd,
    summary,
    errors,
    complexity,
    bloat,
    discourse,
  };
}

export function formatBytes(n) {
  const value = Number(n || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}
