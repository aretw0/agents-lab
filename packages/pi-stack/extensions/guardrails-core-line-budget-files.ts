import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readJsonObjectFile, resolveSettingsJsonCandidates } from "./context-watchdog-storage";
import type { LineBudgetFileEntry } from "./guardrails-core-tool-hygiene";

export interface LineBudgetScanConfig {
  roots: string[];
  ignoredDirs: string[];
  extensions: string[];
  ignoreDeclarationFiles: boolean;
  thresholds: {
    watch: number;
    extract: number;
    critical: number;
  };
  source: "project-settings" | "user-settings" | "default" | "invalid";
  warnings: string[];
}

export interface LineBudgetEntryCollection {
  entries: LineBudgetFileEntry[];
  config: LineBudgetScanConfig;
}

const DEFAULT_LINE_BUDGET_CONFIG: Omit<LineBudgetScanConfig, "source" | "warnings"> = {
  roots: ["packages/pi-stack"],
  ignoredDirs: [".cache", ".pi-lens", "_site", "coverage", "dist", "node_modules"],
  extensions: [".ts"],
  ignoreDeclarationFiles: true,
  thresholds: {
    watch: 1000,
    extract: 1400,
    critical: 2000,
  },
};

function asStringList(value: unknown, fallback: string[]): { values: string[]; usedFallback: boolean } {
  if (!Array.isArray(value)) return { values: [...fallback], usedFallback: false };
  const out = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().replace(/\\/g, "/"))
    .filter((entry) => !path.isAbsolute(entry) && !entry.split("/").includes(".."));
  return out.length > 0
    ? { values: [...new Set(out)], usedFallback: false }
    : { values: [...fallback], usedFallback: true };
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function readLineBudgetSettings(cwd: string): { value?: Record<string, unknown>; source: LineBudgetScanConfig["source"] } {
  const candidates = resolveSettingsJsonCandidates(cwd);
  for (const candidate of candidates) {
    const settings = readJsonObjectFile(candidate);
    const guardrailsCore = settings?.piStack && typeof settings.piStack === "object"
      ? (settings.piStack as Record<string, unknown>).guardrailsCore
      : undefined;
    const lineBudget = guardrailsCore && typeof guardrailsCore === "object"
      ? (guardrailsCore as Record<string, unknown>).lineBudget
      : undefined;
    if (!lineBudget || typeof lineBudget !== "object" || Array.isArray(lineBudget)) continue;
    return {
      value: lineBudget as Record<string, unknown>,
      source: candidate.includes(path.join(cwd, ".pi", "settings.json")) ? "project-settings" : "user-settings",
    };
  }
  return { source: "default" };
}

export function resolveLineBudgetScanConfig(cwd: string): LineBudgetScanConfig {
  const settings = readLineBudgetSettings(cwd);
  const warnings: string[] = [];
  const raw = settings.value;
  const rootsResult = asStringList(raw?.roots, DEFAULT_LINE_BUDGET_CONFIG.roots);
  const ignoredDirsResult = asStringList(raw?.ignoredDirs, DEFAULT_LINE_BUDGET_CONFIG.ignoredDirs);
  const extensionsResult = asStringList(raw?.extensions, DEFAULT_LINE_BUDGET_CONFIG.extensions);
  const roots = rootsResult.values;
  const ignoredDirs = ignoredDirsResult.values;
  const extensions = extensionsResult.values.map((entry) => entry.startsWith(".") ? entry : `.${entry}`);
  const ignoreDeclarationFiles = typeof raw?.ignoreDeclarationFiles === "boolean"
    ? raw.ignoreDeclarationFiles
    : DEFAULT_LINE_BUDGET_CONFIG.ignoreDeclarationFiles;
  const rawThresholds = raw?.thresholds && typeof raw.thresholds === "object" && !Array.isArray(raw.thresholds)
    ? raw.thresholds as Record<string, unknown>
    : {};
  const watch = asPositiveInteger(rawThresholds.watch, DEFAULT_LINE_BUDGET_CONFIG.thresholds.watch);
  const extract = Math.max(watch + 1, asPositiveInteger(rawThresholds.extract, DEFAULT_LINE_BUDGET_CONFIG.thresholds.extract));
  const critical = Math.max(extract + 1, asPositiveInteger(rawThresholds.critical, DEFAULT_LINE_BUDGET_CONFIG.thresholds.critical));
  if (settings.value && rootsResult.usedFallback) warnings.push("line-budget-roots-invalid");
  if (settings.value && ignoredDirsResult.usedFallback) warnings.push("line-budget-ignored-dirs-invalid");
  if (settings.value && extensionsResult.usedFallback) warnings.push("line-budget-extensions-invalid");
  return {
    roots,
    ignoredDirs,
    extensions,
    ignoreDeclarationFiles,
    thresholds: {
      watch,
      extract,
      critical,
    },
    source: warnings.length > 0 ? "invalid" : settings.source,
    warnings,
  };
}

function collectBudgetFiles(rootDir: string, config: LineBudgetScanConfig): string[] {
  if (!existsSync(rootDir)) return [];

  const out: string[] = [];
  const ignoredDirs = new Set(config.ignoredDirs);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const included = config.extensions.some((extension) => entry.name.endsWith(extension));
      if (!included) continue;
      if (config.ignoreDeclarationFiles && entry.name.endsWith(".d.ts")) continue;
      out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

function countLines(filePath: string): number {
  const text = readFileSync(filePath, "utf8");
  return text.split(/\r?\n/).length;
}

export function buildExtensionLineBudgetEntries(cwd: string): LineBudgetFileEntry[] {
  return collectExtensionLineBudgetEntries(cwd).entries;
}

export function collectExtensionLineBudgetEntries(cwd: string): LineBudgetEntryCollection {
  const config = resolveLineBudgetScanConfig(cwd);
  const files = config.roots.flatMap((root) => collectBudgetFiles(path.join(cwd, root), config));
  return {
    config,
    entries: files.map((file) => ({
    path: path.relative(cwd, file).replace(/\\/g, "/"),
    lines: countLines(file),
    })),
  };
}
