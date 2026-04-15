/**
 * guardrails-core — Unified first-party guard extension.
 * @capability-id runtime-guardrails
 * @capability-criticality high
 *
 * Consolidates:
 * - read path protection (former read-guard)
 * - deterministic scoped web routing enforcement (former web-routing-guard)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { analyzeQuota, parseProviderBudgets, safeNum, type ProviderBudgetMap, type ProviderBudgetStatus } from "./quota-visibility";
import { parseBudgetOverrideReason } from "./colony-pilot";

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

export function extractExplicitPorts(command: string): number[] {
  const out = new Set<number>();
  const patterns = [
    /(?:--port|--http-port|--listen)\s+([0-9]{2,5})\b/gi,
    /(?:--port|--http-port|--listen)=([0-9]{2,5})\b/gi,
    /\bPORT\s*=\s*([0-9]{2,5})\b/gi,
    /\b-p\s+([0-9]{2,5})\b/gi,
  ];

  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(command)) !== null) {
      const n = Number.parseInt(m[1] ?? "", 10);
      if (!Number.isNaN(n)) out.add(n);
    }
  }

  return [...out];
}

export function looksLikeServerStartCommand(command: string): boolean {
  const lower = command.toLowerCase();
  const hints = [
    "npm run dev",
    "npm run start",
    "pnpm dev",
    "pnpm start",
    "yarn dev",
    "yarn start",
    "vite",
    "next dev",
    "http-server",
    "serve ",
    "python -m http.server",
    "uvicorn",
    "gunicorn",
    "docker run",
  ];
  return hints.some((h) => lower.includes(h));
}

export function readReservedSessionWebPort(cwd: string): number | undefined {
  try {
    const p = join(cwd, ".pi", "session-web-runtime.json");
    if (!existsSync(p)) return undefined;
    const json = JSON.parse(readFileSync(p, "utf8"));
    if (!json?.running) return undefined;
    const port = Number(json?.port);
    if (Number.isNaN(port) || port <= 0) return undefined;
    return port;
  } catch {
    return undefined;
  }
}

export function detectPortConflict(command: string, reservedPort?: number): number | undefined {
  if (!reservedPort) return undefined;
  if (!looksLikeServerStartCommand(command)) return undefined;
  const ports = extractExplicitPorts(command);
  return ports.includes(reservedPort) ? reservedPort : undefined;
}

interface GuardrailsPortConflictConfig {
  enabled: boolean;
  suggestedTestPort: number;
}

function resolveGuardrailsPortConflictConfig(cwd: string): GuardrailsPortConflictConfig {
  const defaults: GuardrailsPortConflictConfig = { enabled: true, suggestedTestPort: 4173 };
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return defaults;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.portConflict
      ?? json?.extensions?.guardrailsCore?.portConflict
      ?? {};
    const enabled = cfg?.enabled !== false;
    const suggested = Number(cfg?.suggestedTestPort);
    return {
      enabled,
      suggestedTestPort: Number.isNaN(suggested) || suggested <= 0 ? defaults.suggestedTestPort : suggested,
    };
  } catch {
    return defaults;
  }
}

interface ProviderBudgetGovernorConfig {
  enabled: boolean;
  lookbackDays: number;
  allowOverride: boolean;
  overrideToken: string;
  recoveryCommands: string[];
}

interface ProviderBudgetGovernorSnapshot {
  atIso: string;
  budgets: ProviderBudgetStatus[];
}

function normalizeCmdName(text: string): string {
  const t = text.trim();
  if (!t.startsWith("/")) return "";
  const name = t.slice(1).split(/\s+/)[0] ?? "";
  return name.toLowerCase();
}

function readQuotaBudgetSettings(cwd: string): {
  weeklyQuotaTokens?: number;
  weeklyQuotaCostUsd?: number;
  weeklyQuotaRequests?: number;
  monthlyQuotaTokens?: number;
  monthlyQuotaCostUsd?: number;
  monthlyQuotaRequests?: number;
  providerBudgets: ProviderBudgetMap;
} {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return { providerBudgets: {} };
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.quotaVisibility ?? {};
    return {
      weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
      weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
      weeklyQuotaRequests: safeNum(cfg.weeklyQuotaRequests) || undefined,
      monthlyQuotaTokens: safeNum(cfg.monthlyQuotaTokens) || undefined,
      monthlyQuotaCostUsd: safeNum(cfg.monthlyQuotaCostUsd) || undefined,
      monthlyQuotaRequests: safeNum(cfg.monthlyQuotaRequests) || undefined,
      providerBudgets: parseProviderBudgets(cfg.providerBudgets),
    };
  } catch {
    return { providerBudgets: {} };
  }
}

function resolveProviderBudgetGovernorConfig(cwd: string): ProviderBudgetGovernorConfig {
  const defaults: ProviderBudgetGovernorConfig = {
    enabled: false,
    lookbackDays: 30,
    allowOverride: true,
    overrideToken: "budget-override:",
    recoveryCommands: ["doctor", "quota-visibility", "model", "login"],
  };

  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return defaults;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.providerBudgetGovernor ?? {};
    const lookback = Number.isFinite(Number(cfg.lookbackDays)) ? Math.floor(Number(cfg.lookbackDays)) : defaults.lookbackDays;
    const recoveryCommands = Array.isArray(cfg.recoveryCommands)
      ? cfg.recoveryCommands
        .filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x: string) => x.trim().toLowerCase())
      : defaults.recoveryCommands;

    return {
      enabled: cfg?.enabled === true,
      lookbackDays: Math.max(1, Math.min(90, lookback)),
      allowOverride: cfg?.allowOverride !== false,
      overrideToken: typeof cfg?.overrideToken === "string" && cfg.overrideToken.trim().length > 0 ? cfg.overrideToken.trim() : defaults.overrideToken,
      recoveryCommands,
    };
  } catch {
    return defaults;
  }
}

// =============================================================================
// Extension Entry
// =============================================================================

export default function (pi: ExtensionAPI) {
  let strictInteractiveMode = false;
  let portConflictConfig: GuardrailsPortConflictConfig = { enabled: true, suggestedTestPort: 4173 };
  let providerBudgetGovernorConfig: ProviderBudgetGovernorConfig = {
    enabled: false,
    lookbackDays: 30,
    allowOverride: true,
    overrideToken: "budget-override:",
    recoveryCommands: ["doctor", "quota-visibility", "model", "login"],
  };
  let providerBudgetSnapshotCache: { at: number; key: string; snapshot: ProviderBudgetGovernorSnapshot } | undefined;

  async function resolveProviderBudgetSnapshot(ctx: ExtensionContext): Promise<ProviderBudgetGovernorSnapshot | undefined> {
    const quota = readQuotaBudgetSettings(ctx.cwd);
    if (Object.keys(quota.providerBudgets).length === 0) return undefined;

    const key = JSON.stringify({
      lookbackDays: providerBudgetGovernorConfig.lookbackDays,
      quota,
    });

    if (providerBudgetSnapshotCache && providerBudgetSnapshotCache.key === key && Date.now() - providerBudgetSnapshotCache.at < 60_000) {
      return providerBudgetSnapshotCache.snapshot;
    }

    const status = await analyzeQuota({
      days: providerBudgetGovernorConfig.lookbackDays,
      weeklyQuotaTokens: quota.weeklyQuotaTokens,
      weeklyQuotaCostUsd: quota.weeklyQuotaCostUsd,
      weeklyQuotaRequests: quota.weeklyQuotaRequests,
      monthlyQuotaTokens: quota.monthlyQuotaTokens,
      monthlyQuotaCostUsd: quota.monthlyQuotaCostUsd,
      monthlyQuotaRequests: quota.monthlyQuotaRequests,
      providerWindowHours: {},
      providerBudgets: quota.providerBudgets,
    });

    const snapshot: ProviderBudgetGovernorSnapshot = {
      atIso: status.source.generatedAtIso,
      budgets: status.providerBudgets,
    };
    providerBudgetSnapshotCache = { at: Date.now(), key, snapshot };
    return snapshot;
  }

  pi.on("session_start", (_event, ctx) => {
    strictInteractiveMode = false;
    portConflictConfig = resolveGuardrailsPortConflictConfig(ctx.cwd);
    providerBudgetGovernorConfig = resolveProviderBudgetGovernorConfig(ctx.cwd);
    providerBudgetSnapshotCache = undefined;
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

  pi.on("input", async (event, ctx) => {
    if (!providerBudgetGovernorConfig.enabled) return { action: "continue" as const };

    const cmd = normalizeCmdName(event.text ?? "");
    if (cmd && providerBudgetGovernorConfig.recoveryCommands.includes(cmd)) {
      return { action: "continue" as const };
    }

    const currentProvider = ctx.model?.provider;
    if (!currentProvider) return { action: "continue" as const };

    const snapshot = await resolveProviderBudgetSnapshot(ctx);
    const blocked = snapshot?.budgets.find((b) => b.provider === currentProvider && b.state === "blocked");
    if (!blocked) return { action: "continue" as const };

    if (providerBudgetGovernorConfig.allowOverride) {
      const reason = parseBudgetOverrideReason(event.text ?? "", providerBudgetGovernorConfig.overrideToken);
      if (reason) {
        ctx.appendEntry("guardrails-core.provider-budget-override", {
          atIso: new Date().toISOString(),
          provider: currentProvider,
          reason,
          snapshotAtIso: snapshot?.atIso,
        });
        ctx.ui.notify(`provider-budget override aceito para ${currentProvider}: ${reason}`, "warning");
        return { action: "continue" as const };
      }
    }

    ctx.appendEntry("guardrails-core.provider-budget-block", {
      atIso: new Date().toISOString(),
      provider: currentProvider,
      snapshotAtIso: snapshot?.atIso,
    });

    ctx.ui.notify(
      [
        `Bloqueado por provider-budget governor: ${currentProvider} está em BLOCK.`,
        `Use /quota-visibility budget ${currentProvider} ${providerBudgetGovernorConfig.lookbackDays}`,
        `Comandos de recovery permitidos: ${providerBudgetGovernorConfig.recoveryCommands.map((x) => `/${x}`).join(", ")}`,
        providerBudgetGovernorConfig.allowOverride
          ? `Override auditável: inclua '${providerBudgetGovernorConfig.overrideToken}<motivo>' na mensagem.`
          : "Override desativado pela policy.",
      ].join("\n"),
      "warning"
    );
    return { action: "handled" as const };
  });

  pi.on("before_provider_request", async (_event, ctx) => {
    if (!providerBudgetGovernorConfig.enabled) return undefined;
    const currentProvider = ctx.model?.provider;
    if (!currentProvider) return undefined;
    const snapshot = await resolveProviderBudgetSnapshot(ctx);
    const blocked = snapshot?.budgets.find((b) => b.provider === currentProvider && b.state === "blocked");
    if (blocked) {
      ctx.ui?.setStatus?.("guardrails-core-budget", `[budget] ${currentProvider}=BLOCK`);
    } else {
      ctx.ui?.setStatus?.("guardrails-core-budget", undefined);
    }
    return undefined;
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

      // Session web port conflict guard
      const reservedPort = readReservedSessionWebPort(ctx.cwd);
      const conflictPort = portConflictConfig.enabled
        ? detectPortConflict(command, reservedPort)
        : undefined;
      if (conflictPort) {
        return {
          block: true,
          reason: `Blocked by guardrails-core (port_conflict): port ${conflictPort} is reserved by session-web. Try --port ${portConflictConfig.suggestedTestPort}.`,
        };
      }

      // Sensitive path guard for bash reads
      return await guardBashPathReads(command, ctx);
    }

    return undefined;
  });

  pi.on("agent_end", (_event, ctx) => {
    if (strictInteractiveMode) {
      strictInteractiveMode = false;
      ctx.ui?.setStatus?.("guardrails-core", undefined);
    }
    ctx.ui?.setStatus?.("guardrails-core-budget", undefined);
  });
}
