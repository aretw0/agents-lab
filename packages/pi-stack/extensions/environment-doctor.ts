/**
 * environment-doctor — Health check extension for pi-stack.
 *
 * On session_start, runs a quick environment check and shows a status
 * widget if tools or terminal configurations are missing.
 *
 * Provides /doctor command for full diagnostics with optional auto-fix.
 *
 * Never blocks the agent — only informs and offers to help.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Terminal Detection ──────────────────────────────────────────────────────

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

// ─── Terminal Checks ─────────────────────────────────────────────────────────

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
      message: "settings.json não encontrado",
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
      message: "settings.json não pôde ser lido",
      fix: { description: "Verificar se o arquivo é JSON válido", auto: false },
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
      message: "Arquivo de config não encontrado",
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
      message: "Tem keybind legado shift+enter=text:\\n — causa conflito com Ctrl+J no pi",
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
      message: "~/.wezterm.lua não encontrado",
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
      message: "enable_kitty_keyboard não configurado",
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
      return { name: `${terminal} config`, status: "ok", message: "Suporte nativo — sem configuração necessária" };
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

// ─── Tool Checks ─────────────────────────────────────────────────────────────

async function checkTool(
  pi: ExtensionAPI,
  name: string,
  command: string,
  versionArgs: string[],
  authCheck?: { command: string; args: string[]; failHint: string }
): Promise<CheckResult> {
  try {
    const result = await pi.exec(command, versionArgs, { timeout: 5000 });
    if (result.code !== 0) {
      return { name, status: "error", message: `${name} não encontrado no PATH` };
    }

    if (authCheck) {
      try {
        const authResult = await pi.exec(authCheck.command, authCheck.args, { timeout: 5000 });
        if (authResult.code !== 0) {
          return {
            name,
            status: "warn",
            message: `${name} instalado mas não autenticado`,
            fix: { description: authCheck.failHint, auto: false },
          };
        }
      } catch {
        return {
          name,
          status: "warn",
          message: `${name} instalado mas autenticação não verificada`,
          fix: { description: authCheck.failHint, auto: false },
        };
      }
    }

    const version = result.stdout?.trim().split("\n")[0] ?? "";
    return { name, status: "ok", message: version };
  } catch {
    return { name, status: "error", message: `${name} não encontrado` };
  }
}

async function runAllChecks(pi: ExtensionAPI): Promise<{
  tools: CheckResult[];
  terminal: CheckResult | null;
  terminalId: TerminalId;
}> {
  const [tools, terminalId] = await Promise.all([
    Promise.all([
      checkTool(pi, "git", "git", ["--version"]),
      checkTool(pi, "gh", "gh", ["--version"], {
        command: "gh",
        args: ["auth", "status"],
        failHint: "gh auth login",
      }),
      checkTool(pi, "glab", "glab", ["--version"], {
        command: "glab",
        args: ["auth", "status"],
        failHint: "glab auth login",
      }),
      checkTool(pi, "node", "node", ["--version"]),
      checkTool(pi, "npm", "npm", ["--version"]),
    ]),
    Promise.resolve(detectTerminal()),
  ]);

  return { tools, terminal: checkTerminal(terminalId), terminalId };
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const { tools, terminal } = await runAllChecks(pi);

    const issues = [
      ...tools.filter((r) => r.status !== "ok"),
      ...(terminal && terminal.status !== "ok" ? [terminal] : []),
    ];

    if (issues.length > 0) {
      const labels = issues.map((i) => {
        const icon = i.status === "error" ? "❌" : "⚠️";
        return `${icon} ${i.name}`;
      });
      ctx.ui?.setStatus?.("env-doctor", `${labels.join("  ")} — /doctor para detalhes`);
    }
  });

  pi.registerCommand("doctor", {
    description: "Diagnóstico do ambiente — ferramentas, autenticações e configuração de terminal",
    handler: async (_args, ctx) => {
      ctx.ui.notify("🔍 Verificando ambiente...", "info");

      const { tools, terminal, terminalId } = await runAllChecks(pi);
      const allResults = [...tools, ...(terminal ? [terminal] : [])];
      const issues = allResults.filter((r) => r.status !== "ok");

      if (issues.length === 0) {
        ctx.ui.notify("✅ Ambiente completo — tudo configurado.", "info");
        ctx.ui.setStatus?.("env-doctor", undefined);
        return;
      }

      ctx.ui.notify(`\n⚠️  ${issues.length} item(s) precisam de atenção:\n`, "info");

      for (const issue of issues) {
        const icon = issue.status === "error" ? "❌" : "⚠️";
        ctx.ui.notify(`${icon} ${issue.name}: ${issue.message}`, "info");

        if (issue.fix) {
          if (issue.fix.auto && ctx.hasUI) {
            const ok = await ctx.ui.confirm(
              `Corrigir: ${issue.name}`,
              `${issue.fix.description}\n\nAplicar automaticamente?`
            );
            if (ok && issue.fix.apply) {
              await issue.fix.apply();
              ctx.ui.notify(`✅ ${issue.name} configurado. Reinicie o terminal para aplicar.`, "info");
            } else if (!ok) {
              ctx.ui.notify(`   → ${issue.fix.description}`, "info");
            }
          } else {
            ctx.ui.notify(`   → ${issue.fix.description}`, "info");
          }
        }
      }

      ctx.ui.notify(`\n📋 Terminal detectado: ${terminalId}`, "info");
      ctx.ui.notify("O pi não está bloqueado, mas funcionalidades podem ser limitadas.", "info");
    },
  });
}
