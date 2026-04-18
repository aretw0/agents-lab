/**
 * governance-profiles — named governance profiles for budget/routing/delivery.
 *
 * Three profiles abstract the most common safety × velocity trade-offs so
 * operators don't have to hand-tune individual thresholds:
 *
 *   conservative — safety-first: report-only delivery, observe scheduler,
 *                  provider-budget enforcement on, low per-run cost cap.
 *   balanced     — production default: patch-artifact delivery, observe
 *                  scheduler, enforcement on, standard cost cap.
 *   throughput   — max velocity: apply-to-branch delivery, enforce scheduler,
 *                  enforcement relaxed, higher cost cap.
 *
 * A profile is a piStack settings patch; applying it:
 *   1. Saves a settings snapshot (rollback-safe).
 *   2. Deep-merges the profile over existing settings (non-profile fields preserved).
 *   3. Records the active profile name in piStack.governanceProfile.active.
 *
 * @capability-id governance-profiles
 * @capability-criticality medium
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Profile types
// ---------------------------------------------------------------------------

export type GovernanceProfileName = "conservative" | "balanced" | "throughput";

export interface GovernanceProfileDeltaEntry {
  /** Dot-separated path into the settings object (e.g. "piStack.colonyPilot.deliveryPolicy.mode") */
  path: string;
  /** Value currently in settings (undefined if absent) */
  current: unknown;
  /** Value the profile would write */
  proposed: unknown;
  /** true when current !== proposed */
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

/**
 * Each profile is a piStack settings patch.
 * Only safety/governance scalar fields are defined — providerBudgets,
 * routeModelRefs, and other user-configured data are NOT touched.
 */
export const GOVERNANCE_PROFILES: Record<GovernanceProfileName, Record<string, unknown>> = {
  conservative: {
    piStack: {
      colonyPilot: {
        deliveryPolicy: {
          enabled: true,
          mode: "report-only",          // no branch writes — safest
          blockOnMissingEvidence: true,
        },
        budgetPolicy: {
          enforceProviderBudgetBlock: true,
          defaultMaxCostUsd: 0.5,        // tight per-run cap
        },
      },
      schedulerGovernance: {
        enabled: true,
        policy: "observe",              // no auto-scheduling
        requireTextConfirmation: true,
      },
      webSessionGateway: { mode: "local" },
      governanceProfile: { active: "conservative" },
    },
  },

  balanced: {
    piStack: {
      colonyPilot: {
        deliveryPolicy: {
          enabled: true,
          mode: "patch-artifact",        // produce artifact, explicit apply
          blockOnMissingEvidence: true,
        },
        budgetPolicy: {
          enforceProviderBudgetBlock: true,
          defaultMaxCostUsd: 2,
        },
      },
      schedulerGovernance: {
        enabled: true,
        policy: "observe",
        requireTextConfirmation: false,
      },
      webSessionGateway: { mode: "local" },
      governanceProfile: { active: "balanced" },
    },
  },

  throughput: {
    piStack: {
      colonyPilot: {
        deliveryPolicy: {
          enabled: true,
          mode: "apply-to-branch",       // auto-apply — max velocity
          blockOnMissingEvidence: false,
        },
        budgetPolicy: {
          enforceProviderBudgetBlock: false, // don't block on stale data
          defaultMaxCostUsd: 5,
        },
      },
      schedulerGovernance: {
        enabled: true,
        policy: "enforce",              // auto-scheduling active
        requireTextConfirmation: false,
      },
      webSessionGateway: { mode: "local" },
      governanceProfile: { active: "throughput" },
    },
  },
};

export const PROFILE_DESCRIPTIONS: Record<GovernanceProfileName, string> = {
  conservative:
    "Safety-first. delivery=report-only, scheduler=observe, enforcement=on, maxCost=$0.50/run.",
  balanced:
    "Production default. delivery=patch-artifact, scheduler=observe, enforcement=on, maxCost=$2/run.",
  throughput:
    "Max velocity. delivery=apply-to-branch, scheduler=enforce, enforcement=relaxed, maxCost=$5/run.",
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Validate a profile name string. Returns the typed name or undefined. */
export function parseGovernanceProfile(raw: unknown): GovernanceProfileName | undefined {
  if (raw === "conservative" || raw === "balanced" || raw === "throughput") {
    return raw;
  }
  return undefined;
}

/**
 * Flatten a nested object into dot-notation key → value pairs.
 * Arrays are treated as leaf values (not recursed into).
 */
export function flattenObject(
  obj: unknown,
  prefix = "",
): Record<string, unknown> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return prefix ? { [prefix]: obj } : {};
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      Object.assign(result, flattenObject(v, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}

/**
 * Compute the delta between the named profile and the current settings.
 * Only paths that appear in the profile definition are evaluated.
 */
export function previewGovernanceDelta(
  profileName: GovernanceProfileName,
  current: Record<string, unknown>,
): GovernanceProfileDeltaEntry[] {
  const profile = GOVERNANCE_PROFILES[profileName];
  const flatProfile = flattenObject(profile);
  const flatCurrent = flattenObject(current);
  return Object.entries(flatProfile).map(([p, proposed]) => ({
    path: p,
    current: flatCurrent[p],
    proposed,
    changed: flatCurrent[p] !== proposed,
  }));
}

/**
 * Deep-merge `patch` into `base`.
 * Scalar fields in `patch` override `base` (intentional — governance fields
 * must win over existing settings). Non-patch fields are preserved.
 */
export function applyGovernanceProfile(
  base: Record<string, unknown>,
  profileName: GovernanceProfileName,
): Record<string, unknown> {
  return deepMerge(base, GOVERNANCE_PROFILES[profileName] as Record<string, unknown>);
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.assign({}, base);
  for (const [k, v] of Object.entries(patch)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      out[k] !== null &&
      typeof out[k] === "object" &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(
        out[k] as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Settings I/O helpers (shared with safe-boot pattern)
// ---------------------------------------------------------------------------

function settingsPath(cwd: string): string {
  return path.join(cwd, ".pi", "settings.json");
}

function snapshotDir(cwd: string): string {
  return path.join(cwd, ".pi", "snapshots");
}

function saveSnapshotBeforeProfile(cwd: string, profileName: GovernanceProfileName): string {
  const sp = settingsPath(cwd);
  const content = existsSync(sp) ? JSON.parse(readFileSync(sp, "utf8")) : {};
  const now = new Date().toISOString();
  const stamp = now.slice(0, 19).replace(/[:-]/g, "").replace("T", "-");
  const filename = `${stamp}-pre-governance-${profileName}.json`;
  const dir = snapshotDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, filename),
    JSON.stringify({ tag: `pre-governance-${profileName}`, savedAtIso: now, content }, null, 2),
    "utf8",
  );
  return filename;
}

function readSettings(cwd: string): Record<string, unknown> {
  const sp = settingsPath(cwd);
  return existsSync(sp) ? (JSON.parse(readFileSync(sp, "utf8")) as Record<string, unknown>) : {};
}

function writeSettings(cwd: string, settings: Record<string, unknown>): void {
  const sp = settingsPath(cwd);
  mkdirSync(path.dirname(sp), { recursive: true });
  writeFileSync(sp, JSON.stringify(settings, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatDelta(delta: GovernanceProfileDeltaEntry[]): string[] {
  const changed = delta.filter((d) => d.changed);
  const unchanged = delta.filter((d) => !d.changed);
  const lines: string[] = [];
  if (changed.length === 0) {
    lines.push("nenhuma alteração necessária — settings já estão alinhados com o perfil.");
  } else {
    lines.push(`${changed.length} campo(s) seriam alterados:`);
    for (const e of changed) {
      const cur = e.current === undefined ? "(ausente)" : JSON.stringify(e.current);
      const pro = JSON.stringify(e.proposed);
      lines.push(`  ${e.path}: ${cur} → ${pro}`);
    }
  }
  if (unchanged.length > 0) {
    lines.push(`${unchanged.length} campo(s) já corretos (sem alteração).`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function governanceProfilesExtension(pi: ExtensionAPI) {
  // ---- tool: governance_profile ------------------------------------------

  pi.registerTool({
    name: "governance_profile",
    label: "Governance Profile",
    description: [
      "Apply or preview a named governance profile (conservative|balanced|throughput).",
      "preview: show what would change vs current settings.",
      "apply: snapshot current settings then apply the profile.",
      "list: describe all available profiles.",
      "status: show the currently active profile.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.String({
        description: "preview | apply | list | status",
      }),
      profile: Type.Optional(
        Type.String({ description: "conservative | balanced | throughput (required for preview/apply)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { action: string; profile?: string };

      if (p.action === "list") {
        const lines = (Object.keys(GOVERNANCE_PROFILES) as GovernanceProfileName[]).map(
          (n) => `${n}: ${PROFILE_DESCRIPTIONS[n]}`,
        );
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { profiles: PROFILE_DESCRIPTIONS },
        };
      }

      if (p.action === "status") {
        const settings = readSettings(ctx.cwd);
        const piStack = (settings.piStack as Record<string, unknown> | undefined) ?? {};
        const gp = (piStack.governanceProfile as Record<string, unknown> | undefined) ?? {};
        const active = (gp.active as string | undefined) ?? "(none — not set)";
        return {
          content: [{ type: "text", text: `active governance profile: ${active}` }],
          details: { active },
        };
      }

      const profileName = parseGovernanceProfile(p.profile);
      if (!profileName) {
        const err = `profile must be conservative | balanced | throughput (got: ${p.profile ?? "(none)"})`;
        return { content: [{ type: "text", text: err }], details: { error: err } };
      }

      const current = readSettings(ctx.cwd);
      const delta = previewGovernanceDelta(profileName, current);

      if (p.action === "preview") {
        const lines = [`profile: ${profileName}`, "", ...formatDelta(delta)];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { profile: profileName, delta },
        };
      }

      // action === "apply"
      const snapshotFile = saveSnapshotBeforeProfile(ctx.cwd, profileName);
      const merged = applyGovernanceProfile(current, profileName);
      writeSettings(ctx.cwd, merged);
      pi.appendEntry("governance-profiles.applied", {
        atIso: new Date().toISOString(),
        profile: profileName,
        snapshotFile,
        changedCount: delta.filter((d) => d.changed).length,
      });

      const lines = [
        `perfil ${profileName} aplicado.`,
        `snapshot salvo: ${snapshotFile}`,
        "",
        ...formatDelta(delta),
        "",
        "Execute /reload para ativar. Restaurar com: /safe-boot restore",
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { profile: profileName, snapshotFile, delta },
      };
    },
  });

  // ---- command: /governance-profile --------------------------------------

  pi.registerCommand("governance-profile", {
    description: [
      "Apply or preview a governance profile for budget/routing/delivery settings.",
      "Usage: /governance-profile [list|status|preview <profile>|apply <profile>]",
      "Profiles: conservative | balanced | throughput",
    ].join(" "),
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sub = tokens[0] ?? "list";

      if (sub === "list") {
        const lines = [
          "governance profiles disponíveis:",
          "",
          ...(Object.keys(GOVERNANCE_PROFILES) as GovernanceProfileName[]).map(
            (n) => `  ${n.padEnd(12)} — ${PROFILE_DESCRIPTIONS[n]}`,
          ),
          "",
          "uso: /governance-profile preview <profile> | /governance-profile apply <profile>",
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "status") {
        const settings = readSettings(ctx.cwd);
        const piStack = (settings.piStack as Record<string, unknown> | undefined) ?? {};
        const gp = (piStack.governanceProfile as Record<string, unknown> | undefined) ?? {};
        const active = (gp.active as string | undefined) ?? "(none — não configurado)";
        ctx.ui.notify(`perfil de governança ativo: ${active}`, "info");
        return;
      }

      const profileName = parseGovernanceProfile(tokens[1]);
      if (!profileName) {
        ctx.ui.notify(
          `perfil inválido: "${tokens[1] ?? "(none)"}". Use: conservative | balanced | throughput`,
          "warning",
        );
        return;
      }

      const current = readSettings(ctx.cwd);
      const delta = previewGovernanceDelta(profileName, current);

      if (sub === "preview") {
        const lines = [
          `preview: perfil ${profileName}`,
          `  ${PROFILE_DESCRIPTIONS[profileName]}`,
          "",
          ...formatDelta(delta),
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "apply") {
        const snapshotFile = saveSnapshotBeforeProfile(ctx.cwd, profileName);
        const merged = applyGovernanceProfile(current, profileName);
        writeSettings(ctx.cwd, merged);
        pi.appendEntry("governance-profiles.applied", {
          atIso: new Date().toISOString(),
          profile: profileName,
          snapshotFile,
          changedCount: delta.filter((d) => d.changed).length,
        });
        ctx.ui.notify(
          [
            `perfil ${profileName} aplicado.`,
            `  ${PROFILE_DESCRIPTIONS[profileName]}`,
            `snapshot salvo: ${snapshotFile}`,
            "",
            ...formatDelta(delta),
            "",
            "Execute /reload para ativar. Restaurar com: /safe-boot restore",
          ].join("\n"),
          "info",
        );
        return;
      }

      ctx.ui.notify(
        "uso: /governance-profile [list|status|preview <profile>|apply <profile>]",
        "warning",
      );
    },
  });
}
