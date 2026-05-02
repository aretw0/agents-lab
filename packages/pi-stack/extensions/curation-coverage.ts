import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type CurationCoverageStrategy = "keep" | "suppress-by-filter" | "remove-from-profile" | "needs-decision";
export type CurationCoverageStatus = "filtered" | "tracked" | "removed" | "missing-filter" | "needs-decision";

export interface CurationCoverageRecord {
  id: string;
  capabilityId: string;
  firstPartyPackage: string;
  coveredSurface: string;
  thirdPartyPackage: string;
  thirdPartySurfaces: string[];
  strategy: CurationCoverageStrategy;
  status?: string;
  reason?: string;
}

export interface CurationCoverageRegistry {
  version: string;
  records: CurationCoverageRecord[];
}

export interface FilterPatchLike {
  source?: string;
  extensions?: string[];
  skills?: string[];
}

export interface EvaluatedCurationCoverageRecord extends CurationCoverageRecord {
  evaluatedStatus: CurationCoverageStatus;
  filterPresent: boolean;
  activeInInstalledPackages: boolean;
  action: string;
  risk: "low" | "medium" | "high";
}

export interface CurationCoverageSummary {
  total: number;
  filtered: number;
  tracked: number;
  removed: number;
  missingFilter: number;
  needsDecision: number;
  activeThirdPartyOverlaps: number;
}

export const CURATION_FILTER_PATCHES: FilterPatchLike[] = [
  {
    source: "npm:mitsupi",
    extensions: ["!pi-extensions/uv.ts"],
    skills: ["!skills/commit", "!skills/github", "!skills/web-browser"],
  },
  {
    source: "npm:@ifi/oh-pi-skills",
    skills: ["!skills/git-workflow"],
  },
  {
    source: "npm:pi-web-access",
    skills: ["!skills/librarian"],
  },
  {
    source: "npm:@ifi/oh-pi-extensions",
    extensions: [
      "!extensions/custom-footer.ts",
      "!extensions/usage-tracker.ts",
      "!extensions/usage-tracker-providers.ts",
      "!extensions/watchdog.ts",
      "!extensions/safe-guard.ts",
      "!extensions/bg-process.ts",
    ],
  },
];

export interface CurationCoverageEvaluation {
  mode: "first-party-curation-coverage";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  mutationAllowed: false;
  registryVersion: string;
  summary: CurationCoverageSummary;
  records: EvaluatedCurationCoverageRecord[];
  evidence: string;
}

interface CapabilityCoverageContainer {
  version?: string;
  capabilities?: Array<{
    id?: string;
    primaryPackage?: string;
    curationCoverage?: unknown;
  }>;
}

function extensionDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function readJson(pathname: string): unknown {
  if (!existsSync(pathname)) return undefined;
  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function cleanStrategy(value: unknown): CurationCoverageStrategy {
  return value === "keep" || value === "suppress-by-filter" || value === "remove-from-profile" || value === "needs-decision"
    ? value
    : "needs-decision";
}

function normalizeCoverageRecord(raw: unknown, capabilityId: string, firstPartyPackage: string, index: number): CurationCoverageRecord | undefined {
  const record = asRecord(raw);
  const thirdPartyPackage = cleanString(record.thirdPartyPackage);
  const thirdPartySurfaces = cleanStringArray(record.thirdPartySurfaces);
  if (!thirdPartyPackage) return undefined;
  return {
    id: cleanString(record.id) ?? `${capabilityId}-coverage-${index + 1}`,
    capabilityId,
    firstPartyPackage: cleanString(record.firstPartyPackage) ?? firstPartyPackage,
    coveredSurface: cleanString(record.coveredSurface) ?? capabilityId,
    thirdPartyPackage,
    thirdPartySurfaces,
    strategy: cleanStrategy(record.strategy),
    ...(cleanString(record.status) ? { status: cleanString(record.status) } : {}),
    ...(cleanString(record.reason) ? { reason: cleanString(record.reason) } : {}),
  };
}

export function normalizePackageName(source: string): string {
  return source.startsWith("npm:") ? source.slice(4) : source;
}

function normalizeSuppression(value: string): string {
  return value.startsWith("!") ? value.slice(1) : value;
}

export function readCurationCoverageRegistry(registryPath?: string): CurationCoverageRegistry {
  const p = registryPath ?? path.join(extensionDir(), "data", "capability-owners.json");
  const parsed = readJson(p) as CapabilityCoverageContainer | undefined;
  if (!parsed || !Array.isArray(parsed.capabilities)) return { version: "unknown", records: [] };
  const records: CurationCoverageRecord[] = [];
  for (const capability of parsed.capabilities) {
    const capabilityId = cleanString(capability.id);
    const firstPartyPackage = cleanString(capability.primaryPackage);
    if (!capabilityId || !firstPartyPackage || !Array.isArray(capability.curationCoverage)) continue;
    capability.curationCoverage.forEach((entry, index) => {
      const record = normalizeCoverageRecord(entry, capabilityId, firstPartyPackage, index);
      if (record) records.push(record);
    });
  }
  return { version: typeof parsed.version === "string" ? parsed.version : "unknown", records };
}

export function filterPatchCoversSurface(patches: FilterPatchLike[], thirdPartyPackage: string, surface: string): boolean {
  const normalizedPackage = normalizePackageName(thirdPartyPackage);
  return patches.some((patch) => {
    if (!patch.source || normalizePackageName(patch.source) !== normalizedPackage) return false;
    const suppressed = [...(patch.extensions ?? []), ...(patch.skills ?? [])].map(normalizeSuppression);
    return suppressed.includes(surface);
  });
}

function evaluateRecord(record: CurationCoverageRecord, filterPatches: FilterPatchLike[], installedPackages: Set<string>): EvaluatedCurationCoverageRecord {
  const activeInInstalledPackages = installedPackages.has(record.thirdPartyPackage);
  const filterPresent = record.thirdPartySurfaces.length > 0 && record.thirdPartySurfaces.every((surface) =>
    filterPatchCoversSurface(filterPatches, record.thirdPartyPackage, surface)
  );

  let evaluatedStatus: CurationCoverageStatus = "tracked";
  if (record.strategy === "suppress-by-filter") evaluatedStatus = filterPresent ? "filtered" : "missing-filter";
  else if (record.strategy === "remove-from-profile") evaluatedStatus = activeInInstalledPackages ? "needs-decision" : "removed";
  else if (record.strategy === "needs-decision") evaluatedStatus = "needs-decision";
  else evaluatedStatus = "tracked";

  const risk: EvaluatedCurationCoverageRecord["risk"] = evaluatedStatus === "missing-filter"
    ? "high"
    : evaluatedStatus === "needs-decision" && activeInInstalledPackages
      ? "medium"
      : "low";

  const action = evaluatedStatus === "filtered"
    ? "keep filter and monitor first-party maturity"
    : evaluatedStatus === "missing-filter"
      ? "add installer/profile filter or downgrade strategy"
      : evaluatedStatus === "removed"
        ? "keep removed from profile"
        : evaluatedStatus === "needs-decision"
          ? "decide keep/filter/remove before stronger unattended profiles"
          : "track overlap";

  return { ...record, evaluatedStatus, filterPresent, activeInInstalledPackages, action, risk };
}

export function evaluateCurationCoverage(input: {
  registry: CurationCoverageRegistry;
  filterPatches?: FilterPatchLike[];
  installedPackages?: Set<string>;
}): CurationCoverageEvaluation {
  const installedPackages = input.installedPackages ?? new Set<string>();
  const filterPatches = input.filterPatches ?? CURATION_FILTER_PATCHES;
  const records = input.registry.records.map((record) => evaluateRecord(record, filterPatches, installedPackages));
  const summary: CurationCoverageSummary = {
    total: records.length,
    filtered: records.filter((record) => record.evaluatedStatus === "filtered").length,
    tracked: records.filter((record) => record.evaluatedStatus === "tracked").length,
    removed: records.filter((record) => record.evaluatedStatus === "removed").length,
    missingFilter: records.filter((record) => record.evaluatedStatus === "missing-filter").length,
    needsDecision: records.filter((record) => record.evaluatedStatus === "needs-decision").length,
    activeThirdPartyOverlaps: records.filter((record) => record.activeInInstalledPackages && record.evaluatedStatus !== "filtered" && record.evaluatedStatus !== "removed").length,
  };
  const evidence = [
    "first-party-coverage",
    `total=${summary.total}`,
    `filtered=${summary.filtered}`,
    `missingFilter=${summary.missingFilter}`,
    `needsDecision=${summary.needsDecision}`,
    `activeOverlaps=${summary.activeThirdPartyOverlaps}`,
    "dispatch=no",
    "authorization=none",
  ].join(" ");

  return {
    mode: "first-party-curation-coverage",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    mutationAllowed: false,
    registryVersion: input.registry.version,
    summary,
    records,
    evidence,
  };
}
