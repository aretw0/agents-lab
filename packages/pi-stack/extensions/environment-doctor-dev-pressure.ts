import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildDevelopmentVelocityPressure } from "./environment-doctor-dev-pressure-policy.mjs";

export { buildDevelopmentVelocityPressure };

const DEV_PRESSURE_THRESHOLDS = {
  largeSessionMb: 50,
  blockingSessionMb: 150,
  heavyEntrypointKb: 750,
  heavyEntrypointFiles: 70,
};

type DevPressureSignalLevel = "info" | "warn" | "block";

interface DevPressureSignal {
  level: DevPressureSignalLevel;
  code: string;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeReadJson(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch (error) {
    return { __parseError: error instanceof Error ? error.message : String(error) };
  }
}

function toRelativeSlash(cwd: string, filePath: string): string {
  return relative(cwd, filePath).split(sep).join("/");
}

function walkFiles(rootDir: string, predicate: (filePath: string, name: string) => boolean): string[] {
  if (!existsSync(rootDir)) return [];
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && predicate(fullPath, entry.name)) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function collectDevPressureSessions(cwd: string) {
  const sessionRoot = join(cwd, ".sandbox", "pi-agent", "sessions");
  const files = walkFiles(sessionRoot, (_filePath, name) => name.endsWith(".jsonl"))
    .map((filePath) => {
      const stat = statSync(filePath);
      return {
        path: toRelativeSlash(cwd, filePath),
        bytes: stat.size,
        mb: Number((stat.size / 1024 / 1024).toFixed(2)),
        mtimeIso: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
  const totalBytes = files.reduce((sum, row) => sum + row.bytes, 0);
  return {
    root: toRelativeSlash(cwd, sessionRoot),
    count: files.length,
    totalMb: Number((totalBytes / 1024 / 1024).toFixed(2)),
    largest: files[0],
    recent: [...files].sort((a, b) => String(b.mtimeIso).localeCompare(String(a.mtimeIso))).slice(0, 5),
  };
}

function packageSource(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (isRecord(entry) && typeof entry.source === "string") return entry.source;
  return undefined;
}

function normalizeSurfacePath(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function applyConfiguredExtensionFilters(extensions: string[], configuredEntry: unknown): string[] {
  if (!isRecord(configuredEntry) || !Array.isArray(configuredEntry.extensions)) return extensions;
  const includes = new Set<string>();
  const excludes = new Set<string>();
  for (const value of configuredEntry.extensions) {
    if (typeof value !== "string") continue;
    if (value.startsWith("!")) excludes.add(normalizeSurfacePath(value.slice(1)));
    else includes.add(normalizeSurfacePath(value));
  }
  return extensions.filter((extension) => {
    const normalized = normalizeSurfacePath(extension);
    return (includes.size === 0 || includes.has(normalized)) && !excludes.has(normalized);
  });
}

function resolveConfiguredPackageRoot(cwd: string, settingsPath: string, source: string): string | undefined {
  const raw = source.startsWith("npm:") ? source.slice("npm:".length) : source;
  if (raw.startsWith(".") || raw.startsWith("/") || isAbsolute(raw)) return resolve(dirname(settingsPath), raw);
  if (raw.startsWith("@") || /^[a-z0-9._-]+(?:\/[a-z0-9._-]+)?$/i.test(raw)) return join(cwd, "node_modules", raw);
  return undefined;
}

const STATIC_IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?from\s+)?["'](\.\.?\/[^"']+)["']/g;

function resolveRelativeModule(specifier: string, baseFile: string): string | undefined {
  const base = resolve(dirname(baseFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.js`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function collectImportGraph(entryFile: string, allowedRoot: string, seen = new Set<string>()): Set<string> {
  const filePath = resolve(entryFile);
  if (seen.has(filePath)) return seen;
  const rel = relative(resolve(allowedRoot), filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) return seen;
  seen.add(filePath);

  let source = "";
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return seen;
  }

  const importRe = new RegExp(STATIC_IMPORT_RE);
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source))) {
    const resolved = resolveRelativeModule(match[1] ?? "", filePath);
    if (resolved) collectImportGraph(resolved, allowedRoot, seen);
  }
  return seen;
}

function sumGraphKb(graph: Set<string>): number {
  let bytes = 0;
  for (const filePath of graph) bytes += statSync(filePath).size;
  return Number((bytes / 1024).toFixed(1));
}

function collectDevPressureConfiguredEntrypoints(cwd: string) {
  const settingsPaths: Array<[string, string]> = [
    [".pi/settings.json", join(cwd, ".pi", "settings.json")],
    [".sandbox/pi-agent/settings.json", join(cwd, ".sandbox", "pi-agent", "settings.json")],
  ];
  const rows: Array<{ settings: string; package: string; entry: string; files: number; kb: number }> = [];

  for (const [settingsLabel, settingsPath] of settingsPaths) {
    const settings = safeReadJson(settingsPath);
    const packages = Array.isArray(settings?.packages) ? settings.packages : [];
    for (const configuredEntry of packages) {
      const source = packageSource(configuredEntry);
      if (!source) continue;
      const packageRoot = resolveConfiguredPackageRoot(cwd, settingsPath, source);
      if (!packageRoot || !existsSync(packageRoot)) continue;
      const packageJsonPath = join(packageRoot, "package.json");
      const pkg = safeReadJson(packageJsonPath);
      const extensions = isRecord(pkg?.pi) && Array.isArray(pkg.pi.extensions)
        ? pkg.pi.extensions.filter((entry): entry is string => typeof entry === "string")
        : [];
      for (const entry of applyConfiguredExtensionFilters(extensions, configuredEntry)) {
        const entryPath = resolve(dirname(packageJsonPath), entry);
        if (!existsSync(entryPath)) continue;
        const graph = collectImportGraph(entryPath, packageRoot);
        rows.push({
          settings: settingsLabel,
          package: source,
          entry,
          files: graph.size,
          kb: sumGraphKb(graph),
        });
      }
    }
  }

  return rows.sort((a, b) => b.kb - a.kb);
}

function collectDevPressureSettings(cwd: string) {
  const settingsPaths: Array<[string, string]> = [
    [".pi/settings.json", join(cwd, ".pi", "settings.json")],
    [".sandbox/pi-agent/settings.json", join(cwd, ".sandbox", "pi-agent", "settings.json")],
  ];
  return settingsPaths.map(([label, filePath]) => {
    const settings = safeReadJson(filePath);
    const packages = Array.isArray(settings?.packages) ? settings.packages : [];
    const suppressedSurfaceCount = packages.filter((entry) => isRecord(entry)
      && Array.isArray(entry.extensions) && entry.extensions.length === 0
      && Array.isArray(entry.skills) && entry.skills.length === 0
      && Array.isArray(entry.themes) && entry.themes.length === 0).length;
    const extensionExcludeCount = packages.reduce((sum, entry) => {
      if (!isRecord(entry) || !Array.isArray(entry.extensions)) return sum;
      return sum + entry.extensions.filter((value) => typeof value === "string" && value.startsWith("!")).length;
    }, 0);

    return {
      path: label,
      exists: existsSync(filePath),
      parseError: settings?.__parseError,
      packageCount: packages.length,
      suppressedSurfaceCount,
      extensionExcludeCount,
    };
  });
}

export function buildEnvironmentDevPressureReport(cwd = process.cwd()) {
  const sessions = collectDevPressureSessions(cwd);
  const configuredEntrypoints = collectDevPressureConfiguredEntrypoints(cwd);
  const settings = collectDevPressureSettings(cwd);
  const signals: DevPressureSignal[] = [];
  const largestSessionMb = sessions.largest?.mb ?? 0;
  const heaviestConfiguredEntrypoint = configuredEntrypoints[0];

  if (largestSessionMb >= DEV_PRESSURE_THRESHOLDS.blockingSessionMb) {
    signals.push({ level: "block", code: "huge-resume-session", detail: `${largestSessionMb} MB session jsonl` });
  } else if (largestSessionMb >= DEV_PRESSURE_THRESHOLDS.largeSessionMb) {
    signals.push({ level: "warn", code: "large-resume-session", detail: `${largestSessionMb} MB session jsonl` });
  }

  if (
    heaviestConfiguredEntrypoint &&
    (heaviestConfiguredEntrypoint.kb >= DEV_PRESSURE_THRESHOLDS.heavyEntrypointKb ||
      heaviestConfiguredEntrypoint.files >= DEV_PRESSURE_THRESHOLDS.heavyEntrypointFiles)
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

  let recommendation = "continue";
  if (signals.some((signal) => signal.level === "block")) recommendation = "block-and-clean";
  else if (signals.some((signal) => signal.code === "large-resume-session")) recommendation = "new-session";
  else if (signals.some((signal) => signal.code === "heavy-configured-extension-entrypoint")) recommendation = "reduce-governance-surface";

  const velocityPressure = buildDevelopmentVelocityPressure({ signals });

  return {
    mode: "environment-dev-pressure",
    cwd: resolve(cwd),
    thresholds: DEV_PRESSURE_THRESHOLDS,
    recommendation,
    velocityPressure,
    signals,
    sessions,
    configuredEntrypoints: configuredEntrypoints.slice(0, 15),
    settings,
    summary: `environment-dev-pressure: recommendation=${recommendation} signals=${signals.length} largestSessionMb=${largestSessionMb} heaviestConfiguredEntrypoint=${heaviestConfiguredEntrypoint ? `${heaviestConfiguredEntrypoint.package}:${heaviestConfiguredEntrypoint.entry}` : "n/a"}`,
  };
}
