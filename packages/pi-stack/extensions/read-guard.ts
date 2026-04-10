/**
 * read-guard — Prompts for confirmation before reading files outside the project.
 *
 * Adds an intentional friction layer for reads and bash commands that access
 * paths outside the current working directory. Sensitive paths (.ssh, .aws,
 * .gnupg, credentials) require explicit confirmation even in interactive mode
 * and are blocked outright in headless mode.
 *
 * Allowed without prompt:
 * - Any path inside cwd (the project)
 * - Pi config paths (~/.pi/, node_modules/@mariozechner/)
 * - Pi package paths (node_modules/ inside cwd)
 *
 * This is NOT a sandbox — extensions can bypass this via direct fs imports.
 * It protects against accidental or LLM-initiated reads of sensitive files.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolve, relative, sep } from "node:path";
import { homedir } from "node:os";

/** Paths that are always sensitive — require confirmation regardless */
const SENSITIVE_PATHS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".npmrc",
  ".docker",
  ".kube",
  ".azure",
  "id_rsa",
  "id_ed25519",
  "credentials",
  ".env",
  ".netrc",
  "token",
  "secret",
];

/** Paths that are allowed outside cwd — necessary for pi to function */
const ALLOWED_OUTSIDE = [
  ".pi",
  "node_modules/@mariozechner",
  "node_modules/@davidorex",
  "node_modules/@ifi",
  "node_modules/pi-lens",
  "node_modules/pi-web-access",
  "node_modules/mitsupi",
];

function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  return !rel.startsWith("..") && !rel.startsWith(sep);
}

function isSensitive(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  return SENSITIVE_PATHS.some((s) => lower.includes(s));
}

function isAllowedOutside(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  return ALLOWED_OUTSIDE.some((a) => lower.includes(a));
}

/**
 * Extract file paths from a bash command.
 * Basic heuristic — catches cat, less, head, tail, grep with file args.
 */
function extractPathsFromBash(command: string): string[] {
  const patterns = [
    /\bcat\s+["']?([^\s|>"';]+)/g,
    /\bless\s+["']?([^\s|>"';]+)/g,
    /\bhead\s+(?:-\d+\s+)?["']?([^\s|>"';]+)/g,
    /\btail\s+(?:-\d+\s+)?["']?([^\s|>"';]+)/g,
    /\bgrep\s+(?:-[a-zA-Z]+\s+)*["']?[^\s]+["']?\s+["']?([^\s|>"';]+)/g,
    /\bsed\s+(?:-[a-zA-Z]+\s+)*['"][^'"]*['"]\s+["']?([^\s|>"';]+)/g,
  ];

  const paths: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(command)) !== null) {
      if (match[1] && !match[1].startsWith("-")) {
        paths.push(match[1]);
      }
    }
  }
  return paths;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // Guard read tool
    if (event.toolName === "read") {
      const filePath = (event.input as { path?: string }).path ?? "";
      if (!filePath) return undefined;

      // Inside project — always allowed
      if (isInsideCwd(filePath, ctx.cwd)) return undefined;

      // Sensitive — block or confirm
      if (isSensitive(filePath)) {
        if (!ctx.hasUI) {
          return { block: true, reason: `Leitura bloqueada: path sensível (${filePath})` };
        }
        const ok = await ctx.ui.confirm(
          "⚠️ Path Sensível",
          `Leitura de arquivo sensível:\n${filePath}\n\nPermitir?`
        );
        if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
        return undefined;
      }

      // Allowed pi paths — no prompt needed
      if (isAllowedOutside(filePath)) return undefined;

      // Outside project, not sensitive, not pi — prompt
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          "Leitura fora do projeto",
          `O agente quer ler um arquivo fora do projeto:\n${filePath}\n\nPermitir?`
        );
        if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
      }
      return undefined;
    }

    // Guard bash tool — check for reads of sensitive files
    if (event.toolName === "bash") {
      const command = (event.input as { command?: string }).command ?? "";
      const paths = extractPathsFromBash(command);

      for (const filePath of paths) {
        if (isInsideCwd(filePath, ctx.cwd)) continue;
        if (isAllowedOutside(filePath)) continue;

        if (isSensitive(filePath)) {
          if (!ctx.hasUI) {
            return { block: true, reason: `Comando lê path sensível: ${filePath}` };
          }
          const ok = await ctx.ui.confirm(
            "⚠️ Comando lê path sensível",
            `O comando acessa arquivo sensível:\n${command}\n\nPath: ${filePath}\n\nPermitir?`
          );
          if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
        }
      }
    }

    return undefined;
  });
}
