export type GitMaintenanceSeverity = "informational" | "warning" | "intervention";
export type GitMaintenanceAction = "continue" | "monitor" | "ask-before-maintenance";

export interface GitMaintenanceSignalInput {
  looseObjectCount: number;
  looseSizeMiB: number;
  garbageCount?: number;
  garbageSizeMiB?: number;
  gcLogPresent?: boolean;
  diskLow?: boolean;
  performanceDegraded?: boolean;
}

export interface GitMaintenanceSignal {
  severity: GitMaintenanceSeverity;
  action: GitMaintenanceAction;
  reasons: string[];
  cleanupAllowedAutomatically: false;
  summary: string;
  recommendation: string;
  metrics: {
    looseObjectCount: number;
    looseSizeMiB: number;
    garbageCount: number;
    garbageSizeMiB: number;
    gcLogPresent: boolean;
    diskLow: boolean;
    performanceDegraded: boolean;
  };
}

function asNonNegativeNumber(value: unknown): number {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function evaluateGitMaintenanceSignal(input: GitMaintenanceSignalInput): GitMaintenanceSignal {
  const metrics = {
    looseObjectCount: Math.floor(asNonNegativeNumber(input.looseObjectCount)),
    looseSizeMiB: asNonNegativeNumber(input.looseSizeMiB),
    garbageCount: Math.floor(asNonNegativeNumber(input.garbageCount)),
    garbageSizeMiB: asNonNegativeNumber(input.garbageSizeMiB),
    gcLogPresent: input.gcLogPresent === true,
    diskLow: input.diskLow === true,
    performanceDegraded: input.performanceDegraded === true,
  };

  const reasons: string[] = [];
  if (metrics.gcLogPresent) reasons.push("gc-log-present");
  if (metrics.looseObjectCount >= 5000) reasons.push("many-loose-objects");
  if (metrics.looseSizeMiB >= 100) reasons.push("large-loose-object-size");
  if (metrics.garbageCount > 0) reasons.push("garbage-objects");
  if (metrics.garbageSizeMiB >= 100) reasons.push("large-garbage-size");
  if (metrics.diskLow) reasons.push("disk-low");
  if (metrics.performanceDegraded) reasons.push("performance-degraded");

  const needsIntervention = metrics.diskLow
    || metrics.performanceDegraded
    || metrics.garbageSizeMiB >= 100
    || metrics.looseSizeMiB >= 1024;

  if (needsIntervention) {
    return {
      severity: "intervention",
      action: "ask-before-maintenance",
      reasons,
      cleanupAllowedAutomatically: false,
      summary: `git-maintenance: severity=intervention action=ask-before-maintenance loose=${metrics.looseObjectCount} sizeMiB=${metrics.looseSizeMiB} garbage=${metrics.garbageCount} gcLog=${metrics.gcLogPresent ? "yes" : "no"}`,
      recommendation: "Checkpoint first, inspect git state, and ask the operator before running git gc/prune or removing .git/gc.log.",
      metrics,
    };
  }

  const warning = metrics.gcLogPresent
    || metrics.looseObjectCount >= 5000
    || metrics.looseSizeMiB >= 100
    || metrics.garbageCount > 0;

  if (warning) {
    return {
      severity: "warning",
      action: "monitor",
      reasons,
      cleanupAllowedAutomatically: false,
      summary: `git-maintenance: severity=warning action=monitor loose=${metrics.looseObjectCount} sizeMiB=${metrics.looseSizeMiB} garbage=${metrics.garbageCount} gcLog=${metrics.gcLogPresent ? "yes" : "no"}`,
      recommendation: "Record the signal and continue if the repository is responsive; maintenance remains opt-in.",
      metrics,
    };
  }

  return {
    severity: "informational",
    action: "continue",
    reasons,
    cleanupAllowedAutomatically: false,
    summary: `git-maintenance: severity=informational action=continue loose=${metrics.looseObjectCount} sizeMiB=${metrics.looseSizeMiB} garbage=${metrics.garbageCount} gcLog=${metrics.gcLogPresent ? "yes" : "no"}`,
    recommendation: "No maintenance action needed; keep observing during long runs.",
    metrics,
  };
}
