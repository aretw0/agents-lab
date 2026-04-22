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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { analyzeQuota, parseProviderBudgets, safeNum, type ProviderBudgetMap, type ProviderBudgetStatus } from "./quota-visibility";
import { parseBudgetOverrideReason } from "./colony-pilot";
import { matchesWhen, toPolicyFacts } from "./policy-primitive";

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

const SESSION_LOG_PATH_PATTERN = /(^|[^\w.-])\.pi\/agent\/sessions(\/|$)/i;
const SESSION_LOG_CONTENT_SCAN_PATTERN = /\b(?:grep|rg|findstr|awk|sed|cat|tail|head|more|less)\b/i;
const SESSION_LOG_FILENAME_ONLY_PATTERN =
  /\b(?:grep|rg)\b[\s\S]*\b(?:--files-with-matches|--files-without-match)\b|\b(?:grep|rg)\b[\s\S]*\s-[a-z]*l[a-z]*\b/i;
const SESSION_LOG_COUNT_ONLY_PATTERN =
  /\|\s*wc\s+-l\b|\b(?:grep|rg)\b[\s\S]*\b--count\b|\b(?:grep|rg)\b[\s\S]*\s-[a-z]*c[a-z]*\b/i;
const PI_ROOT_PATH_PATTERN =
  /(^|\s)(?:\.\/)?\.pi(?=\s|$|[|;&])|(^|\s)~\/\.pi(?=\s|$|[|;&])|(^|\s)[a-z]:\/users\/[^/\s]+\/\.pi(?=\s|$|[|;&])|(^|\s)\/mnt\/[a-z]\/users\/[^/\s]+\/\.pi(?=\s|$|[|;&])/i;
const PI_ROOT_RECURSIVE_SCAN_TOOL_PATTERN =
  /\brg\b|\bgrep\b[\s\S]*\b--recursive\b|\bgrep\b[\s\S]*\s-[a-z]*r[a-z]*\b|\bfindstr\b[\s\S]*\s\/s\b/i;

export function detectHighRiskSessionLogScan(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\\/g, "/");
  if (!SESSION_LOG_PATH_PATTERN.test(normalized)) return false;
  if (!SESSION_LOG_CONTENT_SCAN_PATTERN.test(normalized)) return false;
  if (SESSION_LOG_FILENAME_ONLY_PATTERN.test(normalized)) return false;
  if (SESSION_LOG_COUNT_ONLY_PATTERN.test(normalized)) return false;
  return true;
}

export function highRiskSessionLogScanReason(): string {
  return [
    "Blocked by guardrails-core (session_log_scan): command scans ~/.pi/agent/sessions with content-reading tools and can emit giant JSONL lines.",
    "Use session_analytics_query / quota_visibility_* tools or read with offset/limit instead.",
  ].join(" ");
}

export function detectHighRiskPiRootRecursiveScan(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\\/g, "/");
  if (!PI_ROOT_PATH_PATTERN.test(normalized)) return false;
  if (!PI_ROOT_RECURSIVE_SCAN_TOOL_PATTERN.test(normalized)) return false;
  if (SESSION_LOG_FILENAME_ONLY_PATTERN.test(normalized)) return false;
  if (SESSION_LOG_COUNT_ONLY_PATTERN.test(normalized)) return false;
  return true;
}

export function highRiskPiRootRecursiveScanReason(): string {
  return [
    "Blocked by guardrails-core (pi_root_recursive_scan): recursive content scan over .pi can explode output/context.",
    "Use filename/count-only search first, then read specific files with offset/limit.",
  ].join(" ");
}

type BashGuardPolicy = {
  id: string;
  when: string;
  detect: (command: string) => boolean;
  reason: () => string;
  auditKey: string;
};

const BASH_GUARD_POLICIES: BashGuardPolicy[] = [
  {
    id: "pi-root-recursive-scan",
    when: "tool(bash)",
    detect: detectHighRiskPiRootRecursiveScan,
    reason: highRiskPiRootRecursiveScanReason,
    auditKey: "guardrails-core.pi-root-recursive-scan-block",
  },
  {
    id: "session-log-scan",
    when: "tool(bash)",
    detect: detectHighRiskSessionLogScan,
    reason: highRiskSessionLogScanReason,
    auditKey: "guardrails-core.session-log-scan-block",
  },
];

function shouldApplyBashGuardPolicy(policy: BashGuardPolicy): boolean {
  return matchesWhen(
    policy.when,
    toPolicyFacts({
      hasBash: true,
      toolCalls: 1,
      hasFileWrites: false,
      calledTools: new Set(["bash"]),
    }),
    0,
  );
}

function evaluateBashGuardPolicies(command: string): BashGuardPolicy | undefined {
  for (const policy of BASH_GUARD_POLICIES) {
    if (!shouldApplyBashGuardPolicy(policy)) continue;
    if (policy.detect(command)) return policy;
  }
  return undefined;
}

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

function appendAuditEntry(ctx: ExtensionContext, key: string, value: Record<string, unknown>): void {
  const maybeAppend = (ctx as unknown as { appendEntry?: (k: string, v: Record<string, unknown>) => void }).appendEntry;
  if (typeof maybeAppend === "function") {
    maybeAppend(key, value);
  }
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

export type ProviderBudgetGovernorMisconfig = "missing-provider-budgets";

export function detectProviderBudgetGovernorMisconfig(
  enabled: boolean,
  providerBudgets: ProviderBudgetMap,
): ProviderBudgetGovernorMisconfig | undefined {
  if (!enabled) return undefined;
  if (Object.keys(providerBudgets).length === 0) return "missing-provider-budgets";
  return undefined;
}

export function providerBudgetGovernorMisconfigReason(
  issue: ProviderBudgetGovernorMisconfig,
): string {
  if (issue === "missing-provider-budgets") {
    return [
      "guardrails-core: providerBudgetGovernor habilitado sem quotaVisibility.providerBudgets.",
      "BLOCK por provider não será aplicado até configurar budgets em .pi/settings.json.",
    ].join(" ");
  }
  return "guardrails-core: providerBudgetGovernor misconfigured.";
}

interface PragmaticAutonomyConfig {
  enabled: boolean;
  noObviousQuestions: boolean;
  auditAssumptions: boolean;
  maxAuditTextChars: number;
}

const DEFAULT_PRAGMATIC_AUTONOMY_CONFIG: PragmaticAutonomyConfig = {
  enabled: true,
  noObviousQuestions: true,
  auditAssumptions: true,
  maxAuditTextChars: 140,
};

export function resolvePragmaticAutonomyConfig(cwd: string): PragmaticAutonomyConfig {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return DEFAULT_PRAGMATIC_AUTONOMY_CONFIG;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.pragmaticAutonomy ?? {};
    const maxAuditTextCharsRaw = Number(cfg?.maxAuditTextChars);
    return {
      enabled: cfg?.enabled !== false,
      noObviousQuestions: cfg?.noObviousQuestions !== false,
      auditAssumptions: cfg?.auditAssumptions !== false,
      maxAuditTextChars: Number.isFinite(maxAuditTextCharsRaw) && maxAuditTextCharsRaw > 0
        ? Math.max(40, Math.min(400, Math.floor(maxAuditTextCharsRaw)))
        : DEFAULT_PRAGMATIC_AUTONOMY_CONFIG.maxAuditTextChars,
    };
  } catch {
    return DEFAULT_PRAGMATIC_AUTONOMY_CONFIG;
  }
}

export function buildPragmaticAutonomySystemPrompt(
  cfg: Pick<PragmaticAutonomyConfig, "enabled" | "noObviousQuestions">,
): string | undefined {
  if (!cfg.enabled || !cfg.noObviousQuestions) return undefined;
  return [
    "Pragmatic autonomy policy is active for this turn.",
    "- Resolve low-risk ambiguities using deterministic safe defaults.",
    "- Do not ask obvious/format/order questions when progress can continue safely.",
    "- Escalate to user only for irreversible actions, data-loss risk, security risk, or explicit objective conflict.",
    "- Keep automatic assumptions auditable through concise notes/audit entries.",
  ].join("\n");
}

export function summarizeAssumptionText(text: string, maxChars: number): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  const max = Math.max(20, Math.floor(maxChars));
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

interface LongRunIntentQueueConfig {
  enabled: boolean;
  requireActiveLongRun: boolean;
  maxItems: number;
  forceNowPrefix: string;
  autoDrainOnIdle: boolean;
  autoDrainCooldownMs: number;
  autoDrainBatchSize: number;
  autoDrainIdleStableMs: number;
}

interface DeferredIntentItem {
  id: string;
  atIso: string;
  text: string;
  source: string;
}

interface DeferredIntentQueueStore {
  version: number;
  items: DeferredIntentItem[];
}

const DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG: LongRunIntentQueueConfig = {
  enabled: true,
  requireActiveLongRun: true,
  maxItems: 50,
  forceNowPrefix: "lane-now:",
  autoDrainOnIdle: true,
  autoDrainCooldownMs: 3000,
  autoDrainBatchSize: 1,
  autoDrainIdleStableMs: 1500,
};
function deferredIntentQueuePath(cwd: string): string {
  return join(cwd, ".pi", "deferred-intents.json");
}

function readDeferredIntentQueue(cwd: string): DeferredIntentQueueStore {
  const p = deferredIntentQueuePath(cwd);
  if (!existsSync(p)) return { version: 1, items: [] };
  try {
    const json = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(json?.items)) return { version: 1, items: [] };
    const items = json.items
      .filter((item: unknown): item is DeferredIntentItem => {
        const row = item as DeferredIntentItem;
        return Boolean(row?.id && typeof row?.text === "string" && row.text.trim().length > 0);
      })
      .map((row: DeferredIntentItem) => ({
        id: row.id,
        atIso: typeof row.atIso === "string" && row.atIso ? row.atIso : new Date().toISOString(),
        text: row.text,
        source: typeof row.source === "string" ? row.source : "interactive",
      }));
    return { version: 1, items };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeDeferredIntentQueue(cwd: string, store: DeferredIntentQueueStore): string {
  const p = deferredIntentQueuePath(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(p, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return p;
}

export function resolveLongRunIntentQueueConfig(cwd: string): LongRunIntentQueueConfig {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.longRunIntentQueue ?? {};
    const maxItemsRaw = Number(cfg?.maxItems);
    const autoDrainCooldownMsRaw = Number(cfg?.autoDrainCooldownMs);
    const autoDrainBatchSizeRaw = Number(cfg?.autoDrainBatchSize);
    const autoDrainIdleStableMsRaw = Number(cfg?.autoDrainIdleStableMs);
    return {
      enabled: cfg?.enabled !== false,
      requireActiveLongRun: cfg?.requireActiveLongRun !== false,
      maxItems: Number.isFinite(maxItemsRaw) && maxItemsRaw > 0
        ? Math.max(1, Math.min(500, Math.floor(maxItemsRaw)))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.maxItems,
      forceNowPrefix: typeof cfg?.forceNowPrefix === "string" && cfg.forceNowPrefix.trim().length > 0
        ? cfg.forceNowPrefix.trim().toLowerCase()
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.forceNowPrefix,
      autoDrainOnIdle: cfg?.autoDrainOnIdle !== false,
      autoDrainCooldownMs: Number.isFinite(autoDrainCooldownMsRaw) && autoDrainCooldownMsRaw >= 0
        ? Math.max(0, Math.floor(autoDrainCooldownMsRaw))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.autoDrainCooldownMs,
      autoDrainBatchSize: Number.isFinite(autoDrainBatchSizeRaw) && autoDrainBatchSizeRaw > 0
        ? Math.max(1, Math.min(10, Math.floor(autoDrainBatchSizeRaw)))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.autoDrainBatchSize,
      autoDrainIdleStableMs: Number.isFinite(autoDrainIdleStableMsRaw) && autoDrainIdleStableMsRaw >= 0
        ? Math.max(0, Math.floor(autoDrainIdleStableMsRaw))
        : DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG.autoDrainIdleStableMs,
    };
  } catch {
    return DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG;
  }
}

export function shouldQueueInputForLongRun(
  text: string,
  activeLongRun: boolean,
  cfg: LongRunIntentQueueConfig,
): boolean {
  if (!cfg.enabled) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase().startsWith(cfg.forceNowPrefix)) return false;
  if (trimmed.startsWith("/")) return false;
  if (cfg.requireActiveLongRun && !activeLongRun) return false;
  return true;
}

export function parseLaneQueueAddText(args: string): string | undefined {
  const trimmed = String(args ?? "").trim();
  if (!/^add(\s+|$)/i.test(trimmed)) return undefined;
  const text = trimmed.replace(/^add\b/i, "").trim();
  return text.length > 0 ? text : undefined;
}

export type AutoDrainGateReason =
  | "disabled"
  | "empty"
  | "active-long-run"
  | "cooldown"
  | "idle-stability"
  | "ready";

export function resolveAutoDrainGateReason(
  activeLongRun: boolean,
  queuedCount: number,
  nowMs: number,
  lastAutoDrainAt: number,
  idleSinceMs: number,
  cfg: LongRunIntentQueueConfig,
): AutoDrainGateReason {
  if (!cfg.enabled || !cfg.autoDrainOnIdle) return "disabled";
  if (queuedCount <= 0) return "empty";
  if (activeLongRun) return "active-long-run";
  const cooldownRemaining = Math.max(0, cfg.autoDrainCooldownMs - (nowMs - lastAutoDrainAt));
  const idleRemaining = Math.max(0, cfg.autoDrainIdleStableMs - idleSinceMs);
  if (cooldownRemaining > 0 || idleRemaining > 0) {
    return cooldownRemaining >= idleRemaining ? "cooldown" : "idle-stability";
  }
  return "ready";
}

export function estimateAutoDrainWaitMs(
  activeLongRun: boolean,
  queuedCount: number,
  nowMs: number,
  lastAutoDrainAt: number,
  idleSinceMs: number,
  cfg: LongRunIntentQueueConfig,
): number | undefined {
  const gate = resolveAutoDrainGateReason(
    activeLongRun,
    queuedCount,
    nowMs,
    lastAutoDrainAt,
    idleSinceMs,
    cfg,
  );
  if (gate !== "cooldown" && gate !== "idle-stability" && gate !== "ready") return undefined;
  const cooldownRemaining = Math.max(0, cfg.autoDrainCooldownMs - (nowMs - lastAutoDrainAt));
  const idleRemaining = Math.max(0, cfg.autoDrainIdleStableMs - idleSinceMs);
  return Math.max(cooldownRemaining, idleRemaining);
}

export function shouldAutoDrainDeferredIntent(
  activeLongRun: boolean,
  queuedCount: number,
  nowMs: number,
  lastAutoDrainAt: number,
  idleSinceMs: number,
  cfg: LongRunIntentQueueConfig,
): boolean {
  const waitMs = estimateAutoDrainWaitMs(
    activeLongRun,
    queuedCount,
    nowMs,
    lastAutoDrainAt,
    idleSinceMs,
    cfg,
  );
  return waitMs !== undefined && waitMs === 0;
}

export function resolveAutoDrainRetryDelayMs(
  activeLongRun: boolean,
  queuedCount: number,
  nowMs: number,
  lastAutoDrainAt: number,
  idleSinceMs: number,
  cfg: LongRunIntentQueueConfig,
): number | undefined {
  const gate = resolveAutoDrainGateReason(
    activeLongRun,
    queuedCount,
    nowMs,
    lastAutoDrainAt,
    idleSinceMs,
    cfg,
  );
  if (gate === "active-long-run") {
    // Keep lane-queue complementary to native follow-up semantics:
    // if native follow-up is still draining (pending messages), retry later
    // instead of giving up auto-drain entirely.
    return Math.max(250, cfg.autoDrainIdleStableMs);
  }
  if (gate !== "cooldown" && gate !== "idle-stability") return undefined;
  const waitMs = estimateAutoDrainWaitMs(
    activeLongRun,
    queuedCount,
    nowMs,
    lastAutoDrainAt,
    idleSinceMs,
    cfg,
  );
  if (waitMs === undefined || waitMs <= 0) return undefined;
  return waitMs;
}

export function enqueueDeferredIntent(
  cwd: string,
  text: string,
  source: string,
  maxItems: number,
): { queuePath: string; queuedCount: number; itemId: string } {
  const queue = readDeferredIntentQueue(cwd);
  const item: DeferredIntentItem = {
    id: `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    atIso: new Date().toISOString(),
    text: text.trim(),
    source,
  };
  queue.items.push(item);
  if (queue.items.length > maxItems) {
    queue.items = queue.items.slice(-maxItems);
  }
  const queuePath = writeDeferredIntentQueue(cwd, queue);
  return {
    queuePath,
    queuedCount: queue.items.length,
    itemId: item.id,
  };
}

export function dequeueDeferredIntent(
  cwd: string,
): { queuePath: string; queuedCount: number; item?: DeferredIntentItem } {
  const queue = readDeferredIntentQueue(cwd);
  const item = queue.items.shift();
  const queuePath = writeDeferredIntentQueue(cwd, queue);
  return {
    queuePath,
    queuedCount: queue.items.length,
    item,
  };
}

export function clearDeferredIntentQueue(cwd: string): { queuePath: string; cleared: number } {
  const queue = readDeferredIntentQueue(cwd);
  const cleared = queue.items.length;
  const queuePath = writeDeferredIntentQueue(cwd, { version: 1, items: [] });
  return { queuePath, cleared };
}

export function listDeferredIntents(cwd: string): DeferredIntentItem[] {
  return readDeferredIntentQueue(cwd).items;
}

export function oldestDeferredIntentAgeMs(items: DeferredIntentItem[], nowMs = Date.now()): number | undefined {
  let maxAge = -1;
  for (const item of items) {
    const ts = Date.parse(item.atIso);
    if (!Number.isFinite(ts)) continue;
    const age = Math.max(0, nowMs - ts);
    if (age > maxAge) maxAge = age;
  }
  return maxAge >= 0 ? maxAge : undefined;
}

function getDeferredIntentQueueCount(cwd: string): number {
  return readDeferredIntentQueue(cwd).items.length;
}

function updateLongRunLaneStatus(ctx: ExtensionContext, activeLongRun: boolean): void {
  const queued = getDeferredIntentQueueCount(ctx.cwd);
  if (queued <= 0 && !activeLongRun) {
    ctx.ui?.setStatus?.("guardrails-core-lane", undefined);
    return;
  }
  const lane = activeLongRun ? "active" : "idle";
  ctx.ui?.setStatus?.("guardrails-core-lane", `[lane] ${lane} queued=${queued}`);
}

export function shouldAnnounceStrictInteractiveMode(
  alreadyAnnounced: boolean,
  strictMode: boolean,
): boolean {
  return strictMode && !alreadyAnnounced;
}

// =============================================================================
// Extension Entry
// =============================================================================

export default function (pi: ExtensionAPI) {
  let strictInteractiveMode = false;
  let strictInteractiveAnnounced = false;
  let portConflictConfig: GuardrailsPortConflictConfig = { enabled: true, suggestedTestPort: 4173 };
  let providerBudgetGovernorConfig: ProviderBudgetGovernorConfig = {
    enabled: false,
    lookbackDays: 30,
    allowOverride: true,
    overrideToken: "budget-override:",
    recoveryCommands: ["doctor", "quota-visibility", "model", "login"],
  };
  let providerBudgetSnapshotCache: { at: number; key: string; snapshot: ProviderBudgetGovernorSnapshot } | undefined;
  let providerBudgetGovernorMisconfig: ProviderBudgetGovernorMisconfig | undefined;
  let longRunIntentQueueConfig: LongRunIntentQueueConfig = DEFAULT_LONG_RUN_INTENT_QUEUE_CONFIG;
  let pragmaticAutonomyConfig: PragmaticAutonomyConfig = DEFAULT_PRAGMATIC_AUTONOMY_CONFIG;
  let lastAutoDrainAt = 0;
  let lastLongRunBusyAt = Date.now();
  let autoDrainTimer: NodeJS.Timeout | undefined;

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

  function clearAutoDrainTimer(): void {
    if (!autoDrainTimer) return;
    clearTimeout(autoDrainTimer);
    autoDrainTimer = undefined;
  }

  function scheduleAutoDrainDeferredIntent(
    ctx: ExtensionContext,
    reason: "agent_end" | "lane_pop" | "idle_timer",
    delayOverrideMs?: number,
  ): void {
    if (!longRunIntentQueueConfig.enabled || !longRunIntentQueueConfig.autoDrainOnIdle) return;
    clearAutoDrainTimer();
    const delay = delayOverrideMs !== undefined
      ? Math.max(0, Math.floor(delayOverrideMs))
      : Math.max(0, longRunIntentQueueConfig.autoDrainIdleStableMs);
    autoDrainTimer = setTimeout(() => {
      autoDrainTimer = undefined;
      tryAutoDrainDeferredIntent(ctx, reason);
    }, delay);
  }

  function tryAutoDrainDeferredIntent(ctx: ExtensionContext, reason: "agent_end" | "lane_pop" | "idle_timer"): boolean {
    const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
    const queuedCount = getDeferredIntentQueueCount(ctx.cwd);
    const nowMs = Date.now();
    const idleSinceMs = Math.max(0, nowMs - lastLongRunBusyAt);

    const gate = resolveAutoDrainGateReason(
      activeLongRun,
      queuedCount,
      nowMs,
      lastAutoDrainAt,
      idleSinceMs,
      longRunIntentQueueConfig,
    );
    const retryDelayMs = resolveAutoDrainRetryDelayMs(
      activeLongRun,
      queuedCount,
      nowMs,
      lastAutoDrainAt,
      idleSinceMs,
      longRunIntentQueueConfig,
    );
    if (retryDelayMs !== undefined) {
      scheduleAutoDrainDeferredIntent(ctx, "idle_timer", retryDelayMs);
      appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-drain-deferred", {
        atIso: new Date().toISOString(),
        reason,
        gate,
        queuedCount,
        retryDelayMs,
      });
      updateLongRunLaneStatus(ctx, activeLongRun);
      return false;
    }

    if (!shouldAutoDrainDeferredIntent(activeLongRun, queuedCount, nowMs, lastAutoDrainAt, idleSinceMs, longRunIntentQueueConfig)) {
      updateLongRunLaneStatus(ctx, activeLongRun);
      return false;
    }

    const maxBatch = Math.max(1, longRunIntentQueueConfig.autoDrainBatchSize);
    let dispatched = 0;

    while (dispatched < maxBatch) {
      const popped = dequeueDeferredIntent(ctx.cwd);
      if (!popped.item) break;

      appendAuditEntry(ctx, "guardrails-core.long-run-intent-auto-pop", {
        atIso: new Date().toISOString(),
        itemId: popped.item.id,
        reason,
        queuedCount: popped.queuedCount,
        batchIndex: dispatched + 1,
        batchSize: maxBatch,
      });

      pi.sendUserMessage(popped.item.text, { deliverAs: "followUp" });
      dispatched += 1;

      if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        break;
      }
    }

    if (dispatched <= 0) {
      updateLongRunLaneStatus(ctx, activeLongRun);
      return false;
    }

    lastAutoDrainAt = nowMs;
    updateLongRunLaneStatus(ctx, false);
    ctx.ui.notify(`lane-queue: auto-dispatch ${dispatched} item(s)`, "info");
    return true;
  }

  pi.on("session_start", (_event, ctx) => {
    strictInteractiveMode = false;
    strictInteractiveAnnounced = false;
    portConflictConfig = resolveGuardrailsPortConflictConfig(ctx.cwd);
    providerBudgetGovernorConfig = resolveProviderBudgetGovernorConfig(ctx.cwd);
    const quotaSettings = readQuotaBudgetSettings(ctx.cwd);
    providerBudgetGovernorMisconfig = detectProviderBudgetGovernorMisconfig(
      providerBudgetGovernorConfig.enabled,
      quotaSettings.providerBudgets,
    );
    longRunIntentQueueConfig = resolveLongRunIntentQueueConfig(ctx.cwd);
    pragmaticAutonomyConfig = resolvePragmaticAutonomyConfig(ctx.cwd);
    if (providerBudgetGovernorMisconfig) {
      ctx.ui?.notify?.(
        providerBudgetGovernorMisconfigReason(providerBudgetGovernorMisconfig),
        "warning",
      );
      ctx.ui?.setStatus?.("guardrails-core-budget", "[budget] governor-misconfig");
    }
    providerBudgetSnapshotCache = undefined;
    lastAutoDrainAt = 0;
    lastLongRunBusyAt = Date.now();
    clearAutoDrainTimer();
    updateLongRunLaneStatus(ctx, false);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    lastLongRunBusyAt = Date.now();
    clearAutoDrainTimer();
    const decision = classifyRouting(event.prompt ?? "");
    strictInteractiveMode = decision.strictMode;

    const systemPromptParts: string[] = [event.systemPrompt ?? ""];
    const autonomyPrompt = buildPragmaticAutonomySystemPrompt(pragmaticAutonomyConfig);
    if (autonomyPrompt) {
      systemPromptParts.push("", autonomyPrompt);
      if (pragmaticAutonomyConfig.auditAssumptions) {
        appendAuditEntry(ctx, "guardrails-core.pragmatic-autonomy-policy", {
          atIso: new Date().toISOString(),
          noObviousQuestions: pragmaticAutonomyConfig.noObviousQuestions,
          strictInteractiveMode,
        });
      }
    }

    if (!strictInteractiveMode) {
      ctx.ui?.setStatus?.("guardrails-core", undefined);
      if (!autonomyPrompt) return undefined;
      return { systemPrompt: systemPromptParts.join("\n") };
    }

    const domains = decision.domains.length > 0 ? decision.domains.join(", ") : "(none)";
    ctx.ui?.setStatus?.("guardrails-core", "[guardrails] strict_interactive=on");
    if (shouldAnnounceStrictInteractiveMode(strictInteractiveAnnounced, strictInteractiveMode)) {
      strictInteractiveAnnounced = true;
      ctx.ui?.notify?.(
        `guardrails-core: strict web mode ativo (interactive+sensitive). domains=${domains}`,
        "info"
      );
    }

    systemPromptParts.push(
      "",
      "Scoped hard routing guard (deterministic) is active for this turn.",
      "- For this task, start with web-browser CDP scripts only.",
      "- Do not use curl/wget/python-requests/r.jina.ai/npm view/registry.npmjs.org as primary path.",
      "- If CDP path fails, explain failure explicitly before proposing fallback.",
    );

    return { systemPrompt: systemPromptParts.join("\n") };
  });

  pi.on("input", async (event, ctx) => {
    const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
    if (activeLongRun) {
      lastLongRunBusyAt = Date.now();
      clearAutoDrainTimer();
    }
    updateLongRunLaneStatus(ctx, activeLongRun);

    if (
      event.source === "interactive"
      && shouldQueueInputForLongRun(event.text ?? "", activeLongRun, longRunIntentQueueConfig)
    ) {
      const queued = enqueueDeferredIntent(
        ctx.cwd,
        event.text ?? "",
        event.source ?? "interactive",
        longRunIntentQueueConfig.maxItems,
      );
      appendAuditEntry(ctx, "guardrails-core.long-run-intent-queued", {
        atIso: new Date().toISOString(),
        itemId: queued.itemId,
        queuedCount: queued.queuedCount,
        queuePath: queued.queuePath,
        activeLongRun,
      });
      if (pragmaticAutonomyConfig.enabled && pragmaticAutonomyConfig.auditAssumptions) {
        appendAuditEntry(ctx, "guardrails-core.pragmatic-assumption-applied", {
          atIso: new Date().toISOString(),
          assumption: "defer-noncritical-interrupt",
          itemId: queued.itemId,
          queuedCount: queued.queuedCount,
          activeLongRun,
          textPreview: summarizeAssumptionText(event.text ?? "", pragmaticAutonomyConfig.maxAuditTextChars),
        });
      }
      updateLongRunLaneStatus(ctx, activeLongRun);
      ctx.ui.notify(
        [
          "Long-run ativo: solicitação registrada na fila sem trocar de foco.",
          "Assunção automática: ambiguidades de baixo risco foram deferidas sem interromper o lane atual.",
          `queued=${queued.queuedCount}`,
          `use '${longRunIntentQueueConfig.forceNowPrefix}<mensagem>' para forçar processamento imediato.`,
        ].join("\n"),
        "info",
      );
      return { action: "handled" as const };
    }

    if (!providerBudgetGovernorConfig.enabled) return { action: "continue" as const };
    if (providerBudgetGovernorMisconfig) return { action: "continue" as const };

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
        appendAuditEntry(ctx, "guardrails-core.provider-budget-override", {
          atIso: new Date().toISOString(),
          provider: currentProvider,
          reason,
          snapshotAtIso: snapshot?.atIso,
        });
        ctx.ui.notify(`provider-budget override aceito para ${currentProvider}: ${reason}`, "warning");
        return { action: "continue" as const };
      }
    }

    appendAuditEntry(ctx, "guardrails-core.provider-budget-block", {
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
    if (providerBudgetGovernorMisconfig) {
      ctx.ui?.setStatus?.("guardrails-core-budget", "[budget] governor-misconfig");
      return undefined;
    }
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

      // Shared policy primitive for bash guardrails (same trigger semantics as monitors)
      const matchedBashPolicy = evaluateBashGuardPolicies(command);
      if (matchedBashPolicy) {
        appendAuditEntry(ctx, matchedBashPolicy.auditKey, {
          atIso: new Date().toISOString(),
          policyId: matchedBashPolicy.id,
          commandPreview: command.slice(0, 240),
        });
        return {
          block: true,
          reason: matchedBashPolicy.reason(),
        };
      }

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

  pi.registerCommand("lane-queue", {
    description: "Manage deferred intents that should not interrupt the current long-run lane. Usage: /lane-queue [status|list|add <text>|pop|clear]",
    handler: async (args, ctx) => {
      const rawArgs = String(args ?? "").trim();
      const sub = rawArgs.toLowerCase().split(/\s+/)[0] || "status";

      if (sub === "clear") {
        const cleared = clearDeferredIntentQueue(ctx.cwd);
        updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages());
        ctx.ui.notify(`lane-queue: cleared ${cleared.cleared} item(s).`, "info");
        return;
      }

      if (sub === "add") {
        const text = parseLaneQueueAddText(rawArgs);
        if (!text) {
          ctx.ui.notify("lane-queue: usage /lane-queue add <text>", "warning");
          return;
        }

        const queued = enqueueDeferredIntent(
          ctx.cwd,
          text,
          "interactive-command",
          longRunIntentQueueConfig.maxItems,
        );
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-queued", {
          atIso: new Date().toISOString(),
          itemId: queued.itemId,
          queuedCount: queued.queuedCount,
          queuePath: queued.queuePath,
          activeLongRun: !ctx.isIdle() || ctx.hasPendingMessages(),
          manual: true,
        });
        updateLongRunLaneStatus(ctx, !ctx.isIdle() || ctx.hasPendingMessages());
        ctx.ui.notify(`lane-queue: queued ${queued.itemId} (total=${queued.queuedCount})`, "info");
        return;
      }

      if (sub === "list") {
        const items = listDeferredIntents(ctx.cwd);
        if (items.length === 0) {
          ctx.ui.notify("lane-queue: empty", "info");
          return;
        }
        const lines = [
          `lane-queue: ${items.length} pending`,
          ...items.slice(-10).map((item) => `- ${item.id} ${item.atIso} :: ${item.text.slice(0, 120)}`),
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "pop") {
        const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
        if (activeLongRun) {
          ctx.ui.notify("lane-queue: long-run still active; pop blocked to avoid focus drift.", "warning");
          return;
        }
        const popped = dequeueDeferredIntent(ctx.cwd);
        updateLongRunLaneStatus(ctx, false);
        if (!popped.item) {
          ctx.ui.notify("lane-queue: empty", "info");
          return;
        }
        appendAuditEntry(ctx, "guardrails-core.long-run-intent-pop", {
          atIso: new Date().toISOString(),
          itemId: popped.item.id,
          queuedCount: popped.queuedCount,
        });
        ctx.ui.notify(`lane-queue: dispatching ${popped.item.id}`, "info");
        pi.sendUserMessage(popped.item.text, { deliverAs: "followUp" });
        scheduleAutoDrainDeferredIntent(ctx, "lane_pop");
        return;
      }

      const activeLongRun = !ctx.isIdle() || ctx.hasPendingMessages();
      const items = listDeferredIntents(ctx.cwd);
      const queued = items.length;
      const nowMs = Date.now();
      const idleSinceMs = Math.max(0, nowMs - lastLongRunBusyAt);
      const gate = resolveAutoDrainGateReason(
        activeLongRun,
        queued,
        nowMs,
        lastAutoDrainAt,
        idleSinceMs,
        longRunIntentQueueConfig,
      );
      const waitMs = estimateAutoDrainWaitMs(
        activeLongRun,
        queued,
        nowMs,
        lastAutoDrainAt,
        idleSinceMs,
        longRunIntentQueueConfig,
      );
      const oldestAgeMs = oldestDeferredIntentAgeMs(items, nowMs);
      const nextDrain = activeLongRun
        ? "after-idle"
        : waitMs === undefined
          ? "n/a"
          : waitMs === 0
            ? "now"
            : `${Math.ceil(waitMs / 1000)}s`;
      const oldest = oldestAgeMs === undefined ? "n/a" : `${Math.ceil(oldestAgeMs / 1000)}s`;

      ctx.ui.notify(
        [
          `lane-queue: ${activeLongRun ? "active" : "idle"} queued=${queued} oldest=${oldest} autoDrain=${longRunIntentQueueConfig.autoDrainOnIdle ? "on" : "off"} batch=${longRunIntentQueueConfig.autoDrainBatchSize} cooldownMs=${longRunIntentQueueConfig.autoDrainCooldownMs} idleStableMs=${longRunIntentQueueConfig.autoDrainIdleStableMs} gate=${gate} nextDrain=${nextDrain}`,
          "tip: for same-turn streaming queue use native follow-up (Alt+Enter / app.message.followUp).",
        ].join("\n"),
        "info",
      );
    },
  });

  pi.on("agent_end", (_event, ctx) => {
    if (strictInteractiveMode) {
      strictInteractiveMode = false;
      ctx.ui?.setStatus?.("guardrails-core", undefined);
    }
    ctx.ui?.setStatus?.("guardrails-core-budget", undefined);
    lastLongRunBusyAt = Date.now();
    scheduleAutoDrainDeferredIntent(ctx, "agent_end");
    updateLongRunLaneStatus(ctx, false);
  });
}
