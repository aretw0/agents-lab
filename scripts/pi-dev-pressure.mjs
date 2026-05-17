#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_THRESHOLDS = {
  largeSessionMb: 50,
  blockingSessionMb: 150,
  heavyEntrypointKb: 750,
  heavyEntrypointFiles: 70,
  dirtyFileWarn: 8,
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    return { __parseError: err instanceof Error ? err.message : String(err) };
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

export function buildSessionBudget(sessions, thresholds = DEFAULT_THRESHOLDS) {
  const files = Array.isArray(sessions?.files) ? sessions.files : [];
  const oversized = files
    .filter((row) => row.mb >= thresholds.largeSessionMb)
    .map((row) => ({
      ...row,
      level: row.mb >= thresholds.blockingSessionMb ? "block" : "warn",
      overLargeByMb: Number((row.mb - thresholds.largeSessionMb).toFixed(2)),
      overBlockByMb: row.mb >= thresholds.blockingSessionMb
        ? Number((row.mb - thresholds.blockingSessionMb).toFixed(2))
        : 0,
    }));

  const blockers = oversized.filter((row) => row.level === "block");
  const recommendation = blockers.length > 0
    ? "do-not-resume-archive-or-delete-after-checkpoint"
    : oversized.length > 0
      ? "prefer-new-session-and-checkpoint-before-resume"
      : "within-budget";

  return {
    largeSessionMb: thresholds.largeSessionMb,
    blockingSessionMb: thresholds.blockingSessionMb,
    oversized,
    blockers,
    recommendation,
  };
}

const STATIC_IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?from\s+)?["'](\.\.?\/[^"']+)["']/g;
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

export function collectSettingsStats(cwd = process.cwd()) {
  const settingsPaths = [
    [".pi/settings.json", path.join(cwd, ".pi", "settings.json")],
    [".sandbox/pi-agent/settings.json", path.join(cwd, ".sandbox", "pi-agent", "settings.json")],
  ];

  return settingsPaths.map(([label, filePath]) => {
    const settings = readJsonIfExists(filePath);
    const packages = Array.isArray(settings?.packages) ? settings.packages : [];
    const sources = packages.map(packageSource).filter(Boolean);
    return {
      path: label,
      exists: existsSync(filePath),
      parseError: settings?.__parseError,
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

export function buildPiDevPressureReport(cwd = process.cwd(), options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const sessions = collectSessionStats(cwd);
  const sessionBudget = buildSessionBudget(sessions, thresholds);
  const entrypoints = collectEntrypointStats(cwd);
  const entrypointBudget = buildEntrypointBudget(entrypoints, thresholds);
  const configuredEntrypoints = collectConfiguredEntrypointStats(cwd);
  const configuredEntrypointBudget = buildEntrypointBudget(configuredEntrypoints, thresholds);
  const settings = collectSettingsStats(cwd);
  const loop = collectLoopState(cwd, options.now ?? new Date());
  const git = options.git === false ? { available: false, skipped: true } : collectGitDirtyStats(cwd);

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

  if (loop.exists && loop.mode === "running" && loop.leaseExpired === true && loop.stopCondition === "none") {
    signals.push({ level: "warn", code: "stale-running-loop-lease", detail: `${loop.leaseOwner ?? "unknown"} expired at ${loop.leaseExpiresAtIso ?? "unknown"}` });
  }

  if (git.available && git.count >= thresholds.dirtyFileWarn) {
    signals.push({ level: "warn", code: "wide-dirty-scope", detail: `${git.count} dirty files` });
  }

  let recommendation = "continue";
  if (signals.some((signal) => signal.level === "block")) recommendation = "block-and-clean";
  else if (signals.some((signal) => signal.code === "large-resume-session")) recommendation = "new-session";
  else if (signals.some((signal) => signal.code === "heavy-configured-extension-entrypoint")) recommendation = "reduce-governance-surface";
  else if (signals.some((signal) => signal.code === "wide-dirty-scope")) recommendation = "checkpoint-and-commit";

  return {
    mode: "pi-dev-pressure",
    cwd: path.resolve(cwd),
    thresholds,
    recommendation,
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
    summary: `pi-dev-pressure: recommendation=${recommendation} signals=${signals.length} largestSessionMb=${largestSessionMb} heaviestConfiguredEntrypoint=${heaviestConfiguredEntrypoint ? `${heaviestConfiguredEntrypoint.package}:${heaviestConfiguredEntrypoint.entry}` : "n/a"}`,
  };
}

export function computeStrictFailures(report) {
  const failures = [];
  for (const signal of report.signals ?? []) {
    if (signal.level === "block") failures.push(signal.code);
  }
  return failures;
}

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
