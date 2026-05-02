#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const CANONICAL_PATHS = [
  ".project/handoff.json",
  ".project/tasks.json",
  ".project/verification.json",
];

function parseArgs(argv) {
  const out = {
    workspace: process.cwd(),
    pack: undefined,
    profile: "control-plane-core",
    maxAgeHours: 24,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") {
      out.workspace = argv[i + 1] ?? out.workspace;
      i++;
      continue;
    }
    if (a === "--pack") {
      out.pack = argv[i + 1] ?? out.pack;
      i++;
      continue;
    }
    if (a === "--profile") {
      out.profile = String(argv[i + 1] ?? out.profile).trim().toLowerCase();
      i++;
      continue;
    }
    if (a === "--max-age-hours") {
      out.maxAgeHours = Number(argv[i + 1] ?? out.maxAgeHours);
      i++;
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
  }

  if (!Number.isFinite(out.maxAgeHours) || out.maxAgeHours <= 0) out.maxAgeHours = 24;
  return out;
}

function readCanonicalState(workspace) {
  const entries = CANONICAL_PATHS.map((rel) => {
    const abs = path.join(workspace, rel);
    if (!existsSync(abs)) return { path: rel, exists: false, mtimeMs: 0 };
    try {
      const st = statSync(abs);
      return { path: rel, exists: true, mtimeMs: Math.floor(st.mtimeMs) };
    } catch {
      return { path: rel, exists: false, mtimeMs: 0 };
    }
  });

  const fingerprint = createHash("sha1")
    .update(entries.map((e) => `${e.path}:${e.exists ? 1 : 0}:${e.mtimeMs}`).join("|"))
    .digest("hex");

  return { fingerprint, files: entries };
}

function resolveProfile(preloadPack, requested) {
  const profileMap = {
    "control-plane-core": preloadPack?.controlPlaneCore,
    "agent-worker-lean": preloadPack?.agentWorkerLean,
    "swarm-scout-min": preloadPack?.swarmScoutMin,
  };
  const selected = profileMap[requested];
  if (Array.isArray(selected)) {
    return { profile: requested, paths: selected };
  }
  return { profile: "control-plane-core", paths: Array.isArray(profileMap["control-plane-core"]) ? profileMap["control-plane-core"] : [] };
}

function buildReport(args) {
  const workspace = path.resolve(args.workspace);
  const defaultPackPath = path.join(workspace, ".sandbox", "pi-agent", "preload", "context-preload-pack.json");
  const packPath = path.resolve(args.pack ?? defaultPackPath);
  const currentCanonicalState = readCanonicalState(workspace);
  const staleReasons = [];

  let pack = null;
  if (!existsSync(packPath)) {
    staleReasons.push("pack-missing");
  } else {
    try {
      pack = JSON.parse(readFileSync(packPath, "utf8"));
    } catch {
      staleReasons.push("pack-invalid-json");
    }
  }

  if (pack) {
    const generatedAtMs = Date.parse(String(pack.generatedAtIso ?? ""));
    const maxAgeMs = args.maxAgeHours * 60 * 60 * 1000;
    if (!Number.isFinite(generatedAtMs)) {
      staleReasons.push("pack-generated-at-missing");
    } else if (Date.now() - generatedAtMs > maxAgeMs) {
      staleReasons.push("pack-too-old");
    }

    const packFingerprint = String(pack?.canonicalState?.fingerprint ?? "").trim();
    if (!packFingerprint) {
      staleReasons.push("canonical-fingerprint-missing");
    } else if (packFingerprint !== currentCanonicalState.fingerprint) {
      staleReasons.push("canonical-state-changed");
    }
  }

  const resolved = resolveProfile(pack?.preloadPack, args.profile);
  const packEmpty = resolved.paths.length === 0;
  if (pack && packEmpty) staleReasons.push("profile-pack-empty");

  const decision = staleReasons.length > 0 ? "fallback-canonical" : "use-pack";
  const selectedPaths = decision === "use-pack" ? resolved.paths : CANONICAL_PATHS;

  return {
    mode: "context-preload-consume",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    workspace,
    packPath,
    profileRequested: args.profile,
    profileResolved: resolved.profile,
    decision,
    selectedPaths,
    fallbackPaths: CANONICAL_PATHS,
    staleReasons,
    currentCanonicalState,
    summary: [
      "context-preload-consume:",
      `decision=${decision}`,
      `profile=${resolved.profile}`,
      `selected=${selectedPaths.length}`,
      staleReasons.length > 0 ? `stale=${staleReasons.join("|")}` : "stale=none",
    ].join(" "),
  };
}

function printHuman(report) {
  const lines = [];
  lines.push("# Context Preload Consume");
  lines.push("");
  lines.push(`decision: ${report.decision}`);
  lines.push(`profile: ${report.profileResolved}`);
  lines.push(`pack: ${report.packPath}`);
  lines.push("");
  lines.push("selected paths:");
  for (const p of report.selectedPaths) lines.push(`- ${p}`);
  if (report.selectedPaths.length === 0) lines.push("- (empty)");

  if (report.staleReasons.length > 0) {
    lines.push("");
    lines.push("stale reasons:");
    for (const reason of report.staleReasons) lines.push(`- ${reason}`);
  }

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(printHuman(report));
}

main();
