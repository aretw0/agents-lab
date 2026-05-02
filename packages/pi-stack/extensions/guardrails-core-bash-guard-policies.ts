import {
  commandSensitiveShellMarkerCheckReason,
  detectShellInlineCommandSensitiveMarkerCheck,
} from "./guardrails-core-marker-check";
import { matchesWhen, toPolicyFacts } from "./policy-primitive";

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
const UPSTREAM_PI_PACKAGE_PATH_PATTERN = /(?:^|[\s"'=:(]|\.\.?\/|[a-z]:\/|\/)(?:[^\s"']*\/)?node_modules\/@mariozechner\/pi-coding-agent(?:\/|$|[\s"')])/i;
const UPSTREAM_PI_MUTATION_TOOL_PATTERN =
  /\b(?:rm|rmdir|del|erase|mv|move|cp|copy|xcopy|robocopy|mkdir|touch|chmod|chown)\b|\bsed\b[\s\S]*\s-i\b|\bperl\b[\s\S]*\s-pi\b|\b(?:set-content|add-content|out-file)\b|\bgit\s+(?:checkout|restore|apply|reset)\b/i;
const REDIRECT_TO_UPSTREAM_PI_PACKAGE_PATTERN = />{1,2}\s*["']?[^\s"']*node_modules\/@mariozechner\/pi-coding-agent(?:\/|$)/i;
const SOURCE_MAP_PATH_PATTERN = /(?:^|[\s"'])(?:[^\s"'*]*\/)?[^\s"'*]+\.map(?:$|[\s"'|;)])/i;
const SOURCE_MAP_CONTENT_TOOL_PATTERN = /\b(?:grep|rg|findstr|awk|sed|cat|tail|head|more|less)\b/i;
const SOURCE_MAP_RECURSIVE_SCAN_ROOT_PATTERN = /(?:^|[\s"'])(?:\.\/)?(?:node_modules|dist|build|coverage)(?:$|[\s"'|;)])/i;
const SOURCE_MAP_RECURSIVE_SCAN_TOOL_PATTERN =
  /\brg\b|\bgrep\b[\s\S]*\b--recursive\b|\bgrep\b[\s\S]*\s-[a-z]*r[a-z]*\b|\bfindstr\b[\s\S]*\s\/s\b/i;
const SOURCE_MAP_EXCLUDE_PATTERN = /--exclude(?:=|\s+)["']?\*\.map["']?|(?:--glob|-g)\s+["']?!\*\.map["']?/i;
const DU_DEPTH_LIMIT_PATTERN = /--max-depth(?:=|\s+)\d+\b|(?:^|\s)-d\s+\d+\b/i;
const DU_BROAD_TARGET_PATTERN = /^(?:\.|\.\/|\.\.|\.\.\/|\/|~|~\/|\*|\/\*|[a-z]:\/?|\/mnt\/[a-z]\/?)$/i;
const FIND_DEPTH_LIMIT_PATTERN = /(?:^|\s)-maxdepth\s+\d+\b/i;
const FIND_BROAD_TARGET_PATTERN = DU_BROAD_TARGET_PATTERN;

export type BashGuardPolicy = {
  id: string;
  when: string;
  detect: (command: string) => boolean;
  reason: () => string;
  auditKey: string;
};

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

export function detectUpstreamPiPackageMutation(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\\/g, "/");
  if (REDIRECT_TO_UPSTREAM_PI_PACKAGE_PATTERN.test(normalized)) return true;
  if (!UPSTREAM_PI_PACKAGE_PATH_PATTERN.test(normalized)) return false;
  return UPSTREAM_PI_MUTATION_TOOL_PATTERN.test(normalized);
}

export function upstreamPiPackageMutationReason(): string {
  return [
    "Blocked by guardrails-core (upstream_pi_package_mutation): do not mutate the original pi package under node_modules/@mariozechner/pi-coding-agent.",
    "Use an extension, wrapper, controlled patch workflow, or upstream PR instead; bounded reads remain allowed.",
  ].join(" ");
}

export function detectSourceMapBlastRadiusScan(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\\/g, "/");
  if (SESSION_LOG_FILENAME_ONLY_PATTERN.test(normalized)) return false;
  if (SESSION_LOG_COUNT_ONLY_PATTERN.test(normalized)) return false;
  if (SOURCE_MAP_PATH_PATTERN.test(normalized) && SOURCE_MAP_CONTENT_TOOL_PATTERN.test(normalized)) return true;
  if (!SOURCE_MAP_RECURSIVE_SCAN_TOOL_PATTERN.test(normalized)) return false;
  if (!SOURCE_MAP_RECURSIVE_SCAN_ROOT_PATTERN.test(normalized)) return false;
  return !SOURCE_MAP_EXCLUDE_PATTERN.test(normalized);
}

export function sourceMapBlastRadiusScanReason(): string {
  return [
    "Blocked by guardrails-core (source_map_blast_radius): command can dump source maps or generated bundles into context.",
    "Use bounded read/offset, filename/count-only search, or add an explicit *.map exclude such as --exclude='*.map' or -g '!*.map'.",
  ].join(" ");
}

function tokenizeShellSegment(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function extractDuTargets(segment: string): string[] {
  const tokens = tokenizeShellSegment(segment);
  const duIndex = tokens.findIndex((token) => /(?:^|\/)du$/i.test(token));
  if (duIndex < 0) return [];

  const targets: string[] = [];
  for (const token of tokens.slice(duIndex + 1)) {
    if (token.startsWith("-")) continue;
    if (/^[0-9]?>/.test(token)) continue;
    const normalized = token.replace(/^['"]|['"]$/g, "");
    if (!normalized) continue;
    if (normalized === "||" || normalized === "&&" || normalized === "|" || normalized === ";") break;
    targets.push(normalized);
  }
  return targets;
}

function extractFindTargets(segment: string): string[] {
  const tokens = tokenizeShellSegment(segment);
  const findIndex = tokens.findIndex((token) => /(?:^|\/)find$/i.test(token));
  if (findIndex < 0) return [];

  const targets: string[] = [];
  for (const token of tokens.slice(findIndex + 1)) {
    const normalized = token.replace(/^['"]|['"]$/g, "");
    if (!normalized) continue;
    if (normalized.startsWith("-")) break;
    if (normalized === "!" || normalized === "(" || normalized === ")") break;
    if (normalized === "||" || normalized === "&&" || normalized === "|" || normalized === ";") break;
    targets.push(normalized);
  }

  return targets.length > 0 ? targets : ["."];
}

export function detectHighRiskWideDuScan(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\\/g, "/");
  if (!/\bdu\b/i.test(normalized)) return false;

  const segments = normalized.split(/\|\||&&|;|\|/g);
  for (const segment of segments) {
    if (!/\bdu\b/i.test(segment)) continue;
    if (DU_DEPTH_LIMIT_PATTERN.test(segment)) continue;

    const targets = extractDuTargets(segment);
    if (targets.length <= 0) return true;
    if (targets.some((target) => DU_BROAD_TARGET_PATTERN.test(target))) return true;
  }
  return false;
}

export function highRiskWideDuScanReason(): string {
  return [
    "Blocked by guardrails-core (wide_du_scan): broad du scan can run for a long time without adding proportional signal.",
    "Scope paths explicitly (e.g. .git/.tmp), add depth limits (--max-depth or -d), and run bash with an explicit timeout.",
  ].join(" ");
}

export function detectHighRiskWideFindScan(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\\/g, "/");
  if (!/\bfind\b/i.test(normalized)) return false;

  const segments = normalized.split(/\|\||&&|;|\|/g);
  for (const segment of segments) {
    if (!/\bfind\b/i.test(segment)) continue;
    if (FIND_DEPTH_LIMIT_PATTERN.test(segment)) continue;

    const targets = extractFindTargets(segment);
    if (targets.some((target) => FIND_BROAD_TARGET_PATTERN.test(target))) return true;
  }
  return false;
}

export function highRiskWideFindScanReason(): string {
  return [
    "Blocked by guardrails-core (wide_find_scan): broad find scan can run for a long time with low signal-to-cost.",
    "Scope the target directory explicitly, prefer bounded roots, and add -maxdepth when possible before re-running.",
  ].join(" ");
}

export const BASH_GUARD_POLICIES: BashGuardPolicy[] = [
  {
    id: "command-sensitive-shell-marker-check",
    when: "tool(bash)",
    detect: detectShellInlineCommandSensitiveMarkerCheck,
    reason: commandSensitiveShellMarkerCheckReason,
    auditKey: "guardrails-core.command-sensitive-shell-marker-check-block",
  },
  {
    id: "upstream-pi-package-mutation",
    when: "tool(bash)",
    detect: detectUpstreamPiPackageMutation,
    reason: upstreamPiPackageMutationReason,
    auditKey: "guardrails-core.upstream-pi-package-mutation-block",
  },
  {
    id: "source-map-blast-radius-scan",
    when: "tool(bash)",
    detect: detectSourceMapBlastRadiusScan,
    reason: sourceMapBlastRadiusScanReason,
    auditKey: "guardrails-core.source-map-blast-radius-scan-block",
  },
  {
    id: "wide-du-scan",
    when: "tool(bash)",
    detect: detectHighRiskWideDuScan,
    reason: highRiskWideDuScanReason,
    auditKey: "guardrails-core.wide-du-scan-block",
  },
  {
    id: "wide-find-scan",
    when: "tool(bash)",
    detect: detectHighRiskWideFindScan,
    reason: highRiskWideFindScanReason,
    auditKey: "guardrails-core.wide-find-scan-block",
  },
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

export function evaluateBashGuardPolicies(command: string): BashGuardPolicy | undefined {
  for (const policy of BASH_GUARD_POLICIES) {
    if (!shouldApplyBashGuardPolicy(policy)) continue;
    if (policy.detect(command)) return policy;
  }
  return undefined;
}
