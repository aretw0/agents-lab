/**
 * guardrails-core — Unified first-party guard extension.
 *
 * Consolidates:
 * - read path protection (former read-guard)
 * - deterministic scoped web routing enforcement (former web-routing-guard)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { resolve, relative, sep } from "node:path";

// =============================================================================
// Read / Path Guard
// =============================================================================

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

const ALLOWED_OUTSIDE = [
  ".pi",
  "node_modules/@mariozechner",
  "node_modules/@davidorex",
  "node_modules/@ifi",
  "node_modules/pi-lens",
  "node_modules/pi-web-access",
  "node_modules/mitsupi",
];

export function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  return !rel.startsWith("..") && !rel.startsWith(sep);
}

export function isSensitive(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  return SENSITIVE_PATHS.some((s) => lower.includes(s));
}

export function isAllowedOutside(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  return ALLOWED_OUTSIDE.some((a) => lower.includes(a));
}

/** Basic heuristic to extract file paths from bash read-like commands. */
export function extractPathsFromBash(command: string): string[] {
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

async function guardReadPath(filePath: string, ctx: ExtensionContext) {
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

async function guardBashPathReads(command: string, ctx: ExtensionContext) {
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

  return undefined;
}

// =============================================================================
// Deterministic Web Routing Guard
// =============================================================================

const INTERACTIVE_TERMS = [
  "open",
  "abrir",
  "abra",
  "navigate",
  "navegar",
  "navegue",
  "click",
  "clicar",
  "clique",
  "fill",
  "preencher",
  "preencha",
  "login",
  "log in",
  "submit",
  "enviar",
  "envie",
  "form",
  "formulário",
  "formulario",
  "tab",
  "button",
  "botão",
  "botao",
];

const SENSITIVE_DOMAINS = ["npmjs.com"];

const SENSITIVE_HINTS = ["cloudflare", "bot block", "bloqueio", "captcha", "challenge"];

const DISALLOWED_BASH_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /python(?:3)?\b[\s\S]*?requests/i,
  /r\.jina\.ai/i,
  /\bnpm\s+view\b/i,
  /registry\.npmjs\.org/i,
];

const CDP_SCRIPT_HINT =
  /web-browser[\/\\]scripts|scripts[\/\\](start|nav|eval|pick|screenshot|dismiss-cookies|watch|logs-tail|net-summary)\.js/i;

export interface RoutingDecision {
  interactive: boolean;
  sensitiveDomain: boolean;
  sensitiveHint: boolean;
  strictMode: boolean;
  domains: string[];
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractDomains(text: string): string[] {
  const lower = text.toLowerCase();
  const domains: string[] = [];

  const urlMatches = lower.match(/https?:\/\/[^\s)"']+/g) ?? [];
  for (const raw of urlMatches) {
    try {
      const host = new URL(raw).hostname.replace(/^www\./, "");
      if (host) domains.push(host);
    } catch {
      // ignore malformed URLs
    }
  }

  const domainLikeMatches = lower.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/g) ?? [];
  for (const d of domainLikeMatches) {
    domains.push(d.replace(/^www\./, ""));
  }

  return uniq(domains);
}

export function hasInteractiveIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return INTERACTIVE_TERMS.some((term) => lower.includes(term));
}

export function classifyRouting(prompt: string): RoutingDecision {
  const lower = prompt.toLowerCase();
  const domains = extractDomains(lower);

  const interactive = hasInteractiveIntent(lower);
  const sensitiveDomain = domains.some((d) => SENSITIVE_DOMAINS.some((sd) => d === sd || d.endsWith(`.${sd}`)));
  const sensitiveHint = SENSITIVE_HINTS.some((hint) => lower.includes(hint));

  return {
    interactive,
    sensitiveDomain,
    sensitiveHint,
    strictMode: interactive && (sensitiveDomain || sensitiveHint),
    domains,
  };
}

export function isDisallowedBash(command: string): boolean {
  const lower = command.toLowerCase();
  if (CDP_SCRIPT_HINT.test(lower)) return false;
  return DISALLOWED_BASH_PATTERNS.some((p) => p.test(lower));
}

// =============================================================================
// Extension Entry
// =============================================================================

export default function (pi: ExtensionAPI) {
  let strictInteractiveMode = false;

  pi.on("session_start", () => {
    strictInteractiveMode = false;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const decision = classifyRouting(event.prompt ?? "");
    strictInteractiveMode = decision.strictMode;

    if (!strictInteractiveMode) return undefined;

    const domains = decision.domains.length > 0 ? decision.domains.join(", ") : "(none)";
    ctx.ui?.setStatus?.("guardrails-core", "[guardrails] strict_interactive=on");
    ctx.ui?.notify?.(
      `guardrails-core: strict web mode ativo (interactive+sensitive). domains=${domains}`,
      "info"
    );

    const hardPrompt = [
      event.systemPrompt,
      "",
      "Scoped hard routing guard (deterministic) is active for this turn.",
      "- For this task, start with web-browser CDP scripts only.",
      "- Do not use curl/wget/python-requests/r.jina.ai/npm view/registry.npmjs.org as primary path.",
      "- If CDP path fails, explain failure explicitly before proposing fallback.",
    ].join("\n");

    return { systemPrompt: hardPrompt };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("read", event)) {
      return await guardReadPath(event.input.path ?? "", ctx);
    }

    if (isToolCallEventType("bash", event)) {
      const command = event.input.command ?? "";

      // Deterministic scoped web blocker
      if (strictInteractiveMode && isDisallowedBash(command)) {
        return {
          block: true,
          reason:
            "Blocked by guardrails-core (strict_interactive): use web-browser CDP scripts first for interactive sensitive-domain tasks.",
        };
      }

      // Sensitive path guard for bash reads
      return await guardBashPathReads(command, ctx);
    }

    return undefined;
  });

  pi.on("agent_end", (_event, ctx) => {
    if (!strictInteractiveMode) return;
    strictInteractiveMode = false;
    ctx.ui?.setStatus?.("guardrails-core", undefined);
  });
}
