export type ShellFamily = "git-bash" | "wsl" | "native-bash" | "powershell" | "cmd" | "unknown";

export type CommandRoutingProfile = {
  platform: string;
  shell: ShellFamily;
  profileId: "windows-git-bash-cmd-node" | "default";
  preferCmdForNodeFamily: boolean;
  reason: string;
};

export type BashCommandRoutingDecision = {
  action: "allow" | "block";
  reason?: string;
  firstToken?: string;
};

export type ShellRoutingWrapResult = {
  changed: boolean;
  wrappedCommand: string;
  reason: string;
};

const NODE_FAMILY_TOKENS = new Set([
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "vitest",
]);

const CMD_WRAPPER_PATTERN = /^\s*cmd(?:\.exe)?\s+\/c\b/i;

export function detectShellFamily(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellFamily {
  if (platform !== "win32") return "native-bash";

  const shellPath = (env.SHELL ?? env.ComSpec ?? "").toLowerCase();
  const psModule = (env.PSModulePath ?? "").toLowerCase();
  const pathValue = env.PATH ?? "";

  const isWSL =
    (env.WSL_DISTRO_NAME !== undefined && env.WSL_DISTRO_NAME !== "") ||
    env.WSL_INTEROP !== undefined ||
    pathValue.includes("/mnt/c/");

  if (isWSL) return "wsl";
  if (env.MSYSTEM || env.MINGW_PREFIX) return "git-bash";
  if (shellPath.includes("powershell") || psModule.includes("powershell")) return "powershell";
  if (shellPath.includes("cmd.exe") || shellPath.endsWith("\\cmd")) return "cmd";
  return "unknown";
}

export function resolveCommandRoutingProfile(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): CommandRoutingProfile {
  const shell = detectShellFamily(platform, env);
  if (platform === "win32" && shell === "git-bash") {
    return {
      platform,
      shell,
      profileId: "windows-git-bash-cmd-node",
      preferCmdForNodeFamily: true,
      reason: "Windows + Git Bash frequently resolves bash without node/npm in PATH for tool subprocesses.",
    };
  }
  return {
    platform,
    shell,
    profileId: "default",
    preferCmdForNodeFamily: false,
    reason: "Default routing.",
  };
}

export function parseFirstCommandToken(command: string): string | undefined {
  const trimmed = String(command ?? "").trim();
  if (!trimmed) return undefined;
  const token = trimmed.split(/\s+/)[0] ?? "";
  return token.replace(/^['"]|['"]$/g, "").toLowerCase() || undefined;
}

export function isCmdWrappedCommand(command: string): boolean {
  return CMD_WRAPPER_PATTERN.test(String(command ?? ""));
}

export function isNodeFamilyCommand(command: string): boolean {
  const token = parseFirstCommandToken(command);
  if (!token) return false;
  if (NODE_FAMILY_TOKENS.has(token)) return true;
  if (token.endsWith("/vitest") || token.endsWith("/vitest.cmd") || token.endsWith("\\vitest.cmd")) {
    return true;
  }
  return false;
}

export function resolveBashCommandRoutingDecision(
  command: string,
  profile: CommandRoutingProfile,
): BashCommandRoutingDecision {
  if (!profile.preferCmdForNodeFamily) return { action: "allow" };
  if (isCmdWrappedCommand(command)) return { action: "allow" };
  if (!isNodeFamilyCommand(command)) return { action: "allow" };

  const firstToken = parseFirstCommandToken(command);
  return {
    action: "block",
    firstToken,
    reason: [
      "Blocked by guardrails-core (host-shell-routing): Windows+Git Bash node-family command must run via cmd.exe.",
      `Use: cmd.exe /c ${String(command ?? "").trim()}`,
    ].join("\n"),
  };
}

export function wrapCommandForHostShell(
  command: string,
  profile: CommandRoutingProfile,
): ShellRoutingWrapResult {
  const trimmed = String(command ?? "").trim();
  if (!trimmed) {
    return { changed: false, wrappedCommand: "", reason: "empty-command" };
  }
  if (!profile.preferCmdForNodeFamily) {
    return { changed: false, wrappedCommand: trimmed, reason: "route-not-required" };
  }
  if (isCmdWrappedCommand(trimmed)) {
    return { changed: false, wrappedCommand: trimmed, reason: "already-wrapped" };
  }
  if (!isNodeFamilyCommand(trimmed)) {
    return { changed: false, wrappedCommand: trimmed, reason: "non-node-family" };
  }
  return {
    changed: true,
    wrappedCommand: `cmd.exe /c ${trimmed}`,
    reason: "wrapped-for-windows-git-bash",
  };
}

export function buildShellRoutingStatusLines(profile: CommandRoutingProfile): string[] {
  const lines = [
    "shell-route status",
    `profile: ${profile.profileId}`,
    `platform: ${profile.platform}`,
    `shell: ${profile.shell}`,
    `preferCmdForNodeFamily: ${profile.preferCmdForNodeFamily ? "yes" : "no"}`,
    `reason: ${profile.reason}`,
  ];
  if (profile.preferCmdForNodeFamily) {
    lines.push("example: cmd.exe /c npm run test:smoke");
  }
  return lines;
}

export function buildShellRoutingSystemPrompt(profile: CommandRoutingProfile): string[] {
  if (!profile.preferCmdForNodeFamily) return [];
  return [
    "Host shell routing guard is active for this session.",
    "- Detected profile: windows-git-bash-cmd-node.",
    "- For node/npm/npx/pnpm/yarn/vitest in bash tool, wrap with: cmd.exe /c <command>.",
    "- Avoid bare node-family commands in bash for this host.",
  ];
}

export function buildShellRoutingStatusLabel(profile: CommandRoutingProfile): string | undefined {
  if (!profile.preferCmdForNodeFamily) return undefined;
  return "[shell] win+git-bash -> cmd.exe /c for node-family";
}
