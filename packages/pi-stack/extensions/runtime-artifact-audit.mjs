/**
 * @capability-id safe-boot
 * @capability-criticality high
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

const ALLOWLIST = [
  /^\.pi\/settings\.json$/,
  /^\.pi\/agents\/[^/]+\.ya?ml$/,
];

export function normalizeTrackedPath(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isAllowlistedPiPath(filePath) {
  const p = normalizeTrackedPath(filePath);
  return ALLOWLIST.some((re) => re.test(p));
}

export function classifyTrackedFiles(paths) {
  const normalized = Array.isArray(paths)
    ? paths.map(normalizeTrackedPath).filter(Boolean)
    : [];

  const violations = [];
  for (const filePath of normalized) {
    if (filePath.startsWith(".sandbox/")) {
      violations.push({ path: filePath, reason: "sandbox-runtime-artifact" });
      continue;
    }

    if (filePath.startsWith(".pi-lens/")) {
      violations.push({ path: filePath, reason: "pi-lens-runtime-artifact" });
      continue;
    }

    if (filePath.startsWith(".pi/") && !isAllowlistedPiPath(filePath)) {
      violations.push({ path: filePath, reason: "pi-runtime-artifact" });
    }
  }

  return {
    trackedCount: normalized.length,
    violations,
  };
}

export function buildRemediationCommands(violations) {
  const rows = Array.isArray(violations) ? violations : [];
  if (rows.length === 0) return [];
  return [
    ...rows.map((v) => `git rm --cached -- "${v.path}"`),
    "# depois: confirme/ajuste .gitignore para prevenir recorrência",
  ];
}

function listTrackedFiles(cwd) {
  const out = execFileSync("git", ["ls-files"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function runRuntimeArtifactAudit(cwd = process.cwd()) {
  const tracked = listTrackedFiles(cwd);
  const result = classifyTrackedFiles(tracked);
  const remediation = buildRemediationCommands(result.violations);
  return {
    cwd,
    ...result,
    remediation,
  };
}

export function buildRuntimeArtifactAuditSummary(report) {
  const violations = Array.isArray(report?.violations) ? report.violations : [];
  return [
    "runtime-artifact-audit:",
    `tracked=${Number(report?.trackedCount ?? 0)}`,
    `violations=${violations.length}`,
    violations.length > 0 ? "status=violation" : "status=clean",
  ].join(" ");
}
