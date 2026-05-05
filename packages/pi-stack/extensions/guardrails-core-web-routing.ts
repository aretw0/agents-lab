import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CDP_SCRIPT_HINT, DISALLOWED_BASH_PATTERNS, INTERACTIVE_TERMS, SENSITIVE_DOMAINS, SENSITIVE_HINTS } from "./guardrails-core-web-routing-config";

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

export interface GuardrailsPortConflictConfig {
  enabled: boolean;
  suggestedTestPort: number;
}

export function resolveGuardrailsPortConflictConfig(cwd: string): GuardrailsPortConflictConfig {
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
