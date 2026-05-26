import { existsSync } from "node:fs";
import path from "node:path";

export const COLD_CAPABILITY_PACKAGES = [
  "@davidorex/pi-project-workflows",
  "@ifi/pi-web-remote",
  "@ifi/oh-pi-ant-colony",
  "pi-lens",
];

export const CONTROL_PLANE_RUNTIME_PROFILE = {
  runtimeProfile: "control-plane",
};

export const CONTROL_PLANE_WATCHDOG_CONFIG = {
  enabled: true,
  sampleIntervalMs: 10000,
  thresholds: {
    cpuPercent: 90,
    eventLoopMaxMs: 300,
    eventLoopP99Ms: 150,
    heapUsedMb: 512,
    rssMb: 768,
  },
};

export const DEFAULT_WINDOWS_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPackageSource(entry) {
  if (typeof entry === "string") return entry;
  if (isRecord(entry) && typeof entry.source === "string") return entry.source;
  return undefined;
}

function setPackageSource(entry, source) {
  if (typeof entry === "string") return source;
  if (isRecord(entry) && typeof entry.source === "string") return { ...entry, source };
  return entry;
}

function toPortableRelativePath(fromDir, targetPath) {
  const rel = path.relative(fromDir, targetPath) || ".";
  return rel.split(path.sep).join("/");
}

export function reconcileLocalShellPath(
  settings,
  {
    platform = process.platform,
    gitBashPath = DEFAULT_WINDOWS_GIT_BASH,
    pathExists = existsSync,
  } = {},
) {
  if (!isRecord(settings)) return { settings, changed: false };
  if (typeof settings.shellPath === "string" && settings.shellPath.trim()) {
    if (pathExists(settings.shellPath)) return { settings, changed: false };
    const { shellPath: _removedShellPath, ...withoutInvalidShellPath } = settings;
    if (platform !== "win32" || !pathExists(gitBashPath)) {
      return { settings: withoutInvalidShellPath, changed: true };
    }
    return { settings: { ...withoutInvalidShellPath, shellPath: gitBashPath }, changed: true };
  }
  if (platform !== "win32" || !pathExists(gitBashPath)) {
    return { settings, changed: false };
  }
  return { settings: { ...settings, shellPath: gitBashPath }, changed: true };
}

export function extractPackageNameFromSource(source) {
  if (typeof source !== "string") return undefined;
  const normalized = source.replace(/\\/g, "/");
  const npm = normalized.startsWith("npm:") ? normalized.slice("npm:".length) : normalized;
  if (npm.startsWith("@")) {
    const slash = npm.indexOf("/");
    if (slash === -1) return undefined;
    const versionAt = npm.indexOf("@", slash + 1);
    return versionAt === -1 ? npm : npm.slice(0, versionAt);
  }
  for (const pkg of COLD_CAPABILITY_PACKAGES) {
    if (normalized.endsWith(`/node_modules/${pkg}`) || normalized.endsWith(`/node_modules/${pkg}/`)) {
      return pkg;
    }
  }
  const versionAt = npm.indexOf("@");
  return versionAt === -1 ? npm : npm.slice(0, versionAt);
}

export function isColdCapabilityPackageSource(source, coldCapabilityPackages = COLD_CAPABILITY_PACKAGES) {
  const pkg = extractPackageNameFromSource(source);
  return Boolean(pkg && coldCapabilityPackages.includes(pkg));
}

export function canonicalizePackageSourceForAgentDir(
  source,
  { repoRoot = process.cwd(), agentDir } = {},
) {
  if (typeof source !== "string") return source;
  if (source.startsWith("npm:") || source.startsWith("git+") || /^[a-z]+:\/\//i.test(source)) return source;
  if (!agentDir || !path.isAbsolute(source)) return source;

  const resolvedSource = path.resolve(source);
  const resolvedRepo = path.resolve(repoRoot);
  const relToRepo = path.relative(resolvedRepo, resolvedSource);
  if (relToRepo.startsWith("..") || path.isAbsolute(relToRepo)) return source;
  return toPortableRelativePath(path.resolve(agentDir), resolvedSource);
}

export function canonicalizeSettingsPackageSourcesForAgentDir(
  settings,
  { repoRoot = process.cwd(), agentDir } = {},
) {
  if (!isRecord(settings) || !Array.isArray(settings.packages)) {
    return { settings, changed: false, changes: [] };
  }

  let changed = false;
  const changes = [];
  const packages = settings.packages.map((entry) => {
    const source = getPackageSource(entry);
    if (!source) return entry;
    const nextSource = canonicalizePackageSourceForAgentDir(source, { repoRoot, agentDir });
    if (nextSource === source) return entry;
    changed = true;
    changes.push({ from: source, to: nextSource });
    return setPackageSource(entry, nextSource);
  });

  if (!changed) return { settings, changed: false, changes: [] };
  return { settings: { ...settings, packages }, changed: true, changes };
}

export function controlPlaneEnabledModels() {
  return [];
}

export function controlPlaneWatchdogConfig() {
  return JSON.parse(JSON.stringify(CONTROL_PLANE_WATCHDOG_CONFIG));
}

export function reconcileControlPlaneWatchdogConfig(input) {
  const baseline = controlPlaneWatchdogConfig();
  const current = isRecord(input) ? input : {};
  const currentThresholds = isRecord(current.thresholds) ? current.thresholds : {};
  let changed = !isRecord(input);

  const next = {
    ...current,
    enabled: current.enabled === false ? baseline.enabled : (current.enabled ?? baseline.enabled),
    sampleIntervalMs:
      Number.isFinite(Number(current.sampleIntervalMs)) && Number(current.sampleIntervalMs) > 0
        ? Math.min(Number(current.sampleIntervalMs), baseline.sampleIntervalMs)
        : baseline.sampleIntervalMs,
    thresholds: {
      ...currentThresholds,
    },
  };

  if (next.enabled !== current.enabled) changed = true;
  if (next.sampleIntervalMs !== current.sampleIntervalMs) changed = true;

  for (const [key, baselineValue] of Object.entries(baseline.thresholds)) {
    const value = Number(currentThresholds[key]);
    const nextValue = Number.isFinite(value) && value > 0
      ? Math.min(value, baselineValue)
      : baselineValue;
    if (next.thresholds[key] !== nextValue) changed = true;
    next.thresholds[key] = nextValue;
  }

  return { config: next, changed };
}

export function buildControlPlaneRuntimeSettings(settings, options = {}) {
  if (!isRecord(settings) || !Array.isArray(settings.packages)) {
    return { settings, changed: false, removed: [] };
  }

  const profile = isRecord(options.profile) ? options.profile : CONTROL_PLANE_RUNTIME_PROFILE;
  const runtimeProfile = typeof profile.runtimeProfile === "string"
    ? profile.runtimeProfile
    : CONTROL_PLANE_RUNTIME_PROFILE.runtimeProfile;
  const hasDefaultProvider = typeof profile.defaultProvider === "string";
  const hasDefaultModel = typeof profile.defaultModel === "string";
  const hasEnabledModels = Array.isArray(profile.enabledModels);
  const defaultProvider = hasDefaultProvider ? profile.defaultProvider : undefined;
  const defaultModel = hasDefaultModel ? profile.defaultModel : undefined;
  const enabledModels = hasEnabledModels ? [...profile.enabledModels] : undefined;
  const coldCapabilityPackages = Array.isArray(options.coldCapabilityPackages)
    ? options.coldCapabilityPackages
    : COLD_CAPABILITY_PACKAGES;

  const removed = [];
  const packages = settings.packages.filter((entry) => {
    const source = getPackageSource(entry);
    if (!isColdCapabilityPackageSource(source, coldCapabilityPackages)) return true;
    removed.push(source);
    return false;
  });
  const next = {
    ...settings,
    packages,
    runtimeProfile,
  };
  if (hasDefaultProvider) next.defaultProvider = defaultProvider;
  if (hasDefaultModel) next.defaultModel = defaultModel;
  if (hasEnabledModels) next.enabledModels = enabledModels;
  const shellPath = reconcileLocalShellPath(next, options);
  const currentEnabledModels = Array.isArray(settings.enabledModels) ? settings.enabledModels : undefined;
  const modelsChanged =
    hasEnabledModels && (
      !Array.isArray(currentEnabledModels) ||
      currentEnabledModels.length !== enabledModels.length ||
      currentEnabledModels.some((value, index) => value !== enabledModels[index])
    );
  const changed =
    removed.length > 0 ||
    settings.runtimeProfile !== runtimeProfile ||
    (hasDefaultProvider && settings.defaultProvider !== defaultProvider) ||
    (hasDefaultModel && settings.defaultModel !== defaultModel) ||
    modelsChanged ||
    shellPath.changed;

  if (!changed) return { settings: shellPath.settings, changed: false, removed };
  return { settings: shellPath.settings, changed: true, removed };
}
