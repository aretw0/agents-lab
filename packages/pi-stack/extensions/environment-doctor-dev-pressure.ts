import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildDevelopmentVelocityPressure } from "./environment-doctor-dev-pressure-policy.mjs";
import { buildControlPlaneCapabilityGuidance } from "./runtime-profile-policy.mjs";

export { buildDevelopmentVelocityPressure };

const DEV_PRESSURE_THRESHOLDS = {
  largeSessionMb: 50,
  blockingSessionMb: 150,
  heavyEntrypointKb: 750,
  heavyEntrypointFiles: 70,
  boardWarnMb: 1,
};

type DevPressureSignalLevel = "info" | "warn" | "block";
type CapabilityActivationClass = "always-on" | "read-only-on-intent" | "expensive-on-intent" | "protected-explicit";
type CapabilityState = "active" | "cold";

interface DevPressureSignal {
  level: DevPressureSignalLevel;
  code: string;
  detail: string;
}

interface CapabilityGuidanceRow {
  id: string;
  label: string;
  activation: CapabilityActivationClass;
  state: CapabilityState;
  resources: string[];
  operatorAction: string;
  packageName?: string;
}

function pickPrimaryPressureSignal(signals: DevPressureSignal[]) {
  return signals.find((signal) => signal.level === "block")
    ?? signals.find((signal) => signal.level === "warn")
    ?? signals.find((signal) => signal.code !== "cold-capabilities-available-on-intent")
    ?? signals[0];
}

function pressureActionForSignal(signal?: DevPressureSignal): string {
  if (!signal) return "continue";
  if (signal.code === "pi-lens-active-full-startup-risk") return "set-pi-lens-startup-mode-quick-or-minimal-or-exclude-until-requested";
  if (signal.code === "large-resume-session") return "start-new-session-or-triage-before-resume";
  if (signal.code === "huge-resume-session") return "block-resume-and-clean-session-pressure";
  if (signal.code === "heavy-configured-extension-entrypoint") return "reduce-startup-surface";
  if (signal.code === "large-board-state") return "preview-board-archive-before-more-work";
  return "inspect-details";
}

function pressureRecoveryActionsForSignal(signal?: DevPressureSignal): string[] {
  if (!signal) return [];
  if (signal.code === "pi-lens-active-full-startup-risk") {
    return [
      "set PI_LENS_STARTUP_MODE=quick or minimal before starting Pi when pi-lens must stay available",
      "reapply the strict-curated pi-stack profile so pi-lens stays cold until explicitly requested",
      "use stack-full only for deliberate diagnostics, not as the daily control-plane profile",
    ];
  }
  if (signal.code === "large-resume-session") return ["start a new session or run session triage before resuming the large session"];
  if (signal.code === "huge-resume-session") return ["block resume, checkpoint what matters, then clean or archive the oversized session"];
  if (signal.code === "heavy-configured-extension-entrypoint") return ["filter or defer heavy extension entrypoints until explicit operator intent"];
  if (signal.code === "large-board-state") return ["preview board archive or verification split before adding more hot board state"];
  return [];
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

function asCapabilityGuidance(value: unknown): CapabilityGuidanceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id : "";
    const label = typeof item.label === "string" ? item.label : id;
    const activation = typeof item.activation === "string" ? item.activation : "";
    const state = typeof item.state === "string" ? item.state : "";
    const operatorAction = typeof item.operatorAction === "string" ? item.operatorAction : "";
    const resources = Array.isArray(item.resources)
      ? item.resources.filter((resource): resource is string => typeof resource === "string")
      : [];
    if (!id || !label || !operatorAction || resources.length === 0) return [];
    if (!["always-on", "read-only-on-intent", "expensive-on-intent", "protected-explicit"].includes(activation)) return [];
    if (!["active", "cold"].includes(state)) return [];
    return [{
      id,
      label,
      activation: activation as CapabilityActivationClass,
      state: state as CapabilityState,
      resources,
      operatorAction,
      packageName: typeof item.packageName === "string" ? item.packageName : undefined,
    }];
  });
}

function readCapabilityGuidance(cwd: string): CapabilityGuidanceRow[] {
  const sandboxSettingsPath = join(cwd, ".sandbox", "pi-agent", "settings.json");
  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  const settings = safeReadJson(sandboxSettingsPath) ?? safeReadJson(projectSettingsPath) ?? {};
  return asCapabilityGuidance(buildControlPlaneCapabilityGuidance(settings));
}

function toMb(bytes: number): number {
  return Number((Math.max(0, Number(bytes) || 0) / 1024 / 1024).toFixed(2));
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

function packageNameFromSource(source: string): string {
  const normalized = source.replace(/\\/g, "/");
  const raw = normalized.startsWith("npm:") ? normalized.slice("npm:".length) : normalized;
  if (raw.startsWith("@")) {
    const slash = raw.indexOf("/");
    if (slash === -1) return raw;
    const versionAt = raw.indexOf("@", slash + 1);
    return versionAt === -1 ? raw : raw.slice(0, versionAt);
  }
  const versionAt = raw.indexOf("@");
  return versionAt === -1 ? raw : raw.slice(0, versionAt);
}

function isPiLensSource(source: string): boolean {
  return packageNameFromSource(source) === "pi-lens";
}

function resolvePiLensStartupMode(): string {
  return String(process.env.PI_LENS_STARTUP_MODE || "full").trim().toLowerCase() || "full";
}

function normalizeSurfacePath(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function piLensExtensionActive(configuredEntry: unknown): boolean {
  if (!isRecord(configuredEntry) || !Array.isArray(configuredEntry.extensions)) return true;
  if (configuredEntry.extensions.length === 0) return false;

  const includes = new Set<string>();
  const excludes = new Set<string>();
  for (const value of configuredEntry.extensions) {
    if (typeof value !== "string") continue;
    if (value.startsWith("!")) excludes.add(normalizeSurfacePath(value.slice(1)));
    else includes.add(normalizeSurfacePath(value));
  }

  const entrypoint = "index.ts";
  return (includes.size === 0 || includes.has(entrypoint)) && !excludes.has(entrypoint);
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
    const piLensEntries = packages
      .map((entry) => ({ entry, source: packageSource(entry) }))
      .filter((row): row is { entry: unknown; source: string } => Boolean(row.source && isPiLensSource(row.source)))
      .map(({ entry, source }) => {
        const extensionActive = piLensExtensionActive(entry);
        const startupMode = resolvePiLensStartupMode();
        return {
          source,
          extensionActive,
          startupMode,
          guidance:
            extensionActive && !["quick", "minimal"].includes(startupMode)
              ? "high-friction-risk: set PI_LENS_STARTUP_MODE=quick/minimal or exclude pi-lens until diagnostics are explicitly needed"
              : "curated-or-cold",
        };
      });

    return {
      path: label,
      exists: existsSync(filePath),
      parseError: settings?.__parseError,
      packageCount: packages.length,
      suppressedSurfaceCount,
      extensionExcludeCount,
      piLensEntries,
    };
  });
}

function collectDevPressureBoardState(cwd: string) {
  const boardPath = join(cwd, ".project", "tasks.json");
  const verificationPath = join(cwd, ".project", "verification.json");
  if (!existsSync(boardPath)) return { exists: false, path: ".project/tasks.json" };

  const stat = statSync(boardPath);
  const board = safeReadJson(boardPath);
  const rawTasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const tasks = rawTasks.filter(isRecord);
  const byStatus: Record<string, number> = {};
  let completedBytes = 0;
  let completedNotesBytes = 0;
  const topCompleted: Array<{ id: string; kb: number; notesKb: number }> = [];

  for (const task of tasks) {
    const status = String(task.status ?? "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status !== "completed") continue;
    const bytes = Buffer.byteLength(JSON.stringify(task), "utf8");
    const notesBytes = Buffer.byteLength(JSON.stringify(task.notes ?? []), "utf8");
    completedBytes += bytes;
    completedNotesBytes += notesBytes;
    topCompleted.push({
      id: String(task.id ?? task.title ?? "unknown"),
      kb: Number((bytes / 1024).toFixed(1)),
      notesKb: Number((notesBytes / 1024).toFixed(1)),
    });
  }
  topCompleted.sort((a, b) => b.kb - a.kb);

  let verification: Record<string, unknown>;
  if (existsSync(verificationPath)) {
    const verificationStat = statSync(verificationPath);
    const verificationJson = safeReadJson(verificationPath);
    verification = {
      exists: true,
      path: ".project/verification.json",
      mb: toMb(verificationStat.size),
      count: Array.isArray(verificationJson?.verifications) ? verificationJson.verifications.length : 0,
    };
  } else {
    verification = { exists: false, path: ".project/verification.json" };
  }

  return {
    exists: true,
    path: ".project/tasks.json",
    mb: toMb(stat.size),
    tasks: {
      total: tasks.length,
      byStatus,
      completedCount: byStatus.completed ?? 0,
      completedMb: toMb(completedBytes),
      completedNotesMb: toMb(completedNotesBytes),
      topCompleted: topCompleted.slice(0, 5),
    },
    verification,
  };
}

function formatBoardPressureDetail(board: ReturnType<typeof collectDevPressureBoardState>): string {
  const tasks = isRecord(board.tasks) ? board.tasks : undefined;
  const byStatus = isRecord(tasks?.byStatus) ? tasks.byStatus : undefined;
  const statusParts = byStatus
    ? Object.entries(byStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status}=${count}`)
    : [];
  const topCompleted = Array.isArray(tasks?.topCompleted) && isRecord(tasks.topCompleted[0])
    ? tasks.topCompleted[0]
    : undefined;
  const topPart = topCompleted ? `topCompleted=${topCompleted.id}:${topCompleted.kb}KB` : "topCompleted=n/a";
  const verification = isRecord(board.verification) && board.verification.exists
    ? `verification=${board.verification.count}/${board.verification.mb}MB`
    : undefined;
  return [
    `${board.path} ${board.mb} MB`,
    tasks ? `tasks=${tasks.total}` : undefined,
    statusParts.length > 0 ? statusParts.join(",") : undefined,
    tasks ? `completedMb=${tasks.completedMb}` : undefined,
    tasks ? `completedNotesMb=${tasks.completedNotesMb}` : undefined,
    verification,
    topPart,
  ].filter(Boolean).join("; ");
}

function buildDevPressureBoardPlan(board: ReturnType<typeof collectDevPressureBoardState>) {
  if (!board.exists || !isRecord(board.tasks)) {
    return {
      mode: "dry-run",
      status: "unavailable",
      reason: "board-missing",
      mutates: false,
      actions: [],
    };
  }

  const tasks = board.tasks;
  const completedCount = Number(tasks.completedCount ?? 0);
  const total = Number(tasks.total ?? 0);
  const byStatus = isRecord(tasks.byStatus) ? tasks.byStatus : {};
  const cancelledTaskCount = Number(byStatus.cancelled ?? 0);
  const nonCompletedTaskCount = Math.max(0, total - completedCount);
  const openTaskCount = Math.max(0, nonCompletedTaskCount - cancelledTaskCount);
  const verification = isRecord(board.verification) && board.verification.exists ? board.verification : undefined;
  const actions: Array<Record<string, unknown>> = [];

  if (completedCount > 0) {
    actions.push({
      id: "archive-completed-tasks",
      intent: "Move completed task history out of the hot board after checkpoint.",
      candidateCount: completedCount,
      candidateMb: Number(tasks.completedMb ?? 0),
      retainedHotTasks: nonCompletedTaskCount,
      guard: "explicit-operator-approval-required",
    });
  }

  if (Number(tasks.completedNotesMb ?? 0) > 0) {
    actions.push({
      id: "compact-completed-task-notes",
      intent: "Replace bulky completed-task notes with verification links and archive details.",
      candidateMb: Number(tasks.completedNotesMb ?? 0),
      guard: "explicit-operator-approval-required",
    });
  }

  if (verification) {
    actions.push({
      id: "split-verification-ledger",
      intent: "Keep recent verification hot and move historical evidence to an archive ledger.",
      candidateCount: Number(verification.count ?? 0),
      candidateMb: Number(verification.mb ?? 0),
      guard: "explicit-operator-approval-required",
    });
  }

  return {
    mode: "dry-run",
    status: Number(board.mb ?? 0) >= DEV_PRESSURE_THRESHOLDS.boardWarnMb ? "pressure" : "ok",
    mutates: false,
    boardPath: board.path,
    boardMb: Number(board.mb ?? 0),
    boardWarnMb: DEV_PRESSURE_THRESHOLDS.boardWarnMb,
    openTaskCount,
    nonCompletedTaskCount,
    cancelledTaskCount,
    completedTaskCount: completedCount,
    verificationPath: verification?.path,
    verificationMb: verification ? Number(verification.mb ?? 0) : undefined,
    recommendedOrder: actions.map((action) => action.id),
    safety: [
      "preview-only",
      "keep-open-tasks-in-hot-board",
      "preserve-verification-links",
      "require-explicit-operator-approval-before-any-write",
    ],
    actions,
  };
}

function expectedCapabilityCost(row: CapabilityGuidanceRow): string {
  if (row.id === "pi-lens") return "runtime-latency-and-tui-rendering";
  if (row.id === "worker-dispatch") return "provider-tokens-processes-and-runtime-supervision";
  if (row.id === "web-gateway") return "local-port-browser-session-and-remote-surface";
  if (row.id === "colony") return "long-run-workers-provider-budget-and-artifact-retention";
  if (row.activation === "read-only-on-intent") return "low-read-only-runtime-inspection";
  if (row.activation === "protected-explicit") return "protected-surface-requires-explicit-operator-scope";
  if (row.activation === "expensive-on-intent") return "runtime-or-provider-budget-required";
  return "none";
}

function capabilityRisk(row: CapabilityGuidanceRow): string {
  if (row.id === "pi-lens") return "can add startup/render latency; keep quick/minimal or cold unless diagnostics are worth it";
  if (row.id === "worker-dispatch") return "can spend provider budget or create dangling worker state if dispatched without gates";
  if (row.id === "web-gateway") return "opens a session/browser surface; avoid unless the workflow needs it now";
  if (row.id === "colony") return "expands long-run orchestration; require bounded goal, budget, and stop conditions";
  if (row.activation === "read-only-on-intent") return "low risk when kept report-only";
  if (row.activation === "protected-explicit") return "protected scope; explicit approval required";
  return "low";
}

function capabilityCleanup(row: CapabilityGuidanceRow): string[] {
  if (row.id === "pi-lens") return [
    "set PI_LENS_STARTUP_MODE=quick or minimal for future sessions",
    "exclude pi-lens from daily profile when diagnostics are done",
    "reload Pi after changing the capability surface",
  ];
  if (row.id === "worker-dispatch") return [
    "record worker run ids and declared files",
    "stop or inspect dangling worker processes",
    "checkpoint outcome evidence before starting another worker batch",
  ];
  if (row.id === "web-gateway") return [
    "close the gateway/browser session",
    "release forwarded ports",
    "remove temporary session tokens",
  ];
  if (row.id === "colony") return [
    "stop the long-run loop",
    "collect artifacts and outcome packets",
    "return colony surfaces to cold/default profile",
  ];
  if (row.activation === "read-only-on-intent") return ["no cleanup expected beyond keeping the route report-only"];
  return ["return capability to cold profile after use"];
}

function capabilityConfirmationReason(row: CapabilityGuidanceRow): string {
  if (row.activation === "protected-explicit") return "protected capability requires explicit operator approval before activation";
  if (row.activation === "expensive-on-intent") return "expensive capability requires explicit budget before activation";
  if (row.activation === "read-only-on-intent" && row.state === "cold") return "read-only capability activates only after explicit operator intent";
  return "capability is already available or always-on";
}

export function buildCapabilityActivationPreview(cwd = process.cwd(), capabilityId = "pi-lens") {
  const capabilityGuidance = readCapabilityGuidance(cwd);
  const target = capabilityGuidance.find((row) => row.id === String(capabilityId || "").trim());
  if (!target) {
    return {
      mode: "capability-activation-preview",
      effect: "none",
      mutates: false,
      activationAllowed: false,
      dispatchAllowed: false,
      opensGateway: false,
      installsPackage: false,
      decision: "blocked",
      capabilityId,
      capabilityGuidance,
      confirmationRequired: true,
      recommendationCode: "capability-preview-unknown-capability",
      recommendation: "Choose a known capability id from capabilityGuidance before planning activation.",
      summary: `capability-activation-preview: decision=blocked capability=${capabilityId || "unknown"} reason=unknown-capability mutates=no`,
    };
  }

  const confirmationRequired = target.activation === "expensive-on-intent" || target.activation === "protected-explicit";
  const decision = target.state === "active"
    ? "already-active"
    : confirmationRequired
      ? "needs-operator-approval"
      : "preview-ready";
  const recommendationCode = target.state === "active"
    ? "capability-preview-already-active"
    : target.activation === "protected-explicit"
      ? "capability-preview-needs-protected-approval"
      : target.activation === "expensive-on-intent"
        ? "capability-preview-needs-budget"
        : "capability-preview-report-only";

  return {
    mode: "capability-activation-preview",
    effect: "none",
    mutates: false,
    activationAllowed: false,
    dispatchAllowed: false,
    opensGateway: false,
    installsPackage: false,
    startsWorker: false,
    target,
    capabilityGuidance,
    decision,
    confirmationRequired,
    confirmationReason: capabilityConfirmationReason(target),
    expectedCost: expectedCapabilityCost(target),
    risk: capabilityRisk(target),
    cleanup: capabilityCleanup(target),
    recommendationCode,
    recommendation: target.state === "active"
      ? "Capability is already active; inspect current pressure before using it further."
      : `${target.operatorAction}; this preview does not activate packages, start workers, open gateways, or edit settings.`,
    summary: [
      "capability-activation-preview:",
      `decision=${decision}`,
      `capability=${target.id}`,
      `state=${target.state}`,
      `activation=${target.activation}`,
      `confirmation=${confirmationRequired ? "yes" : "no"}`,
      "mutates=no",
      "dispatch=no",
      "installs=no",
    ].join(" "),
  };
}

export function buildEnvironmentDevPressureReport(cwd = process.cwd()) {
  const sessions = collectDevPressureSessions(cwd);
  const configuredEntrypoints = collectDevPressureConfiguredEntrypoints(cwd);
  const settings = collectDevPressureSettings(cwd);
  const capabilityGuidance = readCapabilityGuidance(cwd);
  const board = collectDevPressureBoardState(cwd);
  const boardPressurePlan = buildDevPressureBoardPlan(board);
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
  const coldIntentCapabilities = capabilityGuidance.filter((row) => row.state === "cold" && row.activation !== "always-on");
  if (coldIntentCapabilities.length > 0) {
    signals.push({
      level: "info",
      code: "cold-capabilities-available-on-intent",
      detail: coldIntentCapabilities.map((row) => `${row.id}:${row.activation}`).join(", "),
    });
  }

  const activePiLensEntries = settings.flatMap((row) => row.piLensEntries
    .filter((entry) => entry.extensionActive)
    .map((entry) => ({ settings: row.path, ...entry })));
  const piLensStartupMode = resolvePiLensStartupMode();
  if (activePiLensEntries.length > 0 && !["quick", "minimal"].includes(piLensStartupMode)) {
    signals.push({
      level: "warn",
      code: "pi-lens-active-full-startup-risk",
      detail: `pi-lens active in ${activePiLensEntries.map((entry) => entry.settings).join(", ")} startupMode=${piLensStartupMode}`,
    });
  } else if (activePiLensEntries.length > 0) {
    signals.push({
      level: "info",
      code: "pi-lens-active-curated-startup",
      detail: `pi-lens active with startupMode=${piLensStartupMode}`,
    });
  }

  if (board.exists && Number(board.mb) >= DEV_PRESSURE_THRESHOLDS.boardWarnMb) {
    signals.push({ level: "warn", code: "large-board-state", detail: formatBoardPressureDetail(board) });
  }

  let recommendation = "continue";
  if (signals.some((signal) => signal.level === "block")) recommendation = "block-and-clean";
  else if (signals.some((signal) => signal.code === "large-resume-session")) recommendation = "new-session";
  else if (signals.some((signal) => signal.code === "heavy-configured-extension-entrypoint" || signal.code === "large-board-state" || signal.code === "pi-lens-active-full-startup-risk")) recommendation = "reduce-governance-surface";

  const velocityPressure = buildDevelopmentVelocityPressure({ signals });
  const primarySignal = pickPrimaryPressureSignal(signals);
  const primaryAction = pressureActionForSignal(primarySignal);
  const primaryRecoveryActions = pressureRecoveryActionsForSignal(primarySignal);

  return {
    mode: "environment-dev-pressure",
    cwd: resolve(cwd),
    thresholds: DEV_PRESSURE_THRESHOLDS,
    recommendation,
    velocityPressure,
    signals,
    sessions,
    board,
    boardPressurePlan,
    configuredEntrypoints: configuredEntrypoints.slice(0, 15),
    settings,
    capabilityGuidance,
    primarySignal,
    primaryAction,
    primaryRecoveryActions,
    summary: [
      `environment-dev-pressure: recommendation=${recommendation}`,
      `signals=${signals.length}`,
      `primary=${primarySignal ? `${primarySignal.level}:${primarySignal.code}` : "none"}`,
      `action=${primaryAction}`,
      primaryRecoveryActions.length > 0 ? `recoveryActions=${primaryRecoveryActions.length}` : undefined,
      `largestSessionMb=${largestSessionMb}`,
      `heaviestConfiguredEntrypoint=${heaviestConfiguredEntrypoint ? `${heaviestConfiguredEntrypoint.package}:${heaviestConfiguredEntrypoint.entry}` : "n/a"}`,
    ].filter(Boolean).join(" "),
  };
}
