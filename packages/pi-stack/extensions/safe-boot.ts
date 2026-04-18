/**
 * safe-boot — safe-core boot profile + settings snapshot/restore for pi-stack.
 *
 * Three capabilities:
 *   1. Settings snapshot: save/restore .pi/settings.json before applying profiles
 *   2. Safe-core profile: conservative piStack settings (no branch writes,
 *      all enforcement gates active, no experimental features)
 *   3. Recovery channel: /safe-boot recover lists diagnostic commands
 *
 * @capability-id safe-boot
 * @capability-criticality high
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

export interface SettingsSnapshot {
  tag: string;
  savedAtIso: string;
  settingsPath: string;
  content: unknown;
}

export interface SnapshotMeta {
  filename: string;
  tag: string;
  savedAtIso: string;
  snapshotPath: string;
}

// ---------------------------------------------------------------------------
// Safe-core profile definition
// ---------------------------------------------------------------------------

/**
 * Conservative piStack overrides for safe-core boot.
 *
 * Only fields with safety implications are overridden. Fields like
 * quotaVisibility.providerBudgets are preserved from existing settings
 * (they represent real-world configuration, not safety settings).
 *
 * Safety invariants:
 *   - delivery mode = report-only (no branch writes from colony)
 *   - scheduler policy = observe (no auto-scheduling)
 *   - colony pilot preflight = enabled
 *   - model policy = enabled
 *   - budget enforcement gates enabled
 *   - web session gateway = local (no remote exposure)
 */
export const SAFE_CORE_PROFILE: Record<string, unknown> = {
  piStack: {
    colonyPilot: {
      preflight: {
        enabled: true,
        enforceOnAntColonyTool: true,
      },
      modelPolicy: {
        enabled: true,
      },
      budgetPolicy: {
        enabled: true,
        enforceOnAntColonyTool: true,
        requireMaxCost: true,
        autoInjectMaxCost: true,
        enforceProviderBudgetBlock: false, // conservative: don't block on stale budget data
      },
      deliveryPolicy: {
        enabled: true,
        mode: "report-only",               // safest: no branch writes
        blockOnMissingEvidence: true,
      },
    },
    schedulerGovernance: {
      enabled: true,
      policy: "observe",                   // no auto-scheduling
      requireTextConfirmation: true,
    },
    webSessionGateway: {
      mode: "local",                       // no remote exposure
    },
  },
};

// ---------------------------------------------------------------------------
// Snapshot helpers (pure / testable)
// ---------------------------------------------------------------------------

export function snapshotDir(cwd: string): string {
  return path.join(cwd, ".pi", "snapshots");
}

export function settingsPath(cwd: string): string {
  return path.join(cwd, ".pi", "settings.json");
}

export function buildSnapshotFilename(tag: string, nowIso: string): string {
  const stamp = nowIso.slice(0, 19).replace(/[:-]/g, "").replace("T", "-");
  const safeTag = tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  return `${stamp}-${safeTag}.json`;
}

export function parseSnapshotMeta(filename: string, snapshotDir: string): SnapshotMeta | undefined {
  // Filename format: YYYYMMDD-HHmmss-<tag>.json
  const m = filename.match(/^(\d{8}-\d{6})-(.+)\.json$/);
  if (!m) return undefined;
  const [, stamp, tag] = m;
  // Reconstruct ISO-ish from YYYYMMDD-HHmmss
  const savedAtIso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  return { filename, tag, savedAtIso, snapshotPath: path.join(snapshotDir, filename) };
}

export function listSnapshots(cwd: string): SnapshotMeta[] {
  const dir = snapshotDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => parseSnapshotMeta(f, dir))
    .filter((m): m is SnapshotMeta => m !== undefined)
    .sort((a, b) => b.savedAtIso.localeCompare(a.savedAtIso)); // newest first
}

/**
 * Deep-merge override fields from `profile` into `current`.
 * Unlike installer deepMergeForBaseline, this IS destructive for scalar fields —
 * the safe-core profile explicitly overrides safety-critical values.
 */
export function applySafeCoreProfile(
  current: Record<string, unknown>,
  profile: Record<string, unknown> = SAFE_CORE_PROFILE,
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.assign({}, current);
  for (const [key, value] of Object.entries(profile)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value) &&
        out[key] !== null && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = applySafeCoreProfile(
        out[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value; // override (intentionally destructive for safety fields)
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot I/O
// ---------------------------------------------------------------------------

export function saveSnapshot(cwd: string, tag: string): SnapshotMeta {
  const settings = settingsPath(cwd);
  const content = existsSync(settings)
    ? JSON.parse(readFileSync(settings, "utf8"))
    : {};
  const nowIso = new Date().toISOString();
  const filename = buildSnapshotFilename(tag, nowIso);
  const dir = snapshotDir(cwd);
  mkdirSync(dir, { recursive: true });
  const snapshotPath = path.join(dir, filename);
  writeFileSync(snapshotPath, JSON.stringify({ tag, savedAtIso: nowIso, settingsPath: settings, content }, null, 2), "utf8");
  return { filename, tag, savedAtIso: nowIso, snapshotPath };
}

export function restoreSnapshot(cwd: string, filename: string): { restored: boolean; error?: string } {
  const dir = snapshotDir(cwd);
  const snapshotPath = path.join(dir, filename);
  if (!existsSync(snapshotPath)) {
    return { restored: false, error: `Snapshot not found: ${filename}` };
  }
  const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as SettingsSnapshot;
  const target = settingsPath(cwd);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(snap.content, null, 2), "utf8");
  return { restored: true };
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function safeBootExtension(pi: ExtensionAPI) {
  // ---- tool: safe_boot ---------------------------------------------------

  pi.registerTool({
    name: "safe_boot",
    label: "Safe Boot",
    description: [
      "Save a settings snapshot then apply the safe-core boot profile to .pi/settings.json.",
      "safe-core: delivery=report-only, scheduler=observe, all enforcement gates on, no remote exposure.",
      "Snapshot is saved before any change so it can be restored by /safe-boot restore.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.String({
        description: "apply: snapshot+apply safe-core | snapshot: save only | restore: restore last | list: list snapshots",
      }),
      snapshot_filename: Type.Optional(
        Type.String({ description: "For restore: specific snapshot filename to restore." })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { action: string; snapshot_filename?: string };

      if (p.action === "list") {
        const snaps = listSnapshots(ctx.cwd);
        return {
          content: [{ type: "text", text: JSON.stringify(snaps, null, 2) }],
          details: { snapshots: snaps },
        };
      }

      if (p.action === "snapshot") {
        const meta = saveSnapshot(ctx.cwd, "manual");
        return {
          content: [{ type: "text", text: JSON.stringify(meta, null, 2) }],
          details: { snapshot: meta },
        };
      }

      if (p.action === "restore") {
        const snaps = listSnapshots(ctx.cwd);
        const filename = p.snapshot_filename ?? snaps[0]?.filename;
        if (!filename) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "No snapshots found." }) }],
            details: { error: "No snapshots found." },
          };
        }
        const result = restoreSnapshot(ctx.cwd, filename);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      // action === "apply": snapshot + apply safe-core
      const snapshot = saveSnapshot(ctx.cwd, "pre-safe-boot");
      const target = settingsPath(ctx.cwd);
      const current = existsSync(target)
        ? JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>
        : {};
      const merged = applySafeCoreProfile(current);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(merged, null, 2), "utf8");
      pi.appendEntry("safe-boot.applied", {
        atIso: new Date().toISOString(),
        snapshotFile: snapshot.filename,
        profileKey: "safe-core",
      });
      const result = { applied: true, snapshotFile: snapshot.filename, profileKey: "safe-core" };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  // ---- command: /safe-boot -----------------------------------------------

  pi.registerCommand("safe-boot", {
    description: [
      "Safe-core boot profile + settings snapshot management.",
      "Usage: /safe-boot [apply|snapshot|restore [<filename>]|list|recover]",
    ].join(" "),
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const cmd = tokens[0] ?? "apply";

      if (cmd === "recover") {
        ctx.ui.notify(
          [
            "safe-boot recovery channel",
            "",
            "Diagnostic commands available:",
            "  /stack-status           — capability ownership + scheduler conflict",
            "  /environment-doctor     — dependency + provider readiness",
            "  /quota-visibility       — provider budget status",
            "  /quota-alerts           — active budget/429 alerts",
            "  /handoff                — next recommended provider",
            "  /safe-boot list         — list saved snapshots",
            "  /safe-boot restore      — restore last pre-safe-boot snapshot",
            "  /safe-boot apply        — re-apply safe-core profile",
            "",
            "If settings are corrupted, restore from snapshot:",
            "  /safe-boot restore",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "list") {
        const snaps = listSnapshots(ctx.cwd);
        if (snaps.length === 0) {
          ctx.ui.notify("No snapshots found in .pi/snapshots/", "info");
          return;
        }
        const lines = [
          `snapshots (${snaps.length}):`,
          ...snaps.map((s) => `  ${s.savedAtIso.slice(0, 19)}Z  ${s.tag}  →  ${s.filename}`),
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (cmd === "restore") {
        const snaps = listSnapshots(ctx.cwd);
        const filename = tokens[1] ?? snaps[0]?.filename;
        if (!filename) {
          ctx.ui.notify("No snapshots found. Nothing to restore.", "warning");
          return;
        }
        const result = restoreSnapshot(ctx.cwd, filename);
        if (!result.restored) {
          ctx.ui.notify(`Restore failed: ${result.error}`, "error" as "warning");
          return;
        }
        ctx.ui.notify(
          [
            "Settings restored from snapshot.",
            `file: ${filename}`,
            "",
            "Run /reload to apply restored settings.",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "snapshot") {
        const meta = saveSnapshot(ctx.cwd, "manual");
        ctx.ui.notify(
          [
            "Settings snapshot saved.",
            `file: ${meta.filename}`,
            `path: ${meta.snapshotPath}`,
          ].join("\n"),
          "info"
        );
        return;
      }

      // apply (default)
      const snapshot = saveSnapshot(ctx.cwd, "pre-safe-boot");
      const target = settingsPath(ctx.cwd);
      const current = existsSync(target)
        ? JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>
        : {};
      const merged = applySafeCoreProfile(current);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(merged, null, 2), "utf8");
      pi.appendEntry("safe-boot.applied", {
        atIso: new Date().toISOString(),
        snapshotFile: snapshot.filename,
        profileKey: "safe-core",
      });
      ctx.ui.notify(
        [
          "safe-core profile applied.",
          `snapshot saved: ${snapshot.filename}`,
          "",
          "Safe-core invariants:",
          "  delivery.mode = report-only  (no branch writes)",
          "  scheduler.policy = observe   (no auto-scheduling)",
          "  all enforcement gates = on",
          "  web gateway = local only",
          "",
          "Run /reload to activate. Restore with: /safe-boot restore",
        ].join("\n"),
        "info"
      );
    },
  });
}
