/**
 * environment-doctor -- Health check extension for pi-stack.
 * @capability-id global-runtime-doctor
 * @capability-criticality high
 *
 * On session_start, runs a quick environment check and shows a status
 * widget if tools or terminal configurations are missing.
 *
 * Provides /doctor command for full diagnostics with optional auto-fix.
 *
 * Never blocks the agent -- only informs and offers to help.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";

// --- Types ---

type Severity = "ok" | "warn" | "error";

interface CheckResult {
  name: string;
  status: Severity;
  message: string;
  fix?: {
    description: string;
    auto: boolean; // can be applied automatically
    apply?: () => Promise<void>;
  };
}

// --- Terminal Detection ---

export type TerminalId =
  | "windows-terminal"
  | "ghostty"
  | "wezterm"
  | "vscode"
  | "kitty"
  | "iterm2"
  | "unknown";

export function detectTerminal(): TerminalId {
  const env = process.env;
  if (env.WT_SESSION) return "windows-terminal";
  if (env.GHOSTTY_RESOURCES_DIR || env.GHOSTTY_WINDOW_ID) return "ghostty";
  if (env.WEZTERM_EXECUTABLE || env.WEZTERM_PANE) return "wezterm";
  if (env.TERM_PROGRAM === "vscode") return "vscode";
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.TERM_PROGRAM === "iTerm.app") return "iterm2";
  return "unknown";
}

// --- Terminal Checks ---

const WT_SETTINGS_PATH = join(
  homedir(),
  "AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json"
);

const WT_PREVIEW_SETTINGS_PATH = join(
  homedir(),
  "AppData/Local/Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json"
);

export function findWindowsTerminalSettings(): string | undefined {
  if (existsSync(WT_SETTINGS_PATH)) return WT_SETTINGS_PATH;
  if (existsSync(WT_PREVIEW_SETTINGS_PATH)) return WT_PREVIEW_SETTINGS_PATH;
  return undefined;
}

export function checkWindowsTerminalConfig(): CheckResult {
  const settingsPath = findWindowsTerminalSettings();

  if (!settingsPath) {
    return {
      name: "Windows Terminal config",
      status: "warn",
      message: "settings.json nao encontrado",
      fix: {
        description: "Abrir Windows Terminal e pressionar Ctrl+Shift+, para criar settings.json",
        auto: false,
      },
    };
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return {
      name: "Windows Terminal config",
      status: "warn",
      message: "settings.json nao pode ser lido",
      fix: { description: "Verificar se o arquivo e JSON valido", auto: false },
    };
  }

  const actions = (settings.actions as unknown[]) ?? [];
  const hasShiftEnter = JSON.stringify(actions).includes("1b[13;2u");
  const hasAltEnter = JSON.stringify(actions).includes("1b[13;3u");

  if (hasShiftEnter && hasAltEnter) {
    return { name: "Windows Terminal config", status: "ok", message: "Shift+Enter e Alt+Enter configurados" };
  }

  const missing: string[] = [];
  if (!hasShiftEnter) missing.push("Shift+Enter");
  if (!hasAltEnter) missing.push("Alt+Enter (desfaz fullscreen)");

  return {
    name: "Windows Terminal config",
    status: "warn",
    message: `Falta remapping: ${missing.join(", ")}`,
    fix: {
      description: "Adicionar remappings ao settings.json do Windows Terminal",
      auto: true,
      apply: async () => {
        const current = JSON.parse(readFileSync(settingsPath, "utf8"));
        const existingActions = (current.actions as unknown[]) ?? [];
        const toAdd: unknown[] = [];

        if (!hasShiftEnter) {
          toAdd.push({
            command: { action: "sendInput", input: "\u001b[13;2u" },
            keys: "shift+enter",
          });
        }
        if (!hasAltEnter) {
          toAdd.push({
            command: { action: "sendInput", input: "\u001b[13;3u" },
            keys: "alt+enter",
          });
        }

        current.actions = [...existingActions, ...toAdd];
        writeFileSync(settingsPath, JSON.stringify(current, null, 4), "utf8");
      },
    },
  };
}

export function checkGhosttyConfig(): CheckResult {
  const configPaths = [
    join(homedir(), ".config/ghostty/config"),
    join(homedir(), "Library/Application Support/com.mitchellh.ghostty/config"),
  ];

  const configPath = configPaths.find((p) => existsSync(p));

  if (!configPath) {
    return {
      name: "Ghostty config",
      status: "warn",
      message: "Arquivo de config nao encontrado",
      fix: {
        description: `Criar config em: ${configPaths[0]}\nAdicionar: keybind = alt+backspace=text:\\x1b\\x7f`,
        auto: false,
      },
    };
  }

  const content = readFileSync(configPath, "utf8");
  const hasAltBackspace = content.includes("alt+backspace=text:\\x1b\\x7f");
  const hasLegacyShiftEnter = content.includes("shift+enter=text:\\n");

  if (hasLegacyShiftEnter) {
    return {
      name: "Ghostty config",
      status: "warn",
      message: "Tem keybind legado shift+enter=text:\\n -- causa conflito com Ctrl+J no pi",
      fix: {
        description: "Remover: keybind = shift+enter=text:\\n do config do Ghostty",
        auto: false,
      },
    };
  }

  if (!hasAltBackspace) {
    return {
      name: "Ghostty config",
      status: "warn",
      message: "Falta keybind alt+backspace",
      fix: {
        description: `Adicionar ao ${configPath}:\nkeybind = alt+backspace=text:\\x1b\\x7f`,
        auto: true,
        apply: async () => {
          const current = readFileSync(configPath, "utf8");
          writeFileSync(configPath, current + "\nkeybind = alt+backspace=text:\\x1b\\x7f\n", "utf8");
        },
      },
    };
  }

  return { name: "Ghostty config", status: "ok", message: "Keybindings configurados" };
}

export function checkWeztermConfig(): CheckResult {
  const configPath = join(homedir(), ".wezterm.lua");

  if (!existsSync(configPath)) {
    return {
      name: "WezTerm config",
      status: "warn",
      message: "~/.wezterm.lua nao encontrado",
      fix: {
        description: "Criar ~/.wezterm.lua com enable_kitty_keyboard = true",
        auto: true,
        apply: async () => {
          writeFileSync(
            configPath,
            `local wezterm = require 'wezterm'\nlocal config = wezterm.config_builder()\nconfig.enable_kitty_keyboard = true\nreturn config\n`,
            "utf8"
          );
        },
      },
    };
  }

  const content = readFileSync(configPath, "utf8");
  if (!content.includes("enable_kitty_keyboard")) {
    return {
      name: "WezTerm config",
      status: "warn",
      message: "enable_kitty_keyboard nao configurado",
      fix: {
        description: "Adicionar config.enable_kitty_keyboard = true ao ~/.wezterm.lua",
        auto: false,
      },
    };
  }

  return { name: "WezTerm config", status: "ok", message: "Kitty keyboard protocol habilitado" };
}

export function checkTerminal(terminal: TerminalId): CheckResult | null {
  switch (terminal) {
    case "windows-terminal": return checkWindowsTerminalConfig();
    case "ghostty": return checkGhosttyConfig();
    case "wezterm": return checkWeztermConfig();
    case "kitty":
    case "iterm2":
      return { name: `${terminal} config`, status: "ok", message: "Suporte nativo -- sem configuracao necessaria" };
    case "vscode":
      return {
        name: "VS Code terminal config",
        status: "warn",
        message: "Shift+Enter requer keybinding no VS Code",
        fix: {
          description: 'Adicionar ao keybindings.json:\n{ "key": "shift+enter", "command": "workbench.action.terminal.sendSequence", "args": { "text": "\\u001b[13;2u" }, "when": "terminalFocus" }',
          auto: false,
        },
      };
    default:
      return null;
  }
}

// --- Shell Check ---

export type ShellId = "git-bash" | "wsl" | "native-bash" | "powershell" | "cmd" | "unknown";

export function detectShell(): ShellId {
  const platform = process.platform;
  if (platform !== "win32") return "native-bash";

  const shellPath = (process.env.SHELL ?? process.env.ComSpec ?? "").toLowerCase();
  const psModule = (process.env.PSModulePath ?? "").toLowerCase();

  const isWSL =
    (process.env.WSL_DISTRO_NAME !== undefined && process.env.WSL_DISTRO_NAME !== "") ||
    process.env.WSL_INTEROP !== undefined ||
    (process.env.PATH ?? "").includes("/mnt/c/");

  if (isWSL) return "wsl";
  if (process.env.MSYSTEM || process.env.MINGW_PREFIX) return "git-bash";
  if (shellPath.includes("powershell") || psModule.includes("powershell")) return "powershell";
  if (shellPath.includes("cmd.exe") || shellPath.endsWith("\\cmd")) return "cmd";

  return "unknown";
}

export function checkShell(): CheckResult {
  const shell = detectShell();
  const platform = process.platform;

  if (platform !== "win32") {
    return { name: "Shell", status: "ok", message: `${shell} (nativo)` };
  }

  if (shell === "wsl") {
    return {
      name: "Shell",
      status: "warn",
      message: "Pi esta usando bash do WSL em vez do Git Bash",
      fix: {
        description:
          'Adicionar ao ~/.pi/agent/settings.json:\n  "shellPath": "C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe"\n\nDepois rode /reload.',
        auto: false,
      },
    };
  }

  if (shell === "git-bash") {
    return { name: "Shell", status: "ok", message: "Git Bash (MINGW)" };
  }

  if (shell === "powershell") {
    return { name: "Shell", status: "ok", message: "PowerShell" };
  }

  if (shell === "cmd") {
    return {
      name: "Shell",
      status: "warn",
      message: "cmd.exe detectado (funciona, mas Git Bash tende a ser mais estável para dev flows)",
      fix: {
        description: 'Se quiser padronizar, configure shellPath para Git Bash em ~/.pi/agent/settings.json:\n  "shellPath": "C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe"',
        auto: false,
      },
    };
  }

  return { name: "Shell", status: "warn", message: "unknown (não foi possível identificar shell com precisão)" };
}

// --- Tool Checks ---

async function checkTool(
  pi: ExtensionAPI,
  name: string,
  command: string,
  versionArgs: string[],
  authCheck?: { command: string; args: string[]; failHint: string }
): Promise<CheckResult> {
  try {
    let result = await pi.exec(command, versionArgs, { timeout: 5000 });

    // Windows portability fallback: some runtimes fail spawning npm(.cmd) directly.
    if (result.code !== 0 && process.platform === "win32" && name === "npm") {
      result = await pi.exec("cmd", ["/c", "npm", "--version"], { timeout: 5000 });
    }

    if (result.code !== 0) {
      return { name, status: "error", message: `Nao encontrado no PATH` };
    }

    if (authCheck) {
      try {
        const authResult = await pi.exec(authCheck.command, authCheck.args, { timeout: 5000 });
        if (authResult.code !== 0) {
          return {
            name,
            status: "warn",
            message: `Instalado mas nao autenticado`,
            fix: { description: authCheck.failHint, auto: false },
          };
        }
      } catch {
        return {
          name,
          status: "warn",
          message: `Instalado mas autenticacao nao verificada`,
          fix: { description: authCheck.failHint, auto: false },
        };
      }
    }

    const version = result.stdout?.trim().split("\n")[0] ?? "";
    return { name, status: "ok", message: version };
  } catch {
    return { name, status: "error", message: `Nao encontrado` };
  }
}

interface SchedulerLeaseSnapshot {
  instanceId: string;
  sessionId: string | null;
  pid: number;
  cwd: string;
  heartbeatAt: number;
}

export function getSchedulerStoragePathForCwd(cwd: string): string {
  const schedulerRoot = join(homedir(), ".pi", "agent", "scheduler");
  const resolved = resolve(cwd);
  const parsed = parse(resolved);
  const relativeSegments = resolved.slice(parsed.root.length).split(/[/\\]+/).filter(Boolean);
  const rootSegment = parsed.root
    ? parsed.root.replaceAll(/[^a-zA-Z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "").toLowerCase() || "root"
    : "root";
  return join(schedulerRoot, rootSegment, ...relativeSegments, "scheduler.json");
}

export function getSchedulerLeasePathForCwd(cwd: string): string {
  const storagePath = getSchedulerStoragePathForCwd(cwd);
  return join(storagePath, "..", "scheduler.lease.json");
}

export function readSchedulerLease(cwd: string): SchedulerLeaseSnapshot | undefined {
  const leasePath = getSchedulerLeasePathForCwd(cwd);
  if (!existsSync(leasePath)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(leasePath, "utf8")) as SchedulerLeaseSnapshot;
    if (!(parsed?.instanceId && Number.isFinite(parsed?.heartbeatAt))) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function checkSchedulerGovernance(cwd: string): CheckResult {
  const lease = readSchedulerLease(cwd);
  const settingsPath = join(cwd, ".pi", "settings.json");

  let policy = "observe";
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const maybePolicy = settings?.piStack?.schedulerGovernance?.policy;
      if (typeof maybePolicy === "string" && maybePolicy.trim()) policy = maybePolicy.trim();
    } catch {
      // ignore malformed settings
    }
  }

  if (!lease) {
    return {
      name: "Scheduler governance",
      status: "ok",
      message: `policy=${policy} · no active lease found`,
    };
  }

  const ageMs = Math.max(0, Date.now() - lease.heartbeatAt);
  const staleAfterMs = 10_000;
  const fresh = ageMs < staleAfterMs;
  const foreign = fresh && lease.pid !== process.pid;

  if (foreign) {
    return {
      name: "Scheduler governance",
      status: policy === "observe" || policy === "review" ? "warn" : "error",
      message: `policy=${policy} · foreign owner pid=${lease.pid} instance=${lease.instanceId} heartbeatAge=${ageMs}ms`,
      fix: {
        description: "Run /scheduler-governance status and keep policy=observe/review unless takeover is explicitly approved.",
        auto: false,
      },
    };
  }

  return {
    name: "Scheduler governance",
    status: "ok",
    message: `policy=${policy} · lease owner pid=${lease.pid} heartbeatAge=${ageMs}ms${fresh ? "" : " (stale)"}`,
  };
}

async function runAllChecks(
  pi: ExtensionAPI,
  options: { includeAuthChecks?: boolean; cwd?: string } = {}
): Promise<{
  tools: CheckResult[];
  terminal: CheckResult | null;
  shell: CheckResult;
  scheduler: CheckResult;
  terminalId: TerminalId;
  shellId: ShellId;
}> {
  const includeAuthChecks = options.includeAuthChecks ?? true;
  const cwd = options.cwd ?? process.cwd();

  const [tools, terminalId, shellId] = await Promise.all([
    Promise.all([
      checkTool(pi, "git", "git", ["--version"]),
      checkTool(
        pi,
        "gh",
        "gh",
        ["--version"],
        includeAuthChecks
          ? {
            command: "gh",
            args: ["auth", "status"],
            failHint: "gh auth login",
          }
          : undefined
      ),
      checkTool(
        pi,
        "glab",
        "glab",
        ["--version"],
        includeAuthChecks
          ? {
            command: "glab",
            args: ["auth", "status"],
            failHint: "glab auth login",
          }
          : undefined
      ),
      checkTool(pi, "node", "node", ["--version"]),
      // On Windows, npm is npm.cmd -- not found via spawn without shell.
      // Use 'npm.cmd' on win32, 'npm' elsewhere.
      checkTool(pi, "npm", process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]),
    ]),
    Promise.resolve(detectTerminal()),
    Promise.resolve(detectShell()),
  ]);

  return {
    tools,
    terminal: checkTerminal(terminalId),
    shell: checkShell(),
    scheduler: checkSchedulerGovernance(cwd),
    terminalId,
    shellId,
  };
}

// --- Formatting ---

function icon(status: Severity): string {
  switch (status) {
    case "ok": return "[ok]";
    case "warn": return "[!!]";
    case "error": return "[XX]";
  }
}

function formatSection(title: string, results: CheckResult[]): string {
  const lines = [`\n  ${title}`];
  for (const r of results) {
    lines.push(`    ${icon(r.status)} ${r.name}: ${r.message}`);
  }
  return lines.join("\n");
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const loadingTimer = setTimeout(() => {
      ctx.ui?.setStatus?.("env-doctor", "[..] Verificando ambiente...");
    }, 700);

    // Nao bloqueia inicializacao: roda em background com checks mais leves.
    void (async () => {
      try {
        const { tools, terminal, shell, scheduler } = await runAllChecks(pi, {
          includeAuthChecks: false,
          cwd: ctx.cwd,
        });

        const allResults = [
          ...tools,
          ...(terminal ? [terminal] : []),
          shell,
          scheduler,
        ];
        const issues = allResults.filter((r) => r.status !== "ok");

        if (issues.length > 0) {
          const labels = issues.map((i) => `${icon(i.status)} ${i.name}`);
          ctx.ui?.setStatus?.("env-doctor", `${labels.join("  ")} -- /doctor para detalhes e auto-fix`);
        } else {
          ctx.ui?.setStatus?.("env-doctor", undefined);
        }
      } finally {
        clearTimeout(loadingTimer);
      }
    })();
  });

  pi.registerTool({
    name: "environment_doctor_status",
    label: "Environment Doctor Status",
    description: "Run environment-doctor checks and return structured diagnostics.",
    parameters: Type.Object({
      includeAuthChecks: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as { includeAuthChecks?: boolean };
      const includeAuthChecks = p.includeAuthChecks !== false;
      const { tools, terminal, shell, scheduler, terminalId, shellId } = await runAllChecks(pi, {
        includeAuthChecks,
        cwd: ctx.cwd,
      });

      const allResults = [...tools, ...(terminal ? [terminal] : []), shell, scheduler];
      const payload = {
        platform: process.platform,
        terminalId,
        shellId,
        tools,
        terminal,
        shell,
        scheduler,
        okCount: allResults.filter((r) => r.status === "ok").length,
        totalCount: allResults.length,
        issues: allResults.filter((r) => r.status !== "ok"),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  });

  pi.registerCommand("doctor", {
    description: "Diagnostico completo do ambiente -- ferramentas, auth, terminal, shell",
    handler: async (_args, ctx) => {
      const { tools, terminal, shell, scheduler, terminalId, shellId } = await runAllChecks(pi, {
        includeAuthChecks: true,
        cwd: ctx.cwd,
      });

      // Build full report
      const report: string[] = [];
      report.push("\n==============================");
      report.push("  pi-stack environment doctor");
      report.push("==============================");

      // Platform
      report.push(`\n  Plataforma: ${process.platform} | Terminal: ${terminalId} | Shell: ${shellId}`);

      // Tools section -- always show everything
      report.push(formatSection("Ferramentas", tools));

      // Terminal section
      if (terminal) {
        report.push(formatSection("Terminal", [terminal]));
      } else {
        report.push(`\n  Terminal\n    [--] ${terminalId}: nao verificado (terminal desconhecido)`);
      }

      // Shell section
      report.push(formatSection("Shell", [shell]));

      // Scheduler governance section
      report.push(formatSection("Scheduler", [scheduler]));

      // Summary
      const allResults = [...tools, ...(terminal ? [terminal] : []), shell, scheduler];
      const issues = allResults.filter((r) => r.status !== "ok");
      const okCount = allResults.filter((r) => r.status === "ok").length;

      report.push("\n  ------------------------------");
      report.push(`  ${okCount}/${allResults.length} checks ok`);

      if (issues.length === 0) {
        report.push("  Ambiente completo -- tudo configurado.");
        report.push("==============================\n");
        ctx.ui.notify(report.join("\n"), "info");
        ctx.ui.setStatus?.("env-doctor", undefined);
        return;
      }

      report.push(`  ${issues.length} item(s) precisam de atencao:`);
      report.push("==============================\n");

      ctx.ui.notify(report.join("\n"), "info");

      // Offer fixes proactively
      for (const issue of issues) {
        if (!issue.fix) continue;

        ctx.ui.notify(`\n>> ${issue.name}: ${issue.message}`, "info");

        if (issue.fix.auto && ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            `Configurar ${issue.name}?`,
            `${issue.fix.description}\n\nAplicar automaticamente?`
          );
          if (ok && issue.fix.apply) {
            await issue.fix.apply();
            ctx.ui.notify(`   [ok] Aplicado. Reinicie o terminal para efetivar.`, "info");
          } else {
            ctx.ui.notify(`   Instrucao manual:\n   ${issue.fix.description.replace(/\n/g, "\n   ")}`, "info");
          }
        } else {
          ctx.ui.notify(`   Instrucao:\n   ${issue.fix.description.replace(/\n/g, "\n   ")}`, "info");
        }
      }
    },
  });
}
