/**
 * @capability-id stack-sovereignty-governance
 * @capability-criticality high
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildSchedulerOwnershipSnapshot, resolveSchedulerGovernanceConfig } from "./scheduler-governance";
import { evaluateCurationCoverage, readCurationCoverageRegistry } from "./curation-coverage";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import { buildRepoQualityAudit } from "./stack-quality-audit.mjs";

export type CapabilityCriticality = "high" | "medium" | "low";
export type CapabilityStatus = "owned" | "coexisting" | "owner-missing" | "inactive";

export interface CapabilityOwnerRecord {
  id: string;
  name: string;
  criticality: CapabilityCriticality;
  primaryPackage: string;
  secondaryPackages?: string[];
  conflictsWithPackages?: string[];
  coexistencePolicy?: string;
  defaultAction?: string;
}

export interface CapabilityRegistry {
  version: string;
  capabilities: CapabilityOwnerRecord[];
}

export interface CapabilityEvaluation {
  capabilityId: string;
  name: string;
  criticality: CapabilityCriticality;
  status: CapabilityStatus;
  primaryPackage: string;
  ownerPresent: boolean;
  competingPresent: string[];
  secondaryPresent: string[];
  action: string;
  risk: "low" | "medium" | "high";
}

function normalizeFromLocalPath(entry: string): string | undefined {
  const normalized = entry.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/packages/pi-stack")) return "@aretw0/pi-stack";
  if (normalized.includes("/packages/web-skills")) return "@aretw0/web-skills";
  if (normalized.includes("/packages/git-skills")) return "@aretw0/git-skills";
  if (normalized.includes("/packages/pi-skills")) return "@aretw0/pi-skills";
  if (normalized.includes("/packages/lab-skills")) return "@aretw0/lab-skills";
  return undefined;
}

export function normalizePackageSource(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    const localMapped = normalizeFromLocalPath(entry);
    if (localMapped) return localMapped;
    if (entry.startsWith("npm:")) return entry.slice(4);
    return entry;
  }

  if (!entry || typeof entry !== "object") return undefined;
  const source = (entry as { source?: unknown }).source;
  if (typeof source !== "string") return undefined;
  const localMapped = normalizeFromLocalPath(source);
  if (localMapped) return localMapped;
  if (source.startsWith("npm:")) return source.slice(4);
  return source;
}

export function normalizeInstalledPackagesFromSettings(settings: unknown): string[] {
  if (!settings || typeof settings !== "object") return [];
  const packages = (settings as { packages?: unknown }).packages;
  if (!Array.isArray(packages)) return [];

  const out = new Set<string>();
  for (const entry of packages) {
    const normalized = normalizePackageSource(entry);
    if (normalized && normalized.trim().length > 0) out.add(normalized.trim());
  }
  return [...out];
}

function readJson(pathname: string): unknown {
  if (!existsSync(pathname)) return undefined;
  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return undefined;
  }
}

function extensionDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function readCapabilityRegistry(registryPath?: string): CapabilityRegistry {
  const p = registryPath ?? path.join(extensionDir(), "data", "capability-owners.json");
  const parsed = readJson(p) as CapabilityRegistry | undefined;
  if (!parsed || !Array.isArray(parsed.capabilities)) {
    return { version: "unknown", capabilities: [] };
  }

  return {
    version: typeof parsed.version === "string" ? parsed.version : "unknown",
    capabilities: parsed.capabilities
      .filter((c) => c && typeof c.id === "string" && typeof c.primaryPackage === "string")
      .map((c) => ({
        id: c.id,
        name: c.name,
        criticality: c.criticality ?? "medium",
        primaryPackage: c.primaryPackage,
        secondaryPackages: Array.isArray(c.secondaryPackages) ? c.secondaryPackages : [],
        conflictsWithPackages: Array.isArray(c.conflictsWithPackages) ? c.conflictsWithPackages : [],
        coexistencePolicy: c.coexistencePolicy,
        defaultAction: c.defaultAction,
      })),
  };
}

function riskForStatus(criticality: CapabilityCriticality, status: CapabilityStatus): "low" | "medium" | "high" {
  if (status === "owner-missing") return criticality === "high" ? "high" : "medium";
  if (status === "coexisting") return criticality === "high" ? "medium" : "low";
  return "low";
}

export function evaluateCapabilityOwnership(
  registry: CapabilityRegistry,
  installedPackages: Set<string>
): CapabilityEvaluation[] {
  return registry.capabilities.map((cap) => {
    const ownerPresent = installedPackages.has(cap.primaryPackage);
    const competingPresent = (cap.conflictsWithPackages ?? []).filter((p) => installedPackages.has(p));
    const secondaryPresent = (cap.secondaryPackages ?? []).filter((p) => installedPackages.has(p));

    let status: CapabilityStatus = "inactive";
    if (ownerPresent && competingPresent.length > 0) status = "coexisting";
    else if (ownerPresent) status = "owned";
    else if (!ownerPresent && (competingPresent.length > 0 || secondaryPresent.length > 0)) status = "owner-missing";

    return {
      capabilityId: cap.id,
      name: cap.name,
      criticality: cap.criticality,
      status,
      primaryPackage: cap.primaryPackage,
      ownerPresent,
      competingPresent,
      secondaryPresent,
      action: cap.defaultAction ?? "maintain",
      risk: riskForStatus(cap.criticality, status),
    };
  });
}

function readWorkspaceSettings(cwd: string): unknown {
  return readJson(path.join(cwd, ".pi", "settings.json"));
}

function summarizeEvaluations(rows: CapabilityEvaluation[]): {
  highRisk: number;
  mediumRisk: number;
  ownerMissing: number;
  coexisting: number;
} {
  return {
    highRisk: rows.filter((r) => r.risk === "high").length,
    mediumRisk: rows.filter((r) => r.risk === "medium").length,
    ownerMissing: rows.filter((r) => r.status === "owner-missing").length,
    coexisting: rows.filter((r) => r.status === "coexisting").length,
  };
}

function icon(status: CapabilityStatus): string {
  if (status === "owned") return "[ok]";
  if (status === "coexisting") return "[!!]";
  if (status === "owner-missing") return "[XX]";
  return "[--]";
}

function boolParam(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function numberParam(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function stringParam(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : fallback;
}

export default function stackSovereigntyExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "stack_sovereignty_status",
    label: "Stack Sovereignty Status",
    description: "Audit stack capability ownership, overlap risk, and scheduler governance posture.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const settings = readWorkspaceSettings(ctx.cwd);
      const installed = new Set(normalizeInstalledPackagesFromSettings(settings));
      const registry = readCapabilityRegistry();
      const evaluations = evaluateCapabilityOwnership(registry, installed);
      const summary = summarizeEvaluations(evaluations);
      const curationCoverage = evaluateCurationCoverage({ registry: readCurationCoverageRegistry(), installedPackages: installed });

      const schedCfg = resolveSchedulerGovernanceConfig(ctx.cwd);
      const schedSnapshot = buildSchedulerOwnershipSnapshot(ctx.cwd, schedCfg.policy, schedCfg.staleAfterMs);

      const payload = {
        registryVersion: registry.version,
        installedPackages: [...installed].sort(),
        summary,
        capabilities: evaluations,
        curationCoverage,
        schedulerGovernance: {
          config: schedCfg,
          snapshot: schedSnapshot,
        },
      };

      return buildOperatorVisibleToolResponse({
        label: "stack_sovereignty_status",
        summary: [
          "stack-sovereignty:",
          `highRisk=${summary.highRisk}`,
          `ownerMissing=${summary.ownerMissing}`,
          `coexisting=${summary.coexisting}`,
          `curationMissing=${curationCoverage.summary.missingFilter}`,
          `activeForeignOwner=${schedSnapshot.activeForeignOwner ? "yes" : "no"}`,
          `foreignTasks=${schedSnapshot.foreignTaskCount}`,
        ].join(" "),
        details: payload,
      });
    },
  });

  pi.registerTool({
    name: "stack_quality_audit",
    label: "Stack Quality Audit",
    description: "Run repo quality gates for complexity, bloat, and discourse from the first-party stack surface.",
    parameters: Type.Object({
      complexity: Type.Optional(Type.Boolean()),
      bloat: Type.Optional(Type.Boolean()),
      discourse: Type.Optional(Type.Boolean()),
      changed: Type.Optional(Type.Boolean()),
      base: Type.Optional(Type.String()),
      maxLines: Type.Optional(Type.Number()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const audit = buildRepoQualityAudit(ctx.cwd, {
        complexity: boolParam((params as Record<string, unknown>)?.complexity, true),
        bloat: boolParam((params as Record<string, unknown>)?.bloat, true),
        discourse: boolParam((params as Record<string, unknown>)?.discourse, true),
        changed: boolParam((params as Record<string, unknown>)?.changed, false),
        base: stringParam((params as Record<string, unknown>)?.base, "HEAD"),
        maxLines: numberParam((params as Record<string, unknown>)?.maxLines, 1000),
      });

      return buildOperatorVisibleToolResponse({
        label: "stack_quality_audit",
        summary: [
          "stack-quality:",
          `errors=${audit.summary.errors}`,
          `complexityBlocking=${audit.summary.complexityBlocking}`,
          `complexityAllowed=${audit.summary.complexityAllowed}`,
          `bloatViolations=${audit.summary.bloatViolations}`,
          `bloatWarnings=${audit.summary.bloatWarnings}`,
          `localBloatAdvisories=${audit.summary.localBloatAdvisories}`,
          `discourseFindings=${audit.summary.discourseFindings}`,
        ].join(" "),
        details: audit,
      });
    },
  });

  pi.registerCommand("stack-status", {
    description: "Show stack sovereignty health: capability owners, overlap risks, and scheduler conflict posture.",
    handler: async (_args, ctx) => {
      const settings = readWorkspaceSettings(ctx.cwd);
      const installed = new Set(normalizeInstalledPackagesFromSettings(settings));
      const registry = readCapabilityRegistry();
      const evaluations = evaluateCapabilityOwnership(registry, installed);
      const summary = summarizeEvaluations(evaluations);
      const curationCoverage = evaluateCurationCoverage({ registry: readCurationCoverageRegistry(), installedPackages: installed });

      const schedCfg = resolveSchedulerGovernanceConfig(ctx.cwd);
      const schedSnapshot = buildSchedulerOwnershipSnapshot(ctx.cwd, schedCfg.policy, schedCfg.staleAfterMs);

      const lines = [
        "stack sovereignty status",
        `registryVersion: ${registry.version}`,
        `installedPackages: ${installed.size}`,
        `summary: ownerMissing=${summary.ownerMissing} coexisting=${summary.coexisting} highRisk=${summary.highRisk}`,
        `curationCoverage: filtered=${curationCoverage.summary.filtered} missingFilter=${curationCoverage.summary.missingFilter} needsDecision=${curationCoverage.summary.needsDecision} activeOverlaps=${curationCoverage.summary.activeThirdPartyOverlaps}`,
        "",
        "capabilities:",
        ...evaluations.map((e) =>
          `  ${icon(e.status)} ${e.capabilityId} (${e.criticality}) -> ${e.status} · owner=${e.primaryPackage} · action=${e.action}`
        ),
        "",
        "scheduler:",
        `  policy=${schedCfg.policy} activeForeignOwner=${schedSnapshot.activeForeignOwner ? "yes" : "no"} foreignTaskCount=${schedSnapshot.foreignTaskCount}`,
      ];

      const severity = summary.highRisk > 0 || schedSnapshot.activeForeignOwner ? "warning" : "info";
      ctx.ui.notify(lines.join("\n"), severity);
    },
  });

  pi.registerCommand("stack-quality", {
    description: "Run stack quality audit: complexity budget, bloat hygiene, and discourse drift.",
    handler: async (_args, ctx) => {
      const audit = buildRepoQualityAudit(ctx.cwd);
      const lines = [
        "stack quality audit",
        `errors: ${audit.summary.errors}`,
        `complexity: blocking=${audit.summary.complexityBlocking} allowed=${audit.summary.complexityAllowed}`,
        `bloat: violations=${audit.summary.bloatViolations} warnings=${audit.summary.bloatWarnings} localAdvisories=${audit.summary.localBloatAdvisories}`,
        `discourse: findings=${audit.summary.discourseFindings}`,
      ];
      const severity = audit.summary.errors > 0 || audit.summary.complexityBlocking > 0 || audit.summary.bloatViolations > 0 ? "warning" : "info";
      ctx.ui.notify(lines.join("\n"), severity);
    },
  });
}
