#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { freemem, homedir, totalmem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDevelopmentVelocityPressure } from "../packages/pi-stack/extensions/environment-doctor-dev-pressure-policy.mjs";
import {
  buildSessionBudget,
  computeStrictFailures,
} from "../packages/pi-stack/extensions/session-pressure-policy.mjs";
import {
  buildBoardPressurePlan,
  collectBoardStateStats,
  formatBoardPressureDetail,
} from "./pi-dev-pressure-board.mjs";
import {
  buildControlPlaneCapabilityGuidance,
} from "../packages/pi-stack/extensions/runtime-profile-policy.mjs";

export { buildBoardPressurePlan, collectBoardStateStats } from "./pi-dev-pressure-board.mjs";

const DEFAULT_THRESHOLDS = {
  largeSessionMb: 50,
  blockingSessionMb: 150,
  heavyEntrypointKb: 750,
  heavyEntrypointFiles: 70,
  dirtyFileWarn: 8,
  boardWarnMb: 1,
  handoffWarnMinutes: 24 * 60,
  usefulCommitWarnMinutes: 4 * 60,
  memoryWarnUsedPct: 85,
  memoryBlockUsedPct: 96,
  diskWarnFreeMb: 10 * 1024,
  diskBlockFreeMb: 5 * 1024,
  processAgeWarnMinutes: 6 * 60,
  danglingProcessWarn: 1,
  ceremonyToolCallWarn: 40,
  ceremonyBoardReadWarn: 8,
};

const WATCHDOG_TAIL_BYTES = 2_000_000;
const PERFORMANCE_WATCHDOG_CRITICAL_RE = /Performance watchdog critical:\s*([^"\n\r]+)/gi;
const PERFORMANCE_WATCHDOG_SAFE_MODE_RE = /Watchdog enabled safe mode automatically:\s*safe mode is on\s*\(([^)"\n\r]+)\)/gi;
const PERFORMANCE_WATCHDOG_EVENT_LOOP_MAX_RE = /event-loop\s+max\s+(\d+(?:\.\d+)?)ms/i;
const PERFORMANCE_WATCHDOG_RECURRING_EVENT_COUNT = 3;
const PERFORMANCE_WATCHDOG_SEVERE_EVENT_LOOP_MAX_MS = 1000;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toMb(bytes) {
  return Number((Math.max(0, Number(bytes) || 0) / 1024 / 1024).toFixed(2));
}

function minutesBetween(nowMs, thenMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) return undefined;
  return Math.max(0, Number(((nowMs - thenMs) / 60_000).toFixed(1)));
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    return { __parseError: err instanceof Error ? err.message : String(err) };
  }
}

function readFileTail(filePath, maxBytes = WATCHDOG_TAIL_BYTES) {
  const stat = statSync(filePath);
  if (stat.size <= maxBytes) return readFileSync(filePath, "utf8");

  const fd = openSync(filePath, "r");
  try {
    const bytes = Math.max(1, Math.min(maxBytes, stat.size));
    const buffer = Buffer.alloc(bytes);
    readSync(fd, buffer, 0, bytes, stat.size - bytes);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function walkFiles(rootDir, predicate) {
  if (!existsSync(rootDir)) return [];
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath, entry.name)) out.push(fullPath);
    }
  }
  return out;
}

export function collectSessionStats(cwd = process.cwd()) {
  const sessionRoot = path.join(cwd, ".sandbox", "pi-agent", "sessions");
  const files = walkFiles(sessionRoot, (_filePath, name) => name.endsWith(".jsonl"))
    .map((filePath) => {
      const stat = statSync(filePath);
      return {
        path: path.relative(cwd, filePath).split(path.sep).join("/"),
        bytes: stat.size,
        mb: Number((stat.size / 1024 / 1024).toFixed(2)),
        mtimeIso: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  const totalBytes = files.reduce((sum, row) => sum + row.bytes, 0);
  return {
    root: path.relative(cwd, sessionRoot).split(path.sep).join("/"),
    count: files.length,
    totalMb: Number((totalBytes / 1024 / 1024).toFixed(2)),
    files,
    largest: files[0],
    recent: [...files].sort((a, b) => String(b.mtimeIso).localeCompare(String(a.mtimeIso))).slice(0, 5),
  };
}

function findLatestSessionJsonl(cwd = process.cwd()) {
  const sessions = collectSessionStats(cwd);
  const latest = sessions.recent?.[0];
  if (!latest?.path) return undefined;
  return path.join(cwd, latest.path);
}

function collectRegexMatches(text, regex, max = 5) {
  const matches = [];
  for (const match of text.matchAll(regex)) {
    matches.push(String(match[1] ?? "").trim());
    if (matches.length >= max) break;
  }
  return matches;
}

function extractEventLoopMaxValues(events) {
  return events
    .map((event) => {
      const match = PERFORMANCE_WATCHDOG_EVENT_LOOP_MAX_RE.exec(String(event ?? ""));
      const value = Number(match?.[1]);
      return Number.isFinite(value) ? value : undefined;
    })
    .filter((value) => value !== undefined);
}

export function collectPerformanceWatchdogStats(cwd = process.cwd(), options = {}) {
  const configPath = options.configPath
    ?? path.join(homedir(), ".pi", "agent", "extensions", "watchdog", "config.json");
  const config = readJsonIfExists(configPath);
  const latestSessionPath = options.sessionPath ?? findLatestSessionJsonl(cwd);
  const result = {
    available: Boolean(config && !config.__parseError),
    configPath,
    config: config && !config.__parseError ? config : undefined,
    configParseError: config?.__parseError,
    latestSessionPath: latestSessionPath ? path.relative(cwd, latestSessionPath).split(path.sep).join("/") : undefined,
    source: "session-jsonl-tail",
    tailBytes: WATCHDOG_TAIL_BYTES,
    criticalEvents: [],
    safeModeEvents: [],
    persistedEventCount: 0,
    liveEventLoopVisibleExternally: false,
  };

  if (latestSessionPath && existsSync(latestSessionPath)) {
    try {
      const tail = readFileTail(latestSessionPath, WATCHDOG_TAIL_BYTES);
      result.criticalEvents = collectRegexMatches(tail, PERFORMANCE_WATCHDOG_CRITICAL_RE);
      result.safeModeEvents = collectRegexMatches(tail, PERFORMANCE_WATCHDOG_SAFE_MODE_RE);
      result.persistedEventCount = result.criticalEvents.length + result.safeModeEvents.length;
    } catch (err) {
      result.sessionReadError = err instanceof Error ? err.message : String(err);
    }
  }

  const eventLoopMaxValues = extractEventLoopMaxValues([
    ...result.criticalEvents,
    ...result.safeModeEvents,
  ]);
  result.eventLoopMaxValues = eventLoopMaxValues;
  result.eventLoopObservedMaxMs = eventLoopMaxValues.length > 0 ? Math.max(...eventLoopMaxValues) : undefined;
  result.recurring = result.persistedEventCount >= PERFORMANCE_WATCHDOG_RECURRING_EVENT_COUNT;
  result.severe = Number.isFinite(result.eventLoopObservedMaxMs)
    && result.eventLoopObservedMaxMs >= PERFORMANCE_WATCHDOG_SEVERE_EVENT_LOOP_MAX_MS;
  result.thresholdCrossing = result.persistedEventCount > 0;
  result.watchdogClass = result.recurring || result.severe
    ? "recurring-or-severe"
    : result.thresholdCrossing
      ? "warning-threshold-crossing"
      : "none";
  result.operatorAction = result.thresholdCrossing
    ? "operator-tui-watchdog-status-if-laggy"
    : "continue";

  const thresholds = config?.thresholds;
  const eventLoopMaxMs = Number(thresholds?.eventLoopMaxMs);
  const eventLoopP99Ms = Number(thresholds?.eventLoopP99Ms);
  result.thresholdSummary = {
    eventLoopMaxMs: Number.isFinite(eventLoopMaxMs) ? eventLoopMaxMs : undefined,
    eventLoopP99Ms: Number.isFinite(eventLoopP99Ms) ? eventLoopP99Ms : undefined,
    heapUsedMb: Number.isFinite(Number(thresholds?.heapUsedMb)) ? Number(thresholds.heapUsedMb) : undefined,
    rssMb: Number.isFinite(Number(thresholds?.rssMb)) ? Number(thresholds.rssMb) : undefined,
  };
  result.summary = [
    "performance-watchdog:",
    `config=${result.available ? "present" : "missing"}`,
    `eventLoopMaxMs=${result.thresholdSummary.eventLoopMaxMs ?? "n/a"}`,
    `eventLoopP99Ms=${result.thresholdSummary.eventLoopP99Ms ?? "n/a"}`,
    `persistedEvents=${result.persistedEventCount}`,
    `eventLoopObservedMaxMs=${result.eventLoopObservedMaxMs ?? "n/a"}`,
    `recurring=${result.recurring ? "yes" : "no"}`,
    `severe=${result.severe ? "yes" : "no"}`,
    `thresholdCrossing=${result.thresholdCrossing ? "yes" : "no"}`,
    `watchdogClass=${result.watchdogClass}`,
    `operatorAction=${result.operatorAction}`,
    "liveEventLoopExternal=no",
  ].join(" ");
  return result;
}

const STATIC_IMPORT_RE = /(?:import\s+(?!type\b)|export\s+(?!type\b))(?:[^'"]*?from\s+)?["'](\.\.?\/[^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;

function resolveRelativeModule(specifier, baseFile) {
  const base = path.resolve(path.dirname(baseFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.js`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function collectImportGraph(entryFile, allowedRoot, options = {}, seen = new Set()) {
  const filePath = path.resolve(entryFile);
  if (seen.has(filePath)) return seen;
  const relativeToAllowedRoot = path.relative(path.resolve(allowedRoot), filePath);
  if (relativeToAllowedRoot.startsWith("..") || path.isAbsolute(relativeToAllowedRoot)) return seen;
  seen.add(filePath);

  let source = "";
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return seen;
  }

  const importRe = new RegExp(STATIC_IMPORT_RE);
  let match;
  while ((match = importRe.exec(source))) {
    const specifier = match[1];
    const resolved = resolveRelativeModule(specifier, filePath);
    if (resolved) collectImportGraph(resolved, allowedRoot, options, seen);
  }

  if (options.includeDynamicImports) {
    const dynamicImportRe = new RegExp(DYNAMIC_IMPORT_RE);
    while ((match = dynamicImportRe.exec(source))) {
      const specifier = match[1];
      const resolved = resolveRelativeModule(specifier, filePath);
      if (resolved) collectImportGraph(resolved, allowedRoot, options, seen);
    }
  }
  return seen;
}

function sumGraphKb(graph) {
  let bytes = 0;
  for (const filePath of graph) bytes += statSync(filePath).size;
  return Number((bytes / 1024).toFixed(1));
}

function normalizeSurfacePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function extensionFilterSets(entry) {
  const values = isRecord(entry) && Array.isArray(entry.extensions) ? entry.extensions : [];
  const includes = new Set();
  const excludes = new Set();
  for (const value of values) {
    if (typeof value !== "string") continue;
    if (value.startsWith("!")) {
      excludes.add(normalizeSurfacePath(value.slice(1)));
      continue;
    }
    includes.add(normalizeSurfacePath(value));
  }
  return { includes, excludes };
}

function applyExtensionFilters(extensions, entry) {
  const { includes, excludes } = extensionFilterSets(entry);
  const normalized = extensions.map((extension) => ({
    original: extension,
    normalized: normalizeSurfacePath(extension),
  }));
  return normalized
    .filter((extension) => includes.size === 0 || includes.has(extension.normalized))
    .filter((extension) => !excludes.has(extension.normalized))
    .map((extension) => extension.original);
}

function resolveConfiguredPackageRoot(cwd, settingsPath, source) {
  if (typeof source !== "string") return undefined;
  const raw = source.startsWith("npm:") ? source.slice("npm:".length) : source;
  if (raw.startsWith(".") || raw.startsWith("/") || path.isAbsolute(raw)) {
    const settingsDir = path.dirname(settingsPath);
    return path.resolve(settingsDir, raw);
  }
  if (raw.startsWith("@") || /^[a-z0-9._-]+(?:\/[a-z0-9._-]+)?$/i.test(raw)) {
    return path.join(cwd, "node_modules", raw);
  }
  return undefined;
}

function collectPackageEntrypointStats({ packageRoot, packageSource: source, settingsLabel, configuredEntry }) {
  const packagePath = path.join(packageRoot, "package.json");
  const pkg = readJsonIfExists(packagePath);
  const extensions = Array.isArray(pkg?.pi?.extensions) ? pkg.pi.extensions : [];
  const effectiveExtensions = applyExtensionFilters(extensions, configuredEntry);
  return effectiveExtensions
    .map((entry) => {
      const entryPath = path.resolve(path.dirname(packagePath), entry);
      if (!existsSync(entryPath)) return undefined;
      const eagerGraph = collectImportGraph(entryPath, packageRoot);
      const reachableGraph = collectImportGraph(entryPath, packageRoot, { includeDynamicImports: true });
      return {
        settings: settingsLabel,
        package: source,
        packageRoot,
        entry,
        files: eagerGraph.size,
        kb: sumGraphKb(eagerGraph),
        reachableFiles: reachableGraph.size,
        reachableKb: sumGraphKb(reachableGraph),
        lazyFiles: Math.max(0, reachableGraph.size - eagerGraph.size),
      };
    })
    .filter(Boolean);
}

export function collectEntrypointStats(cwd = process.cwd()) {
  const packagePath = path.join(cwd, "packages", "pi-stack", "package.json");
  const pkg = readJsonIfExists(packagePath);
  const extensions = Array.isArray(pkg?.pi?.extensions) ? pkg.pi.extensions : [];
  const extensionRoot = path.join(cwd, "packages", "pi-stack", "extensions");

  return extensions
    .map((entry) => {
      const entryPath = path.resolve(path.dirname(packagePath), entry);
      const eagerGraph = collectImportGraph(entryPath, extensionRoot);
      const reachableGraph = collectImportGraph(entryPath, extensionRoot, { includeDynamicImports: true });
      return {
        entry,
        files: eagerGraph.size,
        kb: sumGraphKb(eagerGraph),
        reachableFiles: reachableGraph.size,
        reachableKb: sumGraphKb(reachableGraph),
        lazyFiles: Math.max(0, reachableGraph.size - eagerGraph.size),
      };
    })
    .sort((a, b) => b.kb - a.kb);
}

export function collectConfiguredEntrypointStats(cwd = process.cwd()) {
  const settingsPaths = [
    [".pi/settings.json", path.join(cwd, ".pi", "settings.json")],
    [".sandbox/pi-agent/settings.json", path.join(cwd, ".sandbox", "pi-agent", "settings.json")],
  ];
  const rows = [];
  for (const [label, filePath] of settingsPaths) {
    const settings = readJsonIfExists(filePath);
    const packages = Array.isArray(settings?.packages) ? settings.packages : [];
    for (const entry of packages) {
      const source = packageSource(entry);
      const packageRoot = resolveConfiguredPackageRoot(cwd, filePath, source);
      if (!source || !packageRoot || !existsSync(packageRoot)) continue;
      rows.push(...collectPackageEntrypointStats({
        packageRoot,
        packageSource: source,
        settingsLabel: label,
        configuredEntry: entry,
      }));
    }
  }
  return rows.sort((a, b) => b.kb - a.kb);
}

export function buildEntrypointBudget(entrypoints, thresholds = DEFAULT_THRESHOLDS) {
  const rows = Array.isArray(entrypoints) ? entrypoints : [];
  const oversized = rows
    .filter((row) => row.kb >= thresholds.heavyEntrypointKb || row.files >= thresholds.heavyEntrypointFiles)
    .map((row) => ({
      ...row,
      overKbBy: row.kb >= thresholds.heavyEntrypointKb
        ? Number((row.kb - thresholds.heavyEntrypointKb).toFixed(1))
        : 0,
      overFilesBy: row.files >= thresholds.heavyEntrypointFiles
        ? row.files - thresholds.heavyEntrypointFiles
        : 0,
    }));

  return {
    heavyEntrypointKb: thresholds.heavyEntrypointKb,
    heavyEntrypointFiles: thresholds.heavyEntrypointFiles,
    oversized,
    recommendation: oversized.length > 0
      ? "split-hot-path-or-move-diagnostics-behind-opt-in"
      : "within-budget",
  };
}

function packageSource(entry) {
  if (typeof entry === "string") return entry;
  if (isRecord(entry) && typeof entry.source === "string") return entry.source;
  return undefined;
}

function isSurfaceSuppressed(entry) {
  if (!isRecord(entry)) return false;
  const keys = ["extensions", "skills", "themes"];
  return keys.every((key) => Array.isArray(entry[key]) && entry[key].length === 0);
}

function countSuppressionFilters(packages, key) {
  return packages.reduce((sum, entry) => {
    if (!isRecord(entry) || !Array.isArray(entry[key])) return sum;
    return sum + entry[key].filter((value) => typeof value === "string" && value.startsWith("!")).length;
  }, 0);
}

function listSuppressedExtensions(packages) {
  const out = [];
  for (const entry of packages) {
    if (!isRecord(entry) || !Array.isArray(entry.extensions)) continue;
    const source = packageSource(entry) ?? "unknown";
    for (const value of entry.extensions) {
      if (typeof value === "string" && value.startsWith("!")) out.push(`${source}:${value}`);
    }
  }
  return out;
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value ?? ""));
}

function classifyShellPath(shellPath, { platform = process.platform, pathExists = existsSync } = {}) {
  if (typeof shellPath !== "string" || !shellPath.trim()) {
    return { configured: false };
  }
  const value = shellPath.trim();
  const windowsAbsolute = isWindowsAbsolutePath(value);
  const nativeAbsolute = path.isAbsolute(value);
  const absolute = windowsAbsolute || nativeAbsolute;

  if (windowsAbsolute && platform !== "win32") {
    return {
      configured: true,
      value,
      valid: false,
      reason: "windows-path-on-non-windows",
    };
  }
  if (absolute && !pathExists(value)) {
    return {
      configured: true,
      value,
      valid: false,
      reason: "path-not-found",
    };
  }
  return {
    configured: true,
    value,
    valid: absolute ? true : undefined,
    reason: absolute ? undefined : "path-lookup-not-validated",
  };
}

export function collectSettingsStats(cwd = process.cwd()) {
  const settingsPaths = [
    [".pi/settings.json", path.join(cwd, ".pi", "settings.json")],
    [".sandbox/pi-agent/settings.json", path.join(cwd, ".sandbox", "pi-agent", "settings.json")],
  ];

  return settingsPaths.map(([label, filePath]) => {
    const settings = readJsonIfExists(filePath);
    const packages = Array.isArray(settings?.packages) ? settings.packages : [];
    const sources = packages.map(packageSource).filter(Boolean);
    const shellPath = classifyShellPath(settings?.shellPath);
    return {
      path: label,
      exists: existsSync(filePath),
      parseError: settings?.__parseError,
      shellPath,
      packageCount: packages.length,
      localPackageCount: sources.filter((source) => source.startsWith(".") || source.startsWith("/")).length,
      npmPackageCount: sources.filter((source) => source.startsWith("npm:")).length,
      suppressedSurfaceCount: packages.filter(isSurfaceSuppressed).length,
      extensionExcludeCount: countSuppressionFilters(packages, "extensions"),
      skillExcludeCount: countSuppressionFilters(packages, "skills"),
      themeExcludeCount: countSuppressionFilters(packages, "themes"),
      suppressedExtensions: listSuppressedExtensions(packages),
      sources,
    };
  });
}

export function collectLoopState(cwd = process.cwd(), now = new Date()) {
  const loopPath = path.join(cwd, ".pi", "long-run-loop-state.json");
  const state = readJsonIfExists(loopPath);
  if (!state || state.__parseError) {
    return { exists: existsSync(loopPath), parseError: state?.__parseError };
  }
  const leaseExpiresAt = typeof state.leaseExpiresAtIso === "string" ? Date.parse(state.leaseExpiresAtIso) : NaN;
  const leaseExpired = Number.isFinite(leaseExpiresAt) ? leaseExpiresAt < now.getTime() : undefined;
  return {
    exists: true,
    mode: state.mode,
    health: state.health,
    stopCondition: state.stopCondition,
    leaseOwner: state.leaseOwner,
    leaseExpiresAtIso: state.leaseExpiresAtIso,
    leaseExpired,
  };
}

export function collectGitDirtyStats(cwd = process.cwd()) {
  const run = spawnSync("git", ["-c", "core.safecrlf=false", "status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (run.status !== 0) {
    return {
      available: false,
      error: (run.stderr || run.stdout || "git status failed").trim(),
    };
  }
  const rows = String(run.stdout ?? "").split(/\r?\n/).filter(Boolean);
  return {
    available: true,
    count: rows.length,
    tracked: rows.filter((line) => !line.startsWith("??")).length,
    untracked: rows.filter((line) => line.startsWith("??")).length,
  };
}

export function collectVelocityStats(cwd = process.cwd(), options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();
  const machine = options.machine ?? collectMachineStats(cwd);
  const board = options.board ?? collectBoardStateStats(cwd);
  const handoff = options.handoff ?? collectHandoffStats(cwd, nowMs);
  const commit = options.commit ?? collectLastCommitStats(cwd, nowMs);
  const agentRuns = options.agentRuns ?? collectAgentRunPressureStats(cwd, nowMs);
  const ceremony = options.ceremony ?? collectCeremonyPressureStats(cwd);
  const runtime = options.runtime ?? {
    processUptimeMinutes: Number((Number(options.processUptimeSeconds ?? process.uptime()) / 60).toFixed(1)),
  };
  return { machine, board, handoff, commit, agentRuns, ceremony, runtime };
}

export function collectMachineStats(cwd = process.cwd()) {
  const totalMb = toMb(totalmem());
  const freeMb = toMb(freemem());
  const usedPct = totalMb > 0 ? Number((((totalMb - freeMb) / totalMb) * 100).toFixed(1)) : 0;
  let disk = { available: false };
  try {
    const stat = statfsSync(cwd);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    disk = {
      available: true,
      totalMb: toMb(totalBytes),
      freeMb: toMb(freeBytes),
      usedPct: totalBytes > 0 ? Number(((1 - freeBytes / totalBytes) * 100).toFixed(1)) : 0,
    };
  } catch (error) {
    disk = { available: false, error: String(error?.message ?? error) };
  }
  return {
    memory: { totalMb, freeMb, usedPct },
    disk,
  };
}

export function collectHandoffStats(cwd = process.cwd(), nowMs = Date.now()) {
  const handoffPath = path.join(cwd, ".project", "handoff.json");
  const handoff = readJsonIfExists(handoffPath);
  if (!handoff || handoff.__parseError) {
    return { exists: existsSync(handoffPath), parseError: handoff?.__parseError };
  }
  const timestampMs = typeof handoff.timestamp === "string" ? Date.parse(handoff.timestamp) : NaN;
  return {
    exists: true,
    timestamp: handoff.timestamp,
    ageMinutes: minutesBetween(nowMs, timestampMs),
    currentTasks: Array.isArray(handoff.current_tasks) ? handoff.current_tasks.slice(0, 5) : [],
  };
}

export function collectLastCommitStats(cwd = process.cwd(), nowMs = Date.now()) {
  const run = spawnSync("git", ["log", "-1", "--format=%ct"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (run.status !== 0) {
    return {
      available: false,
      error: (run.stderr || run.stdout || "git log failed").trim(),
    };
  }
  const epochSeconds = Number(String(run.stdout ?? "").trim());
  const commitMs = Number.isFinite(epochSeconds) ? epochSeconds * 1000 : NaN;
  return {
    available: true,
    committedAtIso: Number.isFinite(commitMs) ? new Date(commitMs).toISOString() : undefined,
    minutesSinceUsefulCommit: minutesBetween(nowMs, commitMs),
  };
}

export function collectAgentRunPressureStats(cwd = process.cwd(), nowMs = Date.now()) {
  const registryPath = path.join(cwd, ".pi", "reports", "agent-runs.json");
  const registry = readJsonIfExists(registryPath);
  if (!registry || registry.__parseError) {
    return { available: existsSync(registryPath), parseError: registry?.__parseError };
  }
  const runs = Array.isArray(registry.runs) ? registry.runs : [];
  const activeStates = new Set(["running", "started", "starting", "pending"]);
  const active = runs.filter((run) => activeStates.has(String(run?.state ?? "").toLowerCase()));
  const dangling = active.filter((run) => {
    const lastEventMs = typeof run?.lastEventAtIso === "string" ? Date.parse(run.lastEventAtIso) : NaN;
    const timeoutMs = Number.isFinite(Number(run?.timeoutMs)) ? Number(run.timeoutMs) : 90_000;
    return Number.isFinite(lastEventMs) && nowMs - lastEventMs > Math.max(timeoutMs * 2, 5 * 60_000);
  });
  return {
    available: true,
    activeCount: active.length,
    danglingProcessCount: dangling.length,
    danglingRunIds: dangling.map((run) => String(run.runId ?? "unknown")).slice(0, 10),
  };
}

export function collectCeremonyPressureStats(cwd = process.cwd()) {
  const markerPath = path.join(cwd, ".pi", "reports", "dev-ceremony-pressure.json");
  const marker = readJsonIfExists(markerPath);
  if (!marker || marker.__parseError) {
    return { available: existsSync(markerPath), parseError: marker?.__parseError };
  }
  return {
    available: true,
    toolCallsSinceUsefulCommit: Number(marker.toolCallsSinceUsefulCommit ?? 0),
    boardReadCount: Number(marker.boardReadCount ?? 0),
    slowToolCount: Number(marker.slowToolCount ?? 0),
  };
}

export function buildVelocityPressureSignals(velocity, thresholds = DEFAULT_THRESHOLDS) {
  const signals = [];
  const memory = velocity?.machine?.memory;
  if (memory && memory.usedPct >= thresholds.memoryBlockUsedPct) {
    signals.push({ level: "block", code: "machine-memory-pressure", detail: `memory used=${memory.usedPct}% free=${memory.freeMb} MB` });
  } else if (memory && memory.usedPct >= thresholds.memoryWarnUsedPct) {
    signals.push({ level: "warn", code: "machine-memory-pressure", detail: `memory used=${memory.usedPct}% free=${memory.freeMb} MB` });
  }

  const disk = velocity?.machine?.disk;
  if (disk?.available && disk.freeMb <= thresholds.diskBlockFreeMb) {
    signals.push({ level: "block", code: "machine-disk-pressure", detail: `disk free=${disk.freeMb} MB used=${disk.usedPct}%` });
  } else if (disk?.available && disk.freeMb <= thresholds.diskWarnFreeMb) {
    signals.push({ level: "warn", code: "machine-disk-pressure", detail: `disk free=${disk.freeMb} MB used=${disk.usedPct}%` });
  }

  const board = velocity?.board;
  if (board?.exists && board.mb >= thresholds.boardWarnMb) {
    signals.push({ level: "warn", code: "large-board-state", detail: formatBoardPressureDetail(board) });
  }

  const handoff = velocity?.handoff;
  if (handoff?.ageMinutes >= thresholds.handoffWarnMinutes) {
    signals.push({ level: "info", code: "stale-handoff", detail: `handoffAge=${handoff.ageMinutes} minutes` });
  }

  const commit = velocity?.commit;
  if (commit?.available && commit.minutesSinceUsefulCommit >= thresholds.usefulCommitWarnMinutes) {
    signals.push({ level: "warn", code: "stale-useful-commit", detail: `minutesSinceUsefulCommit=${commit.minutesSinceUsefulCommit}` });
  }

  const runtime = velocity?.runtime;
  if (runtime?.processUptimeMinutes >= thresholds.processAgeWarnMinutes) {
    signals.push({ level: "warn", code: "long-dev-process", detail: `processUptime=${runtime.processUptimeMinutes} minutes` });
  }

  const agentRuns = velocity?.agentRuns;
  if (agentRuns?.danglingProcessCount >= thresholds.danglingProcessWarn) {
    signals.push({ level: "warn", code: "dangling-agent-run-process", detail: `dangling=${agentRuns.danglingProcessCount} active=${agentRuns.activeCount ?? "n/a"}` });
  }

  const ceremony = velocity?.ceremony;
  if (
    ceremony?.toolCallsSinceUsefulCommit >= thresholds.ceremonyToolCallWarn ||
    ceremony?.boardReadCount >= thresholds.ceremonyBoardReadWarn
  ) {
    signals.push({
      level: "warn",
      code: "excessive-control-plane-ceremony",
      detail: `toolCalls=${ceremony.toolCallsSinceUsefulCommit ?? "n/a"} boardReads=${ceremony.boardReadCount ?? "n/a"} slowTools=${ceremony.slowToolCount ?? "n/a"}`,
    });
  }

  return signals;
}

export function buildPiDevPressureReport(cwd = process.cwd(), options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const sessions = collectSessionStats(cwd);
  const sessionBudget = buildSessionBudget(sessions, thresholds);
  const entrypoints = collectEntrypointStats(cwd);
  const entrypointBudget = buildEntrypointBudget(entrypoints, thresholds);
  const configuredEntrypoints = collectConfiguredEntrypointStats(cwd);
  const configuredEntrypointBudget = buildEntrypointBudget(configuredEntrypoints, thresholds);
  const settings = collectSettingsStats(cwd);
  const sandboxSettingsPath = path.join(cwd, ".sandbox", "pi-agent", "settings.json");
  const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
  const capabilityGuidance = buildControlPlaneCapabilityGuidance(
    readJsonIfExists(sandboxSettingsPath) ?? readJsonIfExists(projectSettingsPath) ?? {},
  );
  const loop = collectLoopState(cwd, options.now ?? new Date());
  const git = options.git === false ? { available: false, skipped: true } : collectGitDirtyStats(cwd);
  const velocity = options.velocityStats ?? collectVelocityStats(cwd, { ...(options.velocity ?? {}), now: options.now });
  const performanceWatchdog = options.performanceWatchdog ?? collectPerformanceWatchdogStats(cwd);
  const boardPressurePlan = buildBoardPressurePlan(velocity.board, thresholds);

  const signals = [];
  const largestSessionMb = sessions.largest?.mb ?? 0;
  if (largestSessionMb >= thresholds.blockingSessionMb) {
    signals.push({ level: "block", code: "huge-resume-session", detail: `${largestSessionMb} MB session jsonl` });
  } else if (largestSessionMb >= thresholds.largeSessionMb) {
    signals.push({ level: "warn", code: "large-resume-session", detail: `${largestSessionMb} MB session jsonl` });
  }

  const heaviestEntrypoint = entrypoints[0];
  const heaviestConfiguredEntrypoint = configuredEntrypoints[0];
  if (
    heaviestConfiguredEntrypoint &&
    (heaviestConfiguredEntrypoint.kb >= thresholds.heavyEntrypointKb ||
      heaviestConfiguredEntrypoint.files >= thresholds.heavyEntrypointFiles)
  ) {
    signals.push({
      level: "warn",
      code: "heavy-configured-extension-entrypoint",
      detail: `${heaviestConfiguredEntrypoint.package}:${heaviestConfiguredEntrypoint.entry} files=${heaviestConfiguredEntrypoint.files} kb=${heaviestConfiguredEntrypoint.kb}`,
    });
  }

  const suppressed = settings.reduce((sum, row) => sum + row.suppressedSurfaceCount, 0);
  if (suppressed > 0) {
    signals.push({ level: "info", code: "suppressed-package-entries", detail: `${suppressed} package entries expose no surfaces` });
  }
  const coldIntentCapabilities = capabilityGuidance.filter((row) =>
    row.state === "cold" && row.activation !== "always-on"
  );
  if (coldIntentCapabilities.length > 0) {
    signals.push({
      level: "info",
      code: "cold-capabilities-available-on-intent",
      detail: coldIntentCapabilities.map((row) => `${row.id}:${row.activation}`).join(", "),
    });
  }
  const invalidShellPaths = settings.filter((row) => row.shellPath?.configured && row.shellPath.valid === false);
  for (const row of invalidShellPaths) {
    signals.push({
      level: "block",
      code: "invalid-runtime-shell-path",
      detail: `${row.path} shellPath=${row.shellPath.value} reason=${row.shellPath.reason}`,
    });
  }

  if (loop.exists && loop.mode === "running" && loop.leaseExpired === true && loop.stopCondition === "none") {
    signals.push({ level: "warn", code: "stale-running-loop-lease", detail: `${loop.leaseOwner ?? "unknown"} expired at ${loop.leaseExpiresAtIso ?? "unknown"}` });
  }

  if (git.available && git.count >= thresholds.dirtyFileWarn) {
    signals.push({ level: "warn", code: "wide-dirty-scope", detail: `${git.count} dirty files` });
  }
  if ((performanceWatchdog.criticalEvents?.length ?? 0) > 0 || (performanceWatchdog.safeModeEvents?.length ?? 0) > 0) {
    signals.push({
      level: "warn",
      code: performanceWatchdog.watchdogClass === "recurring-or-severe"
        ? "recurring-or-severe-performance-watchdog-event"
        : "recent-performance-watchdog-event",
      detail: [
        `persistedEvents=${performanceWatchdog.persistedEventCount}`,
        `eventLoopObservedMaxMs=${performanceWatchdog.eventLoopObservedMaxMs ?? "n/a"}`,
        `recurring=${performanceWatchdog.recurring ? "yes" : "no"}`,
        `severe=${performanceWatchdog.severe ? "yes" : "no"}`,
        `watchdogClass=${performanceWatchdog.watchdogClass ?? "n/a"}`,
      ].join(" "),
    });
  } else if (
    performanceWatchdog.available &&
    Number.isFinite(performanceWatchdog.thresholdSummary?.eventLoopMaxMs) &&
    performanceWatchdog.thresholdSummary.eventLoopMaxMs <= 300
  ) {
    signals.push({
      level: "info",
      code: "sensitive-performance-watchdog-max-threshold",
      detail: `eventLoopMaxMs=${performanceWatchdog.thresholdSummary.eventLoopMaxMs}; p99=${performanceWatchdog.thresholdSummary.eventLoopP99Ms ?? "n/a"}`,
    });
  }
  signals.push(...buildVelocityPressureSignals(velocity, thresholds));

  let recommendation = "continue";
  if (signals.some((signal) => signal.level === "block")) recommendation = "block-and-clean";
  else if (signals.some((signal) => signal.code === "large-resume-session")) recommendation = "new-session";
  else if (signals.some((signal) => signal.code === "heavy-configured-extension-entrypoint")) recommendation = "reduce-governance-surface";
  else if (signals.some((signal) => signal.code === "large-board-state")) recommendation = "reduce-governance-surface";
  else if (signals.some((signal) => signal.code === "wide-dirty-scope")) recommendation = "checkpoint-and-commit";
  else if (signals.some((signal) => signal.code === "stale-useful-commit")) recommendation = "checkpoint-and-commit";
  else if (signals.some((signal) => signal.code === "dangling-agent-run-process")) recommendation = "checkpoint-and-commit";
  else if (signals.some((signal) => signal.code === "excessive-control-plane-ceremony")) recommendation = "reduce-governance-surface";
  else if (signals.some((signal) => signal.code === "long-dev-process")) recommendation = "new-session";

  const velocityPressure = buildDevelopmentVelocityPressure({ signals });
  const pressureSignalCount = signals.filter((signal) => signal.level !== "info").length;
  const advisoryCount = signals.length - pressureSignalCount;

  return {
    mode: "pi-dev-pressure",
    cwd: path.resolve(cwd),
    thresholds,
    recommendation,
    pressureSignalCount,
    advisoryCount,
    velocityPressure,
    signals,
    sessions,
    sessionBudget,
    entrypointBudget,
    configuredEntrypointBudget,
    entrypoints: entrypoints.slice(0, 10),
    configuredEntrypoints: configuredEntrypoints.slice(0, 15).map(({ packageRoot: _packageRoot, ...row }) => row),
    settings,
    loop,
    git,
    velocity,
    boardPressurePlan,
    performanceWatchdog,
    capabilityGuidance,
    summary: `pi-dev-pressure: recommendation=${recommendation} pressure=${pressureSignalCount} advisories=${advisoryCount} signals=${signals.length} largestSessionMb=${largestSessionMb} heaviestConfiguredEntrypoint=${heaviestConfiguredEntrypoint ? `${heaviestConfiguredEntrypoint.package}:${heaviestConfiguredEntrypoint.entry}` : "n/a"}`,
  };
}

export { buildDevelopmentVelocityPressure, buildSessionBudget, computeStrictFailures };

function resolveSessionBudgetCleanupTargets(report) {
  const cwd = path.resolve(report.cwd ?? process.cwd());
  const blockers = Array.isArray(report.sessionBudget?.blockers) ? report.sessionBudget.blockers : [];
  return blockers.map((row) => {
    const absolutePath = path.resolve(cwd, row.path);
    const relative = path.relative(cwd, absolutePath);
    const insideCwd = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
    const insideSandboxSessions = row.path.startsWith(".sandbox/pi-agent/sessions/");
    return {
      path: row.path,
      absolutePath,
      mb: row.mb,
      allowed: Boolean(insideCwd && insideSandboxSessions && existsSync(absolutePath)),
      reason: insideCwd && insideSandboxSessions ? "session-budget-blocker" : "path-guard-blocked",
    };
  });
}

export function buildSessionBudgetCleanupPlan(report, { apply = false } = {}) {
  const targets = resolveSessionBudgetCleanupTargets(report);
  const deleted = [];
  const skipped = [];

  for (const target of targets) {
    if (!target.allowed) {
      skipped.push(target);
      continue;
    }
    if (apply) {
      rmSync(target.absolutePath, { force: true });
      deleted.push(target);
    }
  }

  return {
    mode: apply ? "apply" : "dry-run",
    recommendation: targets.length > 0
      ? "delete-only-after-checkpoint-or-operator-confirmation"
      : "no-session-budget-blockers",
    targets: targets.map(({ absolutePath: _absolutePath, ...target }) => target),
    deleted: deleted.map(({ absolutePath: _absolutePath, ...target }) => target),
    skipped: skipped.map(({ absolutePath: _absolutePath, ...target }) => target),
  };
}

function parseArgs(argv) {
  const out = { cwd: process.cwd(), json: false, strict: false, cleanupSessions: false, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") {
      out.cwd = argv[++i] ?? out.cwd;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "--strict") {
      out.strict = true;
      continue;
    }
    if (arg === "--cleanup-sessions") {
      out.cleanupSessions = true;
      continue;
    }
    if (arg === "--apply") {
      out.apply = true;
      continue;
    }
  }
  return out;
}

function printHuman(report) {
  const lines = [report.summary];
  if (report.velocityPressure) lines.push(`- ${report.velocityPressure.summary}`);
  for (const signal of report.signals) lines.push(`- [${signal.level}] ${signal.code}: ${signal.detail}`);
  lines.push(`- sessions: count=${report.sessions.count} totalMb=${report.sessions.totalMb} largest=${report.sessions.largest?.mb ?? 0} MB`);
  if (report.sessionBudget?.oversized?.length > 0) {
    lines.push(`- session budget: ${report.sessionBudget.recommendation}`);
    for (const row of report.sessionBudget.oversized.slice(0, 5)) {
      lines.push(`  - [${row.level}] ${row.path}: ${row.mb} MB`);
    }
  }
  lines.push(`- settings: ${report.settings.map((row) => `${row.path} packages=${row.packageCount} suppressed=${row.suppressedSurfaceCount} extExcludes=${row.extensionExcludeCount ?? 0}`).join("; ")}`);
  if (report.loop.exists) {
    lines.push(`- loop: mode=${report.loop.mode ?? "unknown"} health=${report.loop.health ?? "unknown"} stop=${report.loop.stopCondition ?? "unknown"} leaseExpired=${report.loop.leaseExpired ?? "unknown"}`);
  }
  if (report.velocity) {
    const velocityParts = [
      `boardMb=${report.velocity.board?.mb ?? "n/a"}`,
      `handoffAgeMin=${report.velocity.handoff?.ageMinutes ?? "n/a"}`,
      `minutesSinceCommit=${report.velocity.commit?.minutesSinceUsefulCommit ?? "n/a"}`,
      `memoryUsed=${report.velocity.machine?.memory?.usedPct ?? "n/a"}%`,
      `diskFreeMb=${report.velocity.machine?.disk?.freeMb ?? "n/a"}`,
      `danglingRuns=${report.velocity.agentRuns?.danglingProcessCount ?? "n/a"}`,
      `toolCalls=${report.velocity.ceremony?.toolCallsSinceUsefulCommit ?? "n/a"}`,
      `boardReads=${report.velocity.ceremony?.boardReadCount ?? "n/a"}`,
      `processUptimeMin=${report.velocity.runtime?.processUptimeMinutes ?? "n/a"}`,
    ];
    lines.push(`- velocity: ${velocityParts.join(" ")}`);
  }
  if (report.performanceWatchdog) {
    lines.push(`- ${report.performanceWatchdog.summary}`);
    if (report.performanceWatchdog.persistedEventCount === 0) {
      lines.push("- performance-watchdog note: live event-loop lag is runtime-local; this preflight can see config and persisted session events only");
    }
    for (const event of report.performanceWatchdog.criticalEvents?.slice(0, 3) ?? []) {
      lines.push(`  - critical: ${event}`);
    }
    for (const event of report.performanceWatchdog.safeModeEvents?.slice(0, 3) ?? []) {
      lines.push(`  - safe-mode: ${event}`);
    }
  }
  if (report.capabilityGuidance?.length > 0) {
    const cold = report.capabilityGuidance
      .filter((row) => row.state === "cold")
      .map((row) => `${row.id}:${row.activation}`)
      .join(", ");
    lines.push(`- capabilities: cold=${cold || "none"} activation=by-intent`);
  }
  lines.push("- heaviest entrypoints:");
  for (const row of report.entrypoints.slice(0, 5)) {
    lines.push(`  - ${row.entry}: files=${row.files} kb=${row.kb}`);
  }
  if (report.configuredEntrypoints?.length > 0) {
    lines.push("- heaviest configured entrypoints:");
    for (const row of report.configuredEntrypoints.slice(0, 8)) {
      lines.push(`  - ${row.package}:${row.entry}: files=${row.files} kb=${row.kb} (${row.settings})`);
    }
  }
  if (report.entrypointBudget?.oversized?.length > 0) {
    lines.push(`- entrypoint budget: ${report.entrypointBudget.recommendation}`);
    for (const row of report.entrypointBudget.oversized.slice(0, 5)) {
      lines.push(`  - ${row.entry}: +${row.overFilesBy} files, +${row.overKbBy} KB`);
    }
  }
  if (report.configuredEntrypointBudget?.oversized?.length > 0) {
    lines.push(`- configured entrypoint budget: ${report.configuredEntrypointBudget.recommendation}`);
    for (const row of report.configuredEntrypointBudget.oversized.slice(0, 5)) {
      lines.push(`  - ${row.package}:${row.entry}: +${row.overFilesBy} files, +${row.overKbBy} KB`);
    }
  }
  return lines.join("\n");
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  const report = buildPiDevPressureReport(args.cwd);
  const cleanupPlan = args.cleanupSessions
    ? buildSessionBudgetCleanupPlan(report, { apply: args.apply })
    : undefined;
  if (args.json) {
    console.log(JSON.stringify(cleanupPlan ? { ...report, cleanupPlan } : report, null, 2));
  } else {
    console.log(printHuman(report));
    if (cleanupPlan) {
      console.log(`session cleanup: mode=${cleanupPlan.mode} recommendation=${cleanupPlan.recommendation}`);
      for (const target of cleanupPlan.targets) {
        console.log(`  - ${target.path} (${target.mb} MB) allowed=${target.allowed} reason=${target.reason}`);
      }
      if (cleanupPlan.deleted.length > 0) console.log(`deleted: ${cleanupPlan.deleted.length}`);
      if (cleanupPlan.skipped.length > 0) console.log(`skipped: ${cleanupPlan.skipped.length}`);
    }
  }

  if (args.strict) {
    const failures = computeStrictFailures(report);
    if (failures.length > 0) {
      console.error(`pi-dev-pressure strict failures: ${failures.join(", ")}`);
      process.exit(1);
    }
  }
}
