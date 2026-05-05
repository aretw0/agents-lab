import { relative, resolve, sep } from "node:path";
import {
  ALLOWED_OUTSIDE,
  SENSITIVE_PATHS,
  UPSTREAM_PI_PACKAGE_MUTATION_BLOCKLIST,
} from "./guardrails-core-path-guard-config";

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

export function isUpstreamPiPackagePath(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  return UPSTREAM_PI_PACKAGE_MUTATION_BLOCKLIST.some((blockedRoot) => {
    const root = resolve(cwd, blockedRoot);
    const rel = relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
  });
}

export function upstreamPiPackageMutationToolReason(filePath: string): string {
  return [
    `Mutação bloqueada: pacote upstream/original do pi (${filePath}).`,
    "Use extensão, wrapper, patch controlado ou PR upstream; leitura bounded continua permitida.",
  ].join(" ");
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
