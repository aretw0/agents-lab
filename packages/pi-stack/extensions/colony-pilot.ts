/**
 * colony-pilot — Session visibility + colony runtime orchestration primitive.
 *
 * Goals:
 * - Give one first-party command surface to orchestrate colony pilot runs
 * - Make "web server running" and "background colony running" states visible
 * - Keep behavior generic (not tightly coupled to one package internals)
 *
 * Current bridge strategy:
 * - Delegates execution to existing slash commands (/monitors, /remote, /colony)
 * - Tracks state heuristically from emitted messages and tool outputs
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

type MonitorMode = "on" | "off" | "unknown";

type ColonyPhase =
  | "launched"
  | "task_done"
  | "completed"
  | "failed"
  | "aborted"
  | "scouting"
  | "running"
  | "unknown";

interface ColonyState {
  id: string;
  phase: ColonyPhase;
  updatedAt: number;
}

export interface PilotState {
  monitorMode: MonitorMode;
  remoteActive: boolean;
  remoteUrl?: string;
  remoteClients?: number;
  colonies: Map<string, ColonyState>;
  lastSessionFile?: string;
}

const COLONY_SIGNAL_RE = /\[COLONY_SIGNAL:([A-Z_]+)\]\s*\[([^\]]+)\]/i;
const REMOTE_URL_RE = /(https?:\/\/[^\s]+\?t=[^\s]+)/i;
const REMOTE_CLIENTS_RE = /Remote active\s*·\s*(\d+) client/i;

export function createPilotState(): PilotState {
  return {
    monitorMode: "unknown",
    remoteActive: false,
    colonies: new Map(),
  };
}

export function parseColonySignal(text: string): { phase: ColonyPhase; id: string } | undefined {
  const m = text.match(COLONY_SIGNAL_RE);
  if (!m) return undefined;

  const raw = m[1].toLowerCase();
  const id = m[2].trim();

  const phase: ColonyPhase =
    raw === "launched"
      ? "launched"
      : raw === "task_done"
        ? "task_done"
        : raw === "completed"
          ? "completed"
          : raw === "failed"
            ? "failed"
            : raw === "aborted"
              ? "aborted"
              : raw === "scouting"
                ? "scouting"
                : raw === "running"
                  ? "running"
                  : "unknown";

  return { phase, id };
}

export function parseRemoteAccessUrl(text: string): string | undefined {
  const m = text.match(REMOTE_URL_RE);
  return m?.[1];
}

export function buildColonyRunSequence(goal: string): string[] {
  return ["/monitors off", "/remote", `/colony ${goal}`];
}

export function buildColonyStopSequence(options?: { restoreMonitors?: boolean }): string[] {
  const out = ["/colony-stop all", "/remote stop"];
  if (options?.restoreMonitors) out.push("/monitors on");
  return out;
}

export interface PilotCapabilities {
  monitors: boolean;
  remote: boolean;
  sessionWeb: boolean;
  colony: boolean;
  colonyStop: boolean;
}

export function toBaseCommandName(name: string): string {
  return name.split(":")[0] ?? name;
}

export function detectPilotCapabilities(commandNames: string[]): PilotCapabilities {
  const base = new Set(commandNames.map((n) => toBaseCommandName(n)));
  return {
    monitors: base.has("monitors"),
    remote: base.has("remote"),
    sessionWeb: base.has("session-web"),
    colony: base.has("colony"),
    colonyStop: base.has("colony-stop"),
  };
}

export function buildRuntimeRunSequence(caps: PilotCapabilities, goal: string): string[] {
  const webStart = caps.sessionWeb ? "/session-web start" : "/remote";
  return ["/monitors off", webStart, `/colony ${goal}`];
}

export function buildRuntimeStopSequence(caps: PilotCapabilities, options?: { restoreMonitors?: boolean }): string[] {
  const webStop = caps.sessionWeb ? "/session-web stop" : "/remote stop";
  const out = ["/colony-stop all", webStop];
  if (options?.restoreMonitors) out.push("/monitors on");
  return out;
}

export function buildAntColonyMirrorCandidates(cwd: string): string[] {
  const root = path.join(homedir(), ".pi", "agent", "ant-colony");
  const normalized = path.resolve(cwd).replace(/\\/g, "/");
  const m = normalized.match(/^([A-Za-z]):\/(.*)$/);

  if (m) {
    const drive = m[1].toLowerCase();
    const rest = m[2];
    return [
      path.join(root, drive, rest),
      path.join(root, "root", drive, rest),
    ];
  }

  const unix = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  return [
    path.join(root, unix),
    path.join(root, "root", unix),
  ];
}

function inspectAntColonyRuntime(cwd: string) {
  const roots = buildAntColonyMirrorCandidates(cwd).filter((p) => existsSync(p));

  const mirrors = roots.map((rootPath) => {
    const coloniesDir = path.join(rootPath, "colonies");
    const worktreesDir = path.join(rootPath, "worktrees");

    const colonies: Array<{ id: string; status: string; updatedAt: number; goal?: string; statePath: string }> = [];
    if (existsSync(coloniesDir)) {
      for (const d of readdirSync(coloniesDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const statePath = path.join(coloniesDir, d.name, "state.json");
        if (!existsSync(statePath)) continue;
        try {
          const json = JSON.parse(readFileSync(statePath, "utf8"));
          const st = statSync(statePath);
          colonies.push({
            id: json.id ?? d.name,
            status: json.status ?? "unknown",
            goal: typeof json.goal === "string" ? json.goal : undefined,
            updatedAt: st.mtimeMs,
            statePath,
          });
        } catch {
          // ignore malformed state
        }
      }
    }

    colonies.sort((a, b) => b.updatedAt - a.updatedAt);

    const worktrees: Array<{ name: string; path: string; updatedAt: number }> = [];
    if (existsSync(worktreesDir)) {
      for (const d of readdirSync(worktreesDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const full = path.join(worktreesDir, d.name);
        if (!existsSync(path.join(full, ".git"))) continue;
        worktrees.push({ name: d.name, path: full, updatedAt: statSync(full).mtimeMs });
      }
    }

    worktrees.sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      root: rootPath,
      colonies: colonies.slice(0, 8),
      worktrees: worktrees.slice(0, 8),
    };
  });

  return { cwd: path.resolve(cwd), mirrors };
}

function formatArtifactsReport(data: ReturnType<typeof inspectAntColonyRuntime>): string {
  const out: string[] = [];
  out.push("colony-pilot artifacts");
  out.push(`cwd: ${data.cwd}`);

  if (data.mirrors.length === 0) {
    out.push("No ant-colony workspace mirror found for this cwd.");
    return out.join("\n");
  }

  for (const m of data.mirrors) {
    out.push("");
    out.push(`mirror: ${m.root}`);

    out.push("  colonies:");
    if (m.colonies.length === 0) out.push("    (none)");
    for (const c of m.colonies) {
      out.push(`    - ${c.id} [${c.status}] ${new Date(c.updatedAt).toISOString()}`);
      out.push(`      state: ${c.statePath}`);
      if (c.goal) out.push(`      goal: ${c.goal.slice(0, 100)}`);
    }

    out.push("  worktrees:");
    if (m.worktrees.length === 0) out.push("    (none)");
    for (const w of m.worktrees) {
      out.push(`    - ${w.name} ${new Date(w.updatedAt).toISOString()}`);
      out.push(`      path: ${w.path}`);
    }
  }

  return out.join("\n");
}

export function missingCapabilities(
  caps: PilotCapabilities,
  required: Array<keyof PilotCapabilities>
): Array<keyof PilotCapabilities> {
  return required.filter((k) => !caps[k]);
}

export interface ColonyPilotPreflightConfig {
  enabled: boolean;
  enforceOnAntColonyTool: boolean;
  requiredExecutables: string[];
  requireColonyCapabilities: Array<keyof PilotCapabilities>;
}

export interface ColonyPilotPreflightResult {
  ok: boolean;
  missingExecutables: string[];
  missingCapabilities: Array<keyof PilotCapabilities>;
  failures: string[];
  checkedAt: number;
}

const DEFAULT_PREFLIGHT_CONFIG: ColonyPilotPreflightConfig = {
  enabled: true,
  enforceOnAntColonyTool: true,
  requiredExecutables: ["node", "git", "npm"],
  requireColonyCapabilities: ["colony", "colonyStop"],
};

function parseColonyPilotSettings(cwd: string): { preflight?: Partial<ColonyPilotPreflightConfig> } {
  try {
    const p = path.join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return {};
    const json = JSON.parse(readFileSync(p, "utf8"));
    return json?.piStack?.colonyPilot ?? json?.extensions?.colonyPilot ?? {};
  } catch {
    return {};
  }
}

function normalizeCapabilitiesList(value: unknown): Array<keyof PilotCapabilities> {
  if (!Array.isArray(value)) return [...DEFAULT_PREFLIGHT_CONFIG.requireColonyCapabilities];
  const allowed: Array<keyof PilotCapabilities> = ["monitors", "remote", "sessionWeb", "colony", "colonyStop"];
  const out = value
    .filter((v): v is keyof PilotCapabilities => typeof v === "string" && allowed.includes(v as keyof PilotCapabilities));
  return out.length > 0 ? out : [...DEFAULT_PREFLIGHT_CONFIG.requireColonyCapabilities];
}

export function resolveColonyPilotPreflightConfig(raw?: Partial<ColonyPilotPreflightConfig>): ColonyPilotPreflightConfig {
  return {
    enabled: raw?.enabled !== false,
    enforceOnAntColonyTool: raw?.enforceOnAntColonyTool !== false,
    requiredExecutables: Array.isArray(raw?.requiredExecutables)
      ? raw!.requiredExecutables.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [...DEFAULT_PREFLIGHT_CONFIG.requiredExecutables],
    requireColonyCapabilities: normalizeCapabilitiesList(raw?.requireColonyCapabilities),
  };
}

export function executableProbe(name: string, platform = process.platform): { command: string; args: string[]; label: string } {
  const clean = name.trim();
  if (!clean) return { command: "", args: [], label: "" };

  if (platform === "win32" && clean.toLowerCase() === "npm") {
    return { command: "npm.cmd", args: ["--version"], label: "npm" };
  }

  return { command: clean, args: ["--version"], label: clean };
}

export async function runColonyPilotPreflight(
  pi: ExtensionAPI,
  caps: PilotCapabilities,
  config: ColonyPilotPreflightConfig
): Promise<ColonyPilotPreflightResult> {
  const missingCaps = missingCapabilities(caps, config.requireColonyCapabilities);
  const missingExecutables: string[] = [];

  for (const execName of config.requiredExecutables) {
    const probe = executableProbe(execName);
    if (!probe.command) continue;

    try {
      const r = await pi.exec(probe.command, probe.args, { timeout: 5000 });
      if (r.code !== 0) missingExecutables.push(probe.label);
    } catch {
      missingExecutables.push(probe.label);
    }
  }

  const failures: string[] = [];
  if (missingCaps.length > 0) {
    failures.push(`missing capabilities: ${missingCaps.join(", ")}`);
  }
  if (missingExecutables.length > 0) {
    failures.push(`missing executables: ${missingExecutables.join(", ")}`);
  }

  return {
    ok: failures.length === 0,
    missingCapabilities: missingCaps,
    missingExecutables,
    failures,
    checkedAt: Date.now(),
  };
}

function formatPreflightResult(result: ColonyPilotPreflightResult): string {
  const lines = [
    "colony-pilot preflight",
    `ok: ${result.ok ? "yes" : "no"}`,
    `missingCapabilities: ${result.missingCapabilities.length > 0 ? result.missingCapabilities.join(", ") : "(none)"}`,
    `missingExecutables: ${result.missingExecutables.length > 0 ? result.missingExecutables.join(", ") : "(none)"}`,
    `checkedAt: ${new Date(result.checkedAt).toISOString()}`,
  ];

  if (result.failures.length > 0) {
    lines.push("", "failures:", ...result.failures.map((f) => `  - ${f}`));
  }

  return lines.join("\n");
}

export type BaselineProfile = "default" | "phase2";

export function resolveBaselineProfile(input?: string): BaselineProfile {
  return input === "phase2" ? "phase2" : "default";
}

export function buildProjectBaselineSettings(profile: BaselineProfile = "default") {
  const base = {
    piStack: {
      colonyPilot: {
        preflight: {
          enabled: true,
          enforceOnAntColonyTool: true,
          requiredExecutables: ["node", "git", "npm"],
          requireColonyCapabilities: ["colony", "colonyStop"],
        },
      },
      webSessionGateway: {
        mode: "local",
        port: 3100,
      },
      guardrailsCore: {
        portConflict: {
          enabled: true,
          suggestedTestPort: 4173,
        },
      },
    },
  };

  if (profile === "default") return base;

  return deepMergeObjects(base, {
    piStack: {
      colonyPilot: {
        preflight: {
          requiredExecutables: ["node", "git", "npm", "npx"],
          requireColonyCapabilities: ["colony", "colonyStop", "monitors", "sessionWeb"],
        },
      },
      guardrailsCore: {
        portConflict: {
          suggestedTestPort: 4273,
        },
      },
    },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeObjects<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMergeObjects(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function applyProjectBaselineSettings(existing: unknown, profile: BaselineProfile = "default") {
  const current = isPlainObject(existing) ? { ...existing } : {};

  // Migration safety: older versions wrote custom config under `extensions` (reserved by pi).
  // If that happened, move known keys under `piStack` and restore `extensions` as array.
  const ext = current.extensions;
  if (isPlainObject(ext) && !Array.isArray(ext)) {
    const migrated: Record<string, unknown> = isPlainObject(current.piStack) ? { ...(current.piStack as Record<string, unknown>) } : {};
    for (const key of ["colonyPilot", "webSessionGateway", "guardrailsCore"]) {
      if (key in ext) migrated[key] = (ext as Record<string, unknown>)[key];
    }
    current.piStack = migrated;
    current.extensions = [];
  }

  const baseline = buildProjectBaselineSettings(profile);
  return deepMergeObjects(current, baseline as Record<string, unknown>);
}

function readProjectSettings(cwd: string): Record<string, unknown> {
  const p = path.join(cwd, ".pi", "settings.json");
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return isPlainObject(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeProjectSettings(cwd: string, data: Record<string, unknown>) {
  const dir = path.join(cwd, ".pi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify(data, null, 2)}\n`);
}

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as { content?: unknown };
  const { content } = msg;

  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string") {
      parts.push(p.text);
    }
  }
  return parts.join("\n");
}

function renderStatus(state: PilotState): string | undefined {
  const colonies = state.colonies.size;
  if (!state.remoteActive && colonies === 0 && state.monitorMode === "unknown") return undefined;

  const monitors = `monitors=${state.monitorMode}`;
  const web = `web=${state.remoteActive ? "on" : "off"}`;
  const ants = `colonies=${colonies}`;
  return `[pilot] ${monitors} · ${web} · ${ants}`;
}

function formatSnapshot(state: PilotState): string {
  const colonyRows = [...state.colonies.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => `  - ${c.id}: ${c.phase} (${new Date(c.updatedAt).toLocaleTimeString()})`);

  return [
    "colony-pilot status",
    `monitorMode: ${state.monitorMode}`,
    `remote: ${state.remoteActive ? "active" : "inactive"}`,
    `remoteUrl: ${state.remoteUrl ?? "(none)"}`,
    `remoteClients: ${state.remoteClients ?? 0}`,
    `sessionFile: ${state.lastSessionFile ?? "(ephemeral)"}`,
    `colonies: ${state.colonies.size}`,
    ...(colonyRows.length > 0 ? ["", ...colonyRows] : []),
  ].join("\n");
}

function updateStatusUI(ctx: ExtensionContext | undefined, state: PilotState) {
  ctx?.ui?.setStatus?.("colony-pilot", renderStatus(state));
}

function trackFromText(text: string, state: PilotState): boolean {
  let changed = false;

  const signal = parseColonySignal(text);
  if (signal) {
    const current = state.colonies.get(signal.id);
    state.colonies.set(signal.id, {
      id: signal.id,
      phase: signal.phase,
      updatedAt: Date.now(),
    });

    if (
      signal.phase === "completed" ||
      signal.phase === "failed" ||
      signal.phase === "aborted"
    ) {
      // Keep short-term completion visibility; can be pruned later if needed.
    }

    changed = !current || current.phase !== signal.phase;
  }

  const remoteUrl = parseRemoteAccessUrl(text);
  if (remoteUrl) {
    state.remoteActive = true;
    state.remoteUrl = remoteUrl;
    changed = true;
  }

  const clients = text.match(REMOTE_CLIENTS_RE)?.[1];
  if (clients) {
    const count = Number.parseInt(clients, 10);
    if (!Number.isNaN(count)) {
      state.remoteClients = count;
      state.remoteActive = true;
      changed = true;
    }
  }

  if (/Remote access stopped/i.test(text)) {
    state.remoteActive = false;
    state.remoteClients = 0;
    changed = true;
  }

  return changed;
}

export function applyTelemetryText(state: PilotState, text: string): boolean {
  return trackFromText(text, state);
}

export function snapshotPilotState(state: PilotState) {
  return {
    monitorMode: state.monitorMode,
    remoteActive: state.remoteActive,
    remoteUrl: state.remoteUrl,
    remoteClients: state.remoteClients ?? 0,
    sessionFile: state.lastSessionFile,
    colonies: [...state.colonies.values()].map((c) => ({
      id: c.id,
      phase: c.phase,
      updatedAt: c.updatedAt,
    })),
  };
}

export function parseCommandInput(input: string): { cmd: string; body: string } {
  const trimmed = input.trim();
  if (!trimmed) return { cmd: "", body: "" };

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) return { cmd: trimmed, body: "" };

  return {
    cmd: trimmed.slice(0, firstSpace),
    body: trimmed.slice(firstSpace + 1).trim(),
  };
}

export function normalizeQuotedText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function primeManualRunbook(
  ctx: ExtensionContext,
  title: string,
  steps: string[],
  reason = "Auto-dispatch de slash commands entre extensões não é suportado de forma confiável pela API atual do pi."
) {
  if (steps.length === 0) return;

  const text = [
    title,
    reason,
    "",
    "Execute na ordem:",
    ...steps.map((s) => `  - ${s}`),
    "",
    `Primei o editor com: ${steps[0]}`,
  ].join("\n");

  ctx.ui.notify(text, "info");
  ctx.ui.setEditorText?.(steps[0]);
}

function capabilityGuidance(capability: keyof PilotCapabilities): string {
  switch (capability) {
    case "remote":
      return "`/remote` ausente — revisar inclusão de `@ifi/pi-web-remote` na stack curada do ambiente (ou usar `/session-web` first-party).";
    case "sessionWeb":
      return "`/session-web` ausente — revisar carga da extensão first-party `web-session-gateway` no `@aretw0/pi-stack`.";
    case "colony":
    case "colonyStop":
      return "Comandos de colony ausentes — revisar inclusão de `@ifi/oh-pi-ant-colony` na stack curada do ambiente.";
    case "monitors":
      return "`/monitors` ausente — revisar inclusão de `@davidorex/pi-project-workflows` na stack curada do ambiente.";
    default:
      return "Capacidade ausente.";
  }
}

function getCapabilities(pi: ExtensionAPI): PilotCapabilities {
  const commands = pi.getCommands().map((c) => c.name);
  return detectPilotCapabilities(commands);
}

function requireCapabilities(
  ctx: ExtensionContext,
  caps: PilotCapabilities,
  required: Array<keyof PilotCapabilities>,
  action: string
): boolean {
  const missing = missingCapabilities(caps, required);
  if (missing.length === 0) return true;

  const lines = [
    `Não posso preparar \`${action}\` porque faltam comandos no runtime atual:`,
    ...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
    "",
    "Sem acoplamento ad hoc: valide a composição da stack e só então rode /reload.",
    "Use /colony-pilot check para diagnóstico rápido.",
  ];

  ctx.ui.notify(lines.join("\n"), "warning");
  ctx.ui.setEditorText?.("/colony-pilot check");
  return false;
}

async function tryOpenUrl(pi: ExtensionAPI, url: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const r = await pi.exec("cmd", ["/c", "start", "", url], { timeout: 5000 });
      return r.code === 0;
    }
    if (process.platform === "darwin") {
      const r = await pi.exec("open", [url], { timeout: 5000 });
      return r.code === 0;
    }

    const r = await pi.exec("xdg-open", [url], { timeout: 5000 });
    return r.code === 0;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  const state: PilotState = createPilotState();

  let currentCtx: ExtensionContext | undefined;
  let preflightConfig = resolveColonyPilotPreflightConfig();
  let preflightCache: { at: number; result: ColonyPilotPreflightResult } | undefined;

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    state.colonies.clear();
    state.remoteActive = false;
    state.remoteUrl = undefined;
    state.remoteClients = 0;
    state.monitorMode = "unknown";
    state.lastSessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;

    const settings = parseColonyPilotSettings(ctx.cwd);
    preflightConfig = resolveColonyPilotPreflightConfig(settings.preflight);
    preflightCache = undefined;

    updateStatusUI(ctx, state);
  });

  pi.on("message_end", (event, ctx) => {
    const text = extractText((event as { message?: unknown }).message);
    if (!text) return;
    if (trackFromText(text, state)) updateStatusUI(ctx, state);
  });

  pi.on("tool_result", (event, ctx) => {
    const text = extractText(event);
    if (!text) return;
    if (trackFromText(text, state)) updateStatusUI(ctx, state);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!preflightConfig.enabled || !preflightConfig.enforceOnAntColonyTool) return undefined;
    if (!isToolCallEventType("ant_colony", event)) return undefined;

    const now = Date.now();
    let result = preflightCache?.result;
    if (!result || now - preflightCache!.at > 30_000) {
      result = await runColonyPilotPreflight(pi, getCapabilities(pi), preflightConfig);
      preflightCache = { at: now, result };
    }

    if (result.ok) return undefined;

    const reason = `Blocked by colony-pilot preflight: ${result.failures.join("; ")}`;
    ctx.ui.notify(["ant_colony bloqueada por preflight", formatPreflightResult(result)].join("\n\n"), "warning");
    return { block: true, reason };
  });

  pi.registerTool({
    name: "colony_pilot_status",
    label: "Colony Pilot Status",
    description: "Mostra o estado atual do pilot: monitores, remote web e colonies em background.",
    parameters: Type.Object({}),
    async execute() {
      const snapshot = snapshotPilotState(state);
      const capabilities = getCapabilities(pi);
      const payload = { ...snapshot, capabilities };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  });

  pi.registerTool({
    name: "colony_pilot_artifacts",
    label: "Colony Pilot Artifacts",
    description: "Inspect colony runtime artifacts (workspace mirrors, state files, worktrees).",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const data = inspectAntColonyRuntime(ctx.cwd);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: data,
      };
    },
  });

  pi.registerTool({
    name: "colony_pilot_preflight",
    label: "Colony Pilot Preflight",
    description: "Run hard preflight checks used to gate ant_colony execution.",
    parameters: Type.Object({}),
    async execute() {
      const caps = getCapabilities(pi);
      const result = await runColonyPilotPreflight(pi, caps, preflightConfig);
      preflightCache = { at: Date.now(), result };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "colony_pilot_baseline",
    label: "Colony Pilot Baseline",
    description: "Show or apply project baseline settings for colony/web runtime governance.",
    parameters: Type.Object({
      apply: Type.Optional(Type.Boolean()),
      profile: Type.Optional(Type.String({ description: "default | phase2" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { apply?: boolean; profile?: string };
      const apply = Boolean(p?.apply);
      const profile = resolveBaselineProfile(p?.profile);
      const baseline = buildProjectBaselineSettings(profile);
      if (!apply) {
        return {
          content: [{ type: "text", text: JSON.stringify({ profile, baseline }, null, 2) }],
          details: { profile, baseline },
        };
      }

      const merged = applyProjectBaselineSettings(readProjectSettings(ctx.cwd), profile);
      writeProjectSettings(ctx.cwd, merged);
      return {
        content: [{ type: "text", text: `Applied project baseline (${profile}) to .pi/settings.json` }],
        details: { applied: true, profile, path: path.join(ctx.cwd, ".pi", "settings.json") },
      };
    },
  });

  pi.registerCommand("colony-pilot", {
    description: "Orquestra pilot de colony + web inspect + profile de monitores (run/status/stop/web).",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const input = (args ?? "").trim();
      const { cmd, body } = parseCommandInput(input);
      const caps = getCapabilities(pi);

      if (!cmd || cmd === "help") {
        ctx.ui.notify(
          [
            "Usage: /colony-pilot <command>",
            "",
            "Commands:",
            "  prep                          Mostrar plano recomendado do pilot",
            "  run <goal>                    Prepara sequência manual: /monitors off -> /remote -> /colony <goal>",
            "  stop [--restore-monitors]     Prepara sequência manual: /colony-stop all -> /remote stop [-> /monitors on]",
            "  monitors <on|off>             Prepara comando de profile de monitores",
            "  web <start|stop|open|status>  Controla/inspeciona sessão web",
            "  tui                           Mostra como entrar/retomar sessão no TUI",
            "  status                        Snapshot consolidado",
            "  check                         Diagnóstico de capacidades carregadas (/monitors,/remote,/colony)",
            "  preflight                     Executa gates duros (capabilities + executáveis) antes da colony",
            "  baseline [show|apply] [default|phase2]  Baseline de .pi/settings.json (phase2 = mais estrito)",
            "  artifacts                     Mostra onde colony guarda states/worktrees para recovery",
            "",
            "Nota: o pi não expõe API confiável para uma extensão invocar slash commands de outra",
            "extensão no mesmo runtime. O pilot prepara e guia execução manual assistida.",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "prep") {
        const base = ["/monitors off", "/remote", "/colony <goal>"];
        primeManualRunbook(
          ctx,
          "Pilot direction:",
          base,
          [
            "- colony run com monitores gerais OFF",
            "- governança principal: mecanismos da colony (inclui soldier)",
            "- inspeção ativa por web remote + TUI status",
            "",
            "Auto-dispatch foi desativado por confiabilidade da API de comandos entre extensões.",
          ].join("\n")
        );
        return;
      }

      if (cmd === "check") {
        const missing = missingCapabilities(caps, ["monitors", "sessionWeb", "remote", "colony", "colonyStop"]);
        const lines = [
          "colony-pilot capabilities",
          `  monitors: ${caps.monitors ? "ok" : "missing"}`,
          `  session-web: ${caps.sessionWeb ? "ok" : "missing"}`,
          `  remote: ${caps.remote ? "ok" : "missing"}`,
          `  colony: ${caps.colony ? "ok" : "missing"}`,
          `  colony-stop: ${caps.colonyStop ? "ok" : "missing"}`,
        ];

        if (missing.length > 0) {
          lines.push("", "Gaps detectados:", ...missing.map((m) => `  - ${capabilityGuidance(m)}`));
        }

        ctx.ui.notify(lines.join("\n"), missing.length > 0 ? "warning" : "info");
        return;
      }

      if (cmd === "status") {
        const lines = [
          formatSnapshot(state),
          "",
          "capabilities:",
          `  monitors=${caps.monitors ? "ok" : "missing"}`,
          `  session-web=${caps.sessionWeb ? "ok" : "missing"}`,
          `  remote=${caps.remote ? "ok" : "missing"}`,
          `  colony=${caps.colony ? "ok" : "missing"}`,
          `  colony-stop=${caps.colonyStop ? "ok" : "missing"}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (cmd === "preflight") {
        const result = await runColonyPilotPreflight(pi, caps, preflightConfig);
        preflightCache = { at: Date.now(), result };
        ctx.ui.notify(formatPreflightResult(result), result.ok ? "info" : "warning");
        return;
      }

      if (cmd === "baseline") {
        const parsed = parseCommandInput(body);
        const maybeAction = parsed.cmd || "show";
        const isProfileOnly = maybeAction === "default" || maybeAction === "phase2";
        const act = isProfileOnly ? "show" : maybeAction;
        const profileSource = isProfileOnly
          ? maybeAction
          : (parseCommandInput(parsed.body).cmd || parsed.body || "default");
        const profile = resolveBaselineProfile(profileSource);

        if (act === "show") {
          const baseline = buildProjectBaselineSettings(profile);
          ctx.ui.notify(
            [
              `colony-pilot project baseline (${profile}) (.pi/settings.json)`,
              "",
              JSON.stringify(baseline, null, 2),
              "",
              "Para aplicar automaticamente:",
              `  /colony-pilot baseline apply ${profile}`,
            ].join("\n"),
            "info"
          );
          return;
        }

        if (act === "apply") {
          const merged = applyProjectBaselineSettings(readProjectSettings(ctx.cwd), profile);
          writeProjectSettings(ctx.cwd, merged);
          ctx.ui.notify(
            [
              `Baseline (${profile}) aplicada em .pi/settings.json`,
              "Recomendado: /reload",
            ].join("\n"),
            "info"
          );
          ctx.ui.setEditorText?.("/reload");
          return;
        }

        ctx.ui.notify("Usage: /colony-pilot baseline [show|apply] [default|phase2]", "warning");
        return;
      }

      if (cmd === "artifacts") {
        const data = inspectAntColonyRuntime(ctx.cwd);
        ctx.ui.notify(formatArtifactsReport(data), "info");
        return;
      }

      if (cmd === "run") {
        const goal = normalizeQuotedText(body);
        if (!goal) {
          ctx.ui.notify("Usage: /colony-pilot run <goal>", "warning");
          return;
        }

        if (!caps.monitors || !caps.colony || (!caps.remote && !caps.sessionWeb)) {
          const missing: Array<keyof PilotCapabilities> = [];
          if (!caps.monitors) missing.push("monitors");
          if (!caps.colony) missing.push("colony");
          if (!caps.remote && !caps.sessionWeb) missing.push("sessionWeb", "remote");
          const lines = [
            "Não posso preparar `run` porque faltam comandos no runtime atual:",
            ...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
            "",
            "Use /colony-pilot check para diagnóstico rápido.",
          ];
          ctx.ui.notify(lines.join("\n"), "warning");
          return;
        }

        const preflight = await runColonyPilotPreflight(pi, caps, preflightConfig);
        preflightCache = { at: Date.now(), result: preflight };
        if (!preflight.ok) {
          ctx.ui.notify(
            [
              "Run bloqueado por preflight.",
              formatPreflightResult(preflight),
              "",
              "Resolva os itens e rode /colony-pilot preflight novamente.",
            ].join("\n"),
            "warning"
          );
          ctx.ui.setEditorText?.("/colony-pilot preflight");
          return;
        }

        const sequence = buildRuntimeRunSequence(caps, goal);
        state.monitorMode = "off";
        updateStatusUI(ctx, state);

        primeManualRunbook(ctx, "Pilot run pronto (manual assistido)", sequence);
        return;
      }

      if (cmd === "stop") {
        const restore = body.includes("--restore-monitors");
        if (!caps.colonyStop || (!caps.remote && !caps.sessionWeb) || (restore && !caps.monitors)) {
          const missing: Array<keyof PilotCapabilities> = [];
          if (!caps.colonyStop) missing.push("colonyStop");
          if (!caps.remote && !caps.sessionWeb) missing.push("sessionWeb", "remote");
          if (restore && !caps.monitors) missing.push("monitors");

          const lines = [
            "Não posso preparar `stop` porque faltam comandos no runtime atual:",
            ...missing.map((m) => `  - ${m}: ${capabilityGuidance(m)}`),
            "",
            "Use /colony-pilot check para diagnóstico rápido.",
          ];
          ctx.ui.notify(lines.join("\n"), "warning");
          return;
        }

        const sequence = buildRuntimeStopSequence(caps, { restoreMonitors: restore });
        if (restore) state.monitorMode = "on";
        updateStatusUI(ctx, state);

        primeManualRunbook(ctx, "Pilot stop pronto (manual assistido)", sequence);
        return;
      }

      if (cmd === "monitors") {
        const mode = normalizeQuotedText(body).split(/\s+/)[0];
        if (mode !== "on" && mode !== "off") {
          ctx.ui.notify("Usage: /colony-pilot monitors <on|off>", "warning");
          return;
        }

        if (!requireCapabilities(ctx, caps, ["monitors"], "monitors")) {
          return;
        }

        state.monitorMode = mode;
        updateStatusUI(ctx, state);
        primeManualRunbook(
          ctx,
          `Profile de monitores (${mode.toUpperCase()}) pronto`,
          [`/monitors ${mode}`],
          "Execute o comando abaixo para aplicar no runtime atual."
        );
        return;
      }

      if (cmd === "web") {
        const { cmd: actionCmd } = parseCommandInput(body);
        const action = actionCmd || "status";

        if (action === "start") {
          if (!caps.remote && !caps.sessionWeb) {
            const lines = [
              "Não posso preparar `web start` porque faltam comandos de web no runtime:",
              `  - sessionWeb: ${capabilityGuidance("sessionWeb")}`,
              `  - remote: ${capabilityGuidance("remote")}`,
            ];
            ctx.ui.notify(lines.join("\n"), "warning");
            return;
          }

          const cmd = caps.sessionWeb ? "/session-web start" : "/remote";
          primeManualRunbook(
            ctx,
            "Start do web session pronto",
            [cmd],
            "Execute o comando abaixo para iniciar o servidor web da sessão."
          );
          return;
        }

        if (action === "stop") {
          if (!caps.remote && !caps.sessionWeb) {
            const lines = [
              "Não posso preparar `web stop` porque faltam comandos de web no runtime:",
              `  - sessionWeb: ${capabilityGuidance("sessionWeb")}`,
              `  - remote: ${capabilityGuidance("remote")}`,
            ];
            ctx.ui.notify(lines.join("\n"), "warning");
            return;
          }

          state.remoteActive = false;
          state.remoteClients = 0;
          updateStatusUI(ctx, state);
          const cmd = caps.sessionWeb ? "/session-web stop" : "/remote stop";
          primeManualRunbook(
            ctx,
            "Stop do web session pronto",
            [cmd],
            "Execute o comando abaixo para encerrar o servidor web da sessão."
          );
          return;
        }

        if (action === "open") {
          if (!state.remoteUrl) {
            ctx.ui.notify("Nenhuma URL remote detectada ainda. Rode /colony-pilot web start e depois /colony-pilot status.", "warning");
            return;
          }

          const ok = await tryOpenUrl(pi, state.remoteUrl);
          if (ok) {
            ctx.ui.notify(`Abrindo browser: ${state.remoteUrl}`, "info");
          } else {
            ctx.ui.notify(`Nao consegui abrir automaticamente. URL: ${state.remoteUrl}`, "warning");
          }
          return;
        }

        if (action === "status") {
          const lines = [
            `remote: ${state.remoteActive ? "active" : "inactive"}`,
            `clients: ${state.remoteClients ?? 0}`,
            `url: ${state.remoteUrl ?? "(none)"}`,
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }

        ctx.ui.notify("Usage: /colony-pilot web <start|stop|open|status>", "warning");
        return;
      }

      if (cmd === "tui") {
        ctx.ui.notify(
          [
            "TUI session access:",
            "- Nesta instância você já está na sessão ativa.",
            "- Em outro terminal, abra `pi` e use `/resume` para entrar nesta sessão.",
            `- Session file atual: ${state.lastSessionFile ?? "(ephemeral / sem arquivo)"}`,
          ].join("\n"),
          "info"
        );
        return;
      }

      ctx.ui.notify(`Comando desconhecido: ${cmd}. Use /colony-pilot help`, "warning");
    },
  });

  pi.on("session_shutdown", () => {
    updateStatusUI(currentCtx, {
      ...state,
      monitorMode: "unknown",
      remoteActive: false,
      colonies: new Map(),
    });
  });
}
