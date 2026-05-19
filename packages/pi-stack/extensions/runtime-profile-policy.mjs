import { existsSync } from "node:fs";

export const COLD_CAPABILITY_PACKAGES = [
  "@davidorex/pi-project-workflows",
  "@ifi/pi-web-remote",
  "@ifi/oh-pi-ant-colony",
];

export const CONTROL_PLANE_ENABLED_MODELS = [
  "openai-codex/gpt-5.3-codex",
  "openai-codex/gpt-5.4-mini",
  "dashscope/qwen3.6-flash",
];

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
    return { settings, changed: false };
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

export function isColdCapabilityPackageSource(source) {
  const pkg = extractPackageNameFromSource(source);
  return Boolean(pkg && COLD_CAPABILITY_PACKAGES.includes(pkg));
}

export function controlPlaneEnabledModels() {
  return [...CONTROL_PLANE_ENABLED_MODELS];
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

  const removed = [];
  const packages = settings.packages.filter((entry) => {
    const source = typeof entry === "string"
      ? entry
      : isRecord(entry) && typeof entry.source === "string"
        ? entry.source
        : undefined;
    if (!isColdCapabilityPackageSource(source)) return true;
    removed.push(source);
    return false;
  });
  const next = {
    ...settings,
    packages,
    runtimeProfile: "control-plane",
    defaultProvider: "openai-codex",
    defaultModel: "gpt-5.3-codex",
    enabledModels: CONTROL_PLANE_ENABLED_MODELS,
  };
  const shellPath = reconcileLocalShellPath(next, options);
  const currentEnabledModels = Array.isArray(settings.enabledModels) ? settings.enabledModels : [];
  const modelsChanged =
    currentEnabledModels.length !== CONTROL_PLANE_ENABLED_MODELS.length ||
    currentEnabledModels.some((value, index) => value !== CONTROL_PLANE_ENABLED_MODELS[index]);
  const changed =
    removed.length > 0 ||
    settings.runtimeProfile !== "control-plane" ||
    settings.defaultProvider !== "openai-codex" ||
    settings.defaultModel !== "gpt-5.3-codex" ||
    modelsChanged ||
    shellPath.changed;

  if (!changed) return { settings: shellPath.settings, changed: false, removed };
  return { settings: shellPath.settings, changed: true, removed };
}
